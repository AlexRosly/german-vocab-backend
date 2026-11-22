import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { canonicalTimeZone, localDay, localDayFormatter } from "../preferences/study-preferences";

export const STATISTICS_MODES = ["forward", "reverse", "article", "plural", "spelling", null] as const;
type Counts = { sessions: number; answers: number; known: number; needsReview: number };
type DailyRow = { date: string; sessions: bigint; answers: bigint; known: bigint; needsReview: bigint };
const emptyCounts = (): Counts => ({ sessions: 0, answers: 0, known: 0, needsReview: 0 });

export function statisticsDates(timeZone: string, from: Date, to: Date): string[] {
  const formatter = localDayFormatter(timeZone);
  const last = localDay(formatter, to);
  const cursor = new Date(`${localDay(formatter, from)}T00:00:00.000Z`);
  const dates: string[] = [];
  for (let date = cursor.toISOString().slice(0, 10); date <= last; date = cursor.toISOString().slice(0, 10)) {
    dates.push(date); cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

@Injectable()
export class StudyStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, days = 30) {
    if (![7, 30, 90].includes(days)) throw new BadRequestException("Некорректный период статистики");
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return this.prisma.$transaction(async tx => {
      const preferences = await tx.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
      if (!preferences) throw new NotFoundException("Пользователь не найден");
      const timeZone = canonicalTimeZone(preferences.timeZone);
      const groups = await tx.studySession.groupBy({
        by: ["mode"], where: { userId, completedAt: { gte: from, lte: to } },
        _count: { _all: true }, _sum: { totalWords: true, knownCount: true, needsReviewCount: true },
      });
      // Prisma stores these TIMESTAMP(3) values as UTC without a timezone.
      // Explicit conversions keep both filtering and local dates independent of the PostgreSQL session timezone.
      const daily = await tx.$queryRaw<DailyRow[]>`
        SELECT to_char(("completedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS date,
          count(*)::bigint AS sessions, sum("totalWords")::bigint AS answers,
          sum("knownCount")::bigint AS known, sum("needsReviewCount")::bigint AS "needsReview"
        FROM public.study_sessions
        WHERE "userId" = ${userId}
          AND "completedAt" >= (CAST(${from.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')
          AND "completedAt" <= (CAST(${to.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')
        GROUP BY 1 ORDER BY 1`;
      const byMode = STATISTICS_MODES.map(mode => {
        const group = groups.find(row => row.mode === mode);
        return { mode, sessions: group?._count._all ?? 0, answers: group?._sum.totalWords ?? 0,
          known: group?._sum.knownCount ?? 0, needsReview: group?._sum.needsReviewCount ?? 0 };
      });
      const totals = byMode.reduce((sum, row) => ({ sessions: sum.sessions + row.sessions, answers: sum.answers + row.answers,
        known: sum.known + row.known, needsReview: sum.needsReview + row.needsReview }), emptyCounts());
      const byDate = new Map(daily.map(row => [row.date, row]));
      const activityDays = statisticsDates(timeZone, from, to).map(date => {
        const row = byDate.get(date);
        const counts = row ? { sessions: Number(row.sessions), answers: Number(row.answers), known: Number(row.known), needsReview: Number(row.needsReview) } : emptyCounts();
        if (Object.values(counts).some(n => !Number.isSafeInteger(n) || n < 0)) throw new InternalServerErrorException();
        return { date, ...counts };
      });
      return { days, from: from.toISOString(), to: to.toISOString(), totals, byMode,
        activity: { timeZone, activeDays: activityDays.filter(row => row.sessions > 0).length, days: activityDays } };
    }, { isolationLevel: "RepeatableRead", timeout: 15000 });
  }
}
