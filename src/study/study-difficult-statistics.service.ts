import { BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

type Aggregate = { words: bigint; archived: bigint; practiced: bigint; sessions: bigint; answers: bigint; known: bigint; needsReview: bigint };

@Injectable()
export class StudyDifficultStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, days = 30) {
    if (![7, 30, 90].includes(days)) throw new BadRequestException("Некорректный период статистики");
    const to = new Date(), from = new Date(to.getTime() - days * 86400000);
    // One snapshot of current personal flags and saved answers. Historical flag changes were not recorded.
    const [row] = await this.prisma.$queryRaw<Aggregate[]>`
      WITH marked AS (
        SELECT u."wordId", u."isArchived" FROM public.user_words u
        JOIN public.words w ON w.id = u."wordId"
        WHERE u."userId" = ${userId} AND u."isDifficult" = TRUE
          AND (w."publicationStatus" = 'PUBLISHED' OR w."createdByUserId" = ${userId})
      ), answers AS (
        SELECT a.id, a."wordId", a."sessionId", a.answer
        FROM public.study_session_words a JOIN public.study_sessions s ON s.id = a."sessionId"
        JOIN marked m ON m."wordId" = a."wordId"
        WHERE s."userId" = ${userId}
          AND s."completedAt" >= (CAST(${from.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')
          AND s."completedAt" <= (CAST(${to.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')
      )
      SELECT (SELECT count(*) FROM marked)::bigint AS words,
        (SELECT count(*) FROM marked WHERE "isArchived")::bigint AS archived,
        count(DISTINCT "wordId")::bigint AS practiced, count(DISTINCT "sessionId")::bigint AS sessions,
        count(*)::bigint AS answers, count(*) FILTER (WHERE answer = 'KNOWN')::bigint AS known,
        count(*) FILTER (WHERE answer = 'NEEDS_REVIEW')::bigint AS "needsReview" FROM answers`;
    if (!row || Object.values(row).some(n => !Number.isSafeInteger(Number(n)) || Number(n) < 0)) throw new InternalServerErrorException();
    const words = Number(row.words), archived = Number(row.archived), practiced = Number(row.practiced);
    const period = { words: practiced, withoutAnswers: words - practiced, sessions: Number(row.sessions), answers: Number(row.answers), known: Number(row.known), needsReview: Number(row.needsReview) };
    if (archived > words || practiced > words || practiced > period.answers || period.known + period.needsReview !== period.answers ||
        (period.sessions === 0 ? period.answers !== 0 : period.sessions > period.answers) || (practiced === 0) !== (period.answers === 0)) throw new InternalServerErrorException();
    return { days, from: from.toISOString(), to: to.toISOString(), current: { words, active: words - archived, archived }, period };
  }
}
