import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { csvHeader, csvLine, MAX_EXPORT_BYTES } from "./dictionary-csv";
import { dictionaryWords } from "../words/word-access.service";

export const HISTORY_COLUMNS = {
  sessions: ["format_version", "session_id", "started_at_utc", "completed_at_utc", "total_words", "known_count", "needs_review_count"],
  answers: ["format_version", "session_id", "started_at_utc", "completed_at_utc", "word_id", "german", "article", "answer", "answered_at_utc", "word_available"],
};
export type HistoryKind = keyof typeof HISTORY_COLUMNS;
export const MAX_HISTORY_ROWS = 50_000;
type Period = { from?: string; to?: string };
export function historyPeriod(period: Period): Prisma.DateTimeFilter | undefined {
  const date = (value: string | undefined) => {
    if (value === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("history_export_invalid_period");
    const result = new Date(value + "T00:00:00.000Z");
    if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value || result.getUTCFullYear() < 1970 || result.getUTCFullYear() > 9998) throw new BadRequestException("history_export_invalid_period");
    return result;
  };
  const from = date(period.from), to = date(period.to);
  if (from && to && from > to) throw new BadRequestException("history_export_invalid_period");
  return from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86400000) } : {}) } : undefined;
}
const tooLarge = () => { throw new PayloadTooLargeException("history_export_too_large"); };
const sessionSelect = { id: true, startedAt: true, completedAt: true, totalWords: true, knownCount: true, needsReviewCount: true } satisfies Prisma.StudySessionSelect;

export async function exportHistory(tx: Prisma.TransactionClient, userId: string, kind: HistoryKind, period: Period): Promise<{ csv: string; rowCount: number }> {
  if (kind !== "sessions" && kind !== "answers") throw new BadRequestException("history_export_invalid_kind");
  const startedAt = historyPeriod(period), sessionWhere = { userId, ...(startedAt ? { startedAt } : {}) } satisfies Prisma.StudySessionWhereInput;
  const chunks = [csvHeader(HISTORY_COLUMNS[kind])]; let bytes = Buffer.byteLength(chunks[0]), rowCount = 0, lastId: string | undefined;
  const append = (row: Parameters<typeof csvLine>[1]) => {
    const line = csvLine(HISTORY_COLUMNS[kind], row); bytes += Buffer.byteLength(line);
    if (++rowCount > MAX_HISTORY_ROWS || bytes > MAX_EXPORT_BYTES) tooLarge(); chunks.push(line);
  };
  if (kind === "sessions") {
    if (await tx.studySession.count({ where: sessionWhere }) > MAX_HISTORY_ROWS) tooLarge();
    for (;;) {
      const sessions = await tx.studySession.findMany({ where: sessionWhere, select: sessionSelect, orderBy: { id: "asc" }, take: 1000, ...(lastId ? { cursor: { id: lastId }, skip: 1 } : {}) });
      for (const s of sessions) append({ format_version: 1, session_id: s.id, started_at_utc: s.startedAt.toISOString(), completed_at_utc: s.completedAt.toISOString(), total_words: s.totalWords, known_count: s.knownCount, needs_review_count: s.needsReviewCount });
      if (sessions.length < 1000) break; lastId = sessions[sessions.length - 1].id;
    }
  } else {
    const where = { session: sessionWhere } satisfies Prisma.StudySessionWordWhereInput;
    if (await tx.studySessionWord.count({ where }) > MAX_HISTORY_ROWS) tooLarge();
    for (;;) {
      const answers = await tx.studySessionWord.findMany({ where, select: { id: true, wordId: true, answer: true, answeredAt: true, session: { select: sessionSelect } }, orderBy: { id: "asc" }, take: 1000, ...(lastId ? { cursor: { id: lastId }, skip: 1 } : {}) });
      // Do not even read the text of another user's now-private card, including for ADMIN.
      const words = answers.length ? await tx.word.findMany({ where: { AND: [dictionaryWords(userId), { id: { in: [...new Set(answers.map(a => a.wordId))] } }] }, select: { id: true, german: true, article: true } }) : [];
      const accessible = new Map(words.map(w => [w.id, w]));
      for (const a of answers) {
        const word = accessible.get(a.wordId), s = a.session;
        append({ format_version: 1, session_id: s.id, started_at_utc: s.startedAt.toISOString(), completed_at_utc: s.completedAt.toISOString(), word_id: word?.id, german: word?.german, article: word?.article, answer: a.answer, answered_at_utc: a.answeredAt.toISOString(), word_available: !!word });
      }
      if (answers.length < 1000) break; lastId = answers[answers.length - 1].id;
    }
  }
  return { csv: chunks.join(""), rowCount };
}
