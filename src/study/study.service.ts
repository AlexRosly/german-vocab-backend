import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma, StudyAnswer } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { dictionaryWords, WORD_INCLUDE } from "../words/word-access.service";
import { CreateStudySessionDto, StudySessionWordDto } from "./dto/create-study-session.dto";

import { historyCursor, readHistoryCursor } from "./history-cursor";
import { canonicalTimeZone, localDay, localDayFormatter } from "../preferences/study-preferences";
import { StudyHistoryQueryDto } from "./dto/study-history-query.dto";

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVALS = [1, 3, 7, 14, 30];

function personalWords(userId: string): Prisma.WordWhereInput {
  return { AND: [
    { userWords: { some: { userId } } },
    dictionaryWords(userId),
  ] };
}

function sessionInclude(userId: string) {
  return {
    words: {
      // Retain history after unlinking, but do not reveal a now-private foreign card.
      where: { word: dictionaryWords(userId) },
      include: { word: { include: WORD_INCLUDE } },
    },
  } satisfies Prisma.StudySessionInclude;
}

function answerSignature(words: readonly { wordId: string; answer: StudyAnswer }[]): string {
  return JSON.stringify(words.map((item) => [item.wordId, item.answer]).sort((a, b) => a[0].localeCompare(b[0])));
}

@Injectable()
export class StudyService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(userId: string, dto: CreateStudySessionDto, requestKey?: string) {
    this.validateSession(dto);
    if (requestKey !== undefined && (typeof requestKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(requestKey))) {
      throw new BadRequestException("Idempotency-Key должен содержать 8–128 символов: буквы, цифры, . _ : -");
    }

    // A deterministic, user-scoped primary key supports retries without a schema change.
    const sessionId = requestKey === undefined ? undefined :
      "study-" + createHash("sha256").update(JSON.stringify([userId, requestKey])).digest("hex");

    return this.writeTransaction(async (tx) => {
      if (sessionId) {
        const previous = await tx.studySession.findFirst({
          where: { id: sessionId, userId },
          include: { words: true },
        });
        if (previous) {
          if (previous.totalWords !== dto.totalWords || answerSignature(previous.words) !== answerSignature(dto.words)) {
            throw new ConflictException("Этот Idempotency-Key уже использован для другой сессии");
          }
          return this.getSession(tx, userId, sessionId);
        }
      }

      const wordIds = dto.words.map((item) => item.wordId);
      const availableWords = await tx.word.findMany({
        where: { AND: [{ id: { in: wordIds } }, personalWords(userId)] },
        select: { id: true },
      });
      if (availableWords.length !== wordIds.length) {
        throw new NotFoundException("Одно или несколько слов недоступны в вашем личном словаре");
      }

      const now = new Date();
      const knownCount = dto.words.filter((item) => item.answer === "KNOWN").length;
      const session = await tx.studySession.create({
        data: {
          ...(sessionId ? { id: sessionId } : {}),
          userId,
          totalWords: dto.totalWords,
          knownCount,
          needsReviewCount: dto.words.length - knownCount,
          words: { create: dto.words.map((item) => ({ wordId: item.wordId, answer: item.answer })) },
        },
      });

      const previousProgress = await tx.wordProgress.findMany({
        where: { userId, wordId: { in: wordIds } },
      });
      const progressByWordId = new Map(previousProgress.map((item) => [item.wordId, item]));

      for (const item of dto.words) {
        const previous = progressByWordId.get(item.wordId);
        const isKnown = item.answer === "KNOWN";
        const consecutiveKnown = isKnown ? (previous?.consecutiveKnown ?? 0) + 1 : 0;
        const intervalDays = isKnown ? INTERVALS[Math.min(consecutiveKnown - 1, INTERVALS.length - 1)] : 1;
        const schedule = {
          consecutiveKnown,
          currentIntervalDays: intervalDays,
          lastReviewedAt: now,
          nextReviewAt: new Date(now.getTime() + intervalDays * DAY_MS),
        };
        await tx.wordProgress.upsert({
          where: { userId_wordId: { userId, wordId: item.wordId } },
          create: {
            userId,
            wordId: item.wordId,
            knownCount: isKnown ? 1 : 0,
            needsReviewCount: isKnown ? 0 : 1,
            ...schedule,
          },
          update: {
            knownCount: { increment: isKnown ? 1 : 0 },
            needsReviewCount: { increment: isKnown ? 0 : 1 },
            ...schedule,
          },
        });
      }
      return this.getSession(tx, userId, session.id);
    });
  }

  async getDueWords(userId: string) {
    const words = await this.prisma.wordProgress.findMany({
      where: { userId, word: personalWords(userId), nextReviewAt: { lte: new Date() } },
      include: { word: { include: WORD_INCLUDE } },
      orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "asc" }],
    });
    return {
      dueCount: words.length,
      words: words.map((item) => ({
        ...item.word,
        progress: {
          knownCount: item.knownCount,
          needsReviewCount: item.needsReviewCount,
          consecutiveKnown: item.consecutiveKnown,
          currentIntervalDays: item.currentIntervalDays,
          lastReviewedAt: item.lastReviewedAt,
          nextReviewAt: item.nextReviewAt,
        },
      })),
    };
  }

  getSessions(userId: string) {
    return this.prisma.studySession.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      include: sessionInclude(userId),
    });
  }

  async getHistory(userId: string, query: StudyHistoryQueryDto) {
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BadRequestException("Некорректный размер страницы истории");
    const after = query.cursor === undefined ? null : readHistoryCursor(query.cursor);
    const rows = await this.prisma.studySession.findMany({
      where: { userId, ...(after ? { OR: [
        { startedAt: { lt: after.startedAt } },
        { startedAt: after.startedAt, id: { lt: after.id } },
      ] } : {}) },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, totalWords: true, knownCount: true, needsReviewCount: true, startedAt: true, completedAt: true },
    });
    const sessions = rows.slice(0, limit);
    return { sessions, nextCursor: rows.length > limit ? historyCursor(sessions[sessions.length - 1]) : null };
  }

  getHistorySession(userId: string, id: string) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new BadRequestException("Некорректный идентификатор тренировки");
    return this.prisma.$transaction((tx) => this.getSession(tx, userId, id), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  getProgress(userId: string) {
    const now = new Date();
    const activeProgress: Prisma.WordProgressWhereInput = { userId, word: personalWords(userId) };

    return this.prisma.$transaction(async (tx) => {
      const preferences = await tx.user.findUnique({ where: { id: userId }, select: { timeZone: true, dailyGoal: true } });
      if (!preferences) throw new NotFoundException("Пользователь не найден");
      const timeZone = canonicalTimeZone(preferences.timeZone);
      const formatter = localDayFormatter(timeZone);
      const studyDate = localDay(formatter, now);
      const [totalSessions, progressRows, wordCount, dueCount] = await Promise.all([
        tx.studySession.count({ where: { userId } }),
        tx.wordProgress.findMany({
          where: activeProgress,
          include: { word: { include: WORD_INCLUDE } },
          orderBy: { updatedAt: "desc" },
        }),
        tx.word.count({ where: personalWords(userId) }),
        tx.wordProgress.count({ where: { ...activeProgress, nextReviewAt: { lte: now } } }),
      ]);
      return {
        totalSessions,
        totalWordsInDictionary: wordCount,
        wordsWithProgress: progressRows.length,
        studiedToday: progressRows.filter((row) => row.lastReviewedAt && row.lastReviewedAt <= now && localDay(formatter, row.lastReviewedAt) === studyDate).length,
        timeZone,
        dailyGoal: preferences.dailyGoal,
        studyDate,
        dueCount,
        knownAnswers: progressRows.reduce((sum, row) => sum + row.knownCount, 0),
        needsReviewAnswers: progressRows.reduce((sum, row) => sum + row.needsReviewCount, 0),
        words: progressRows,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 20_000 });
  }

  async getNewWords(userId: string) {
    const words = await this.prisma.word.findMany({
      where: { AND: [personalWords(userId), { progress: { none: { userId } } }] },
      include: WORD_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return { count: words.length, words };
  }

  private async getSession(tx: Prisma.TransactionClient, userId: string, id: string) {
    const session = await tx.studySession.findFirst({ where: { id, userId }, include: sessionInclude(userId) });
    if (!session) throw new NotFoundException("Сессия не найдена");
    return session;
  }

  private validateSession(dto: CreateStudySessionDto): void {
    if (
      !dto || !Number.isInteger(dto.totalWords) || dto.totalWords < 1 || dto.totalWords > 500 ||
      !Array.isArray(dto.words) || dto.words.length !== dto.totalWords
    ) {
      throw new BadRequestException("totalWords должен совпадать с количеством ответов от 1 до 500");
    }
    const words: StudySessionWordDto[] = dto.words;
    if (words.some((item) => !item || typeof item.wordId !== "string" || item.wordId.length > 191 || !/^\S+$/u.test(item.wordId))) {
      throw new BadRequestException("Каждое слово должно иметь непустой wordId без пробелов");
    }
    if (new Set(words.map((item) => item.wordId)).size !== words.length) {
      throw new BadRequestException("Каждое слово должно иметь уникальный wordId");
    }
    if (words.some((item) => item.answer !== "KNOWN" && item.answer !== "NEEDS_REVIEW")) {
      throw new BadRequestException("Недопустимый ответ по слову");
    }
  }

  private async writeTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        });
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002");
        if (!retryable) throw error;
        if (attempt === 2) throw new ConflictException("Конфликт одновременного сохранения. Повторите запрос");
      }
    }
    throw new ConflictException("Повторите запрос");
  }
}
