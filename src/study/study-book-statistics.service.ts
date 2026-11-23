import { BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { StudyBookStatisticsQueryDto } from "./dto/study-book-statistics-query.dto";

type BookRow = { sourceBook: string | null; lessonNumber: number | null; sessions: number; answers: number; known: number; needsReview: number; words: number };
type Result = { totalGroups: bigint; rows: BookRow[] };
export const BOOK_STATISTICS_PAGE_SIZE = 10;
export const normalizeStatisticsBook = (title: string) => title.normalize("NFC").trim().replace(/\s+/gu, " ");
// Match JavaScript whitespace, including non-breaking spaces commonly pasted from Excel.
const bookWhitespace = "[\\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+";
const sqlBookTitle = (title: Prisma.Sql) => Prisma.sql`normalize(btrim(regexp_replace(${title}, ${bookWhitespace}, ' ', 'g')), NFC)`;

@Injectable()
export class StudyBookStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, query: StudyBookStatisticsQueryDto) {
    const days = query.days ?? 30, page = query.page ?? 1;
    if (![7, 30, 90].includes(days) || !Number.isInteger(page) || page < 1 || page > 100000 ||
        (query.unassigned !== undefined && query.unassigned !== "true") || (query.book !== undefined && query.unassigned !== undefined)) {
      throw new BadRequestException("Некорректный запрос статистики книг");
    }
    const book = query.book === undefined ? null : normalizeStatisticsBook(query.book);
    if (query.book !== undefined && (!book || [...book].length > 120 || /\p{Cc}/u.test(book))) throw new BadRequestException("Некорректный запрос статистики книг");
    const scope = query.book !== undefined || query.unassigned === "true" ? "lessons" : "books";
    const to = new Date(), from = new Date(to.getTime() - days * 86400000);
    const lesson = scope === "lessons" ? Prisma.sql`m.lesson` : Prisma.sql`NULL::int`;
    const filter = scope === "books" ? Prisma.sql`TRUE` : book === null ? Prisma.sql`m.key IS NULL` : Prisma.sql`m.key = lower(${book})`;
    // One statement = one snapshot. Only saved answer identifiers and current source metadata are read.
    // UNION/COUNT(DISTINCT) prevent duplicated legacy/shared/private links multiplying answers.
    const [result] = await this.prisma.$queryRaw<Result[]>(Prisma.sql`
      WITH answers AS (
        SELECT a.id, a."sessionId", a."wordId", a.answer FROM public.study_session_words a
        JOIN public.study_sessions s ON s.id = a."sessionId"
        WHERE s."userId" = ${userId}
          AND s."completedAt" >= (CAST(${from.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')
          AND s."completedAt" <= (CAST(${to.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')
      ), readable AS (
        SELECT w.id, w."sourceBook", w."lessonNumber" FROM public.words w
        WHERE w.id IN (SELECT "wordId" FROM answers)
          AND (w."publicationStatus" = 'PUBLISHED' OR w."createdByUserId" = ${userId})
      ), raw_sources AS (
        SELECT b."wordId", b."sourceBook" AS title, n.lesson FROM public.word_source_books b
        JOIN readable w ON w.id = b."wordId"
        LEFT JOIN LATERAL unnest(b."lessonNumbers") n(lesson) ON TRUE
        UNION ALL
        SELECT id, "sourceBook", "lessonNumber" FROM readable WHERE "sourceBook" IS NOT NULL
        UNION ALL
        SELECT p."wordId", t.title, CASE WHEN jsonb_typeof(n.value) = 'number'
          AND n.value::text ~ '^[0-9]{1,5}$' THEN (n.value::text)::int ELSE NULL END
        FROM public.personal_word_books p JOIN readable w ON w.id = p."wordId"
        CROSS JOIN LATERAL unnest(p.titles) t(title)
        LEFT JOIN LATERAL jsonb_each(p.lessons) j ON lower(${sqlBookTitle(Prisma.sql`j.key`)}) = lower(${sqlBookTitle(Prisma.sql`t.title`)})
        LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.value) = 'array' THEN j.value ELSE '[]'::jsonb END) n ON TRUE
        WHERE p."userId" = ${userId}
      ), normalized AS (
        SELECT "wordId", ${sqlBookTitle(Prisma.sql`title`)} AS title,
          CASE WHEN lesson BETWEEN 1 AND 10000 THEN lesson ELSE NULL END AS lesson
        FROM raw_sources
      ), links AS (
        SELECT DISTINCT "wordId", lower(title) AS key, title, lesson FROM normalized WHERE title <> ''
      ), effective_links AS (
        SELECT l.* FROM links l WHERE l.lesson IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM links other WHERE other."wordId" = l."wordId" AND other.key = l.key AND other.lesson IS NOT NULL
        )
      ), mapped AS (
        SELECT a.*, l.key, l.title, CASE WHEN l.key IS NULL THEN
          CASE WHEN w."lessonNumber" BETWEEN 1 AND 10000 THEN w."lessonNumber" ELSE NULL END ELSE l.lesson END AS lesson
        FROM answers a LEFT JOIN effective_links l ON l."wordId" = a."wordId"
        LEFT JOIN readable w ON w.id = a."wordId"
      ), groups AS (
        SELECT min(m.title) AS "sourceBook", ${lesson} AS "lessonNumber", m.key,
          count(DISTINCT m."sessionId")::bigint AS sessions, count(DISTINCT m.id)::bigint AS answers,
          count(DISTINCT m.id) FILTER (WHERE m.answer = 'KNOWN')::bigint AS known,
          count(DISTINCT m.id) FILTER (WHERE m.answer = 'NEEDS_REVIEW')::bigint AS "needsReview",
          count(DISTINCT m."wordId")::bigint AS words
        FROM mapped m WHERE ${filter} GROUP BY m.key, ${lesson}
      ), page_rows AS (
        SELECT "sourceBook", "lessonNumber", sessions, answers, known, "needsReview", words FROM groups
        ORDER BY key COLLATE "C" NULLS LAST, "lessonNumber" NULLS LAST
        LIMIT ${BOOK_STATISTICS_PAGE_SIZE} OFFSET ${(page - 1) * BOOK_STATISTICS_PAGE_SIZE}
      )
      SELECT (SELECT count(*) FROM groups)::bigint AS "totalGroups",
        COALESCE((SELECT jsonb_agg(row_to_json(r)) FROM page_rows r), '[]'::jsonb) AS rows`);
    const totalGroups = Number(result?.totalGroups);
    if (!Number.isSafeInteger(totalGroups) || totalGroups < 0 || !Array.isArray(result?.rows) ||
        result.rows.some(row => [row.sessions, row.answers, row.known, row.needsReview, row.words].some(n => !Number.isSafeInteger(n) || n < 0))) {
      throw new InternalServerErrorException();
    }
    return { days, from: from.toISOString(), to: to.toISOString(), scope, book, page, pageSize: BOOK_STATISTICS_PAGE_SIZE, totalGroups, rows: result.rows };
  }
}
