import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

export const STATISTICS_MODES = ["forward", "reverse", "article", "plural", "spelling", null] as const;

@Injectable()
export class StudyStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, days = 30) {
    if (![7, 30, 90].includes(days)) throw new BadRequestException("Некорректный период статистики");
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const groups = await this.prisma.studySession.groupBy({
      by: ["mode"],
      where: { userId, completedAt: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { totalWords: true, knownCount: true, needsReviewCount: true },
    });
    const byMode = STATISTICS_MODES.map(mode => {
      const group = groups.find(row => row.mode === mode);
      return { mode, sessions: group?._count._all ?? 0, answers: group?._sum.totalWords ?? 0,
        known: group?._sum.knownCount ?? 0, needsReview: group?._sum.needsReviewCount ?? 0 };
    });
    const totals = byMode.reduce((sum, row) => ({ sessions: sum.sessions + row.sessions, answers: sum.answers + row.answers,
      known: sum.known + row.known, needsReview: sum.needsReview + row.needsReview }),
      { sessions: 0, answers: 0, known: 0, needsReview: 0 });
    return { days, from: from.toISOString(), to: to.toISOString(), totals, byMode };
  }
}
