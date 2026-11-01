import { Prisma } from "@prisma/client";

type Row = Record<string, any>;
type Args = { where?: Row; include?: Row; select?: Row; data?: Row; orderBy?: Row | Row[]; take?: number };

// Test persistence only: PostgreSQL isolation and contention require a real DB check.
export function makeStudyDatabase() {
  const words = new Map<string, Row>();
  const links = new Map<string, Row>();
  const progress = new Map<string, Row>();
  const sessions = new Map<string, Row>();
  const answers = new Map<string, Row>();
  let sequence = 0;

  function valueMatches(value: unknown, condition: any): boolean {
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (condition === null || typeof condition !== "object") return value === condition;
    for (const [operator, expected] of Object.entries(condition)) {
      if (operator === "lt" && value != null && (value as any) < (expected as any)) continue;
      if (operator === "in" && (expected as unknown[]).includes(value)) continue;
      if (operator === "lte" && value != null && (value as Date) <= (expected as Date)) continue;
      if (operator === "gte" && value != null && (value as Date) >= (expected as Date)) continue;
      if (["in", "lte", "gte", "lt"].includes(operator)) return false;
      throw new Error(`Unhandled value filter: ${operator}`);
    }
    return true;
  }

  function matches(row: Row, where: Row = {}): boolean {
    for (const [field, condition] of Object.entries(where)) {
      if (field === "AND") {
        if (!(Array.isArray(condition) ? condition : [condition]).every((item) => matches(row, item))) return false;
      } else if (field === "OR") {
        if (!condition.some((item: Row) => matches(row, item))) return false;
      } else if (field === "word") {
        const word = words.get(row.wordId);
        if (!word || !matches(word, condition)) return false;
      } else if (field === "userWords" || field === "progress") {
        const table = field === "userWords" ? links : progress;
        const related = [...table.values()].filter((item) => item.wordId === row.id);
        if (Object.hasOwn(condition, "some")) {
          if (!related.some((item) => matches(item, condition.some))) return false;
        } else if (Object.hasOwn(condition, "none")) {
          if (related.some((item) => matches(item, condition.none))) return false;
        } else throw new Error("Unhandled relation filter");
      } else if (!valueMatches(row[field], condition)) return false;
    }
    return true;
  }

  function ordered(rows: Row[], orderBy?: Row | Row[]) {
    if (!orderBy) return rows;
    const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
    return rows.sort((left, right) => {
      for (const order of orders) for (const [key, direction] of Object.entries(order)) {
        const a = left[key] instanceof Date ? left[key].getTime() : left[key];
        const b = right[key] instanceof Date ? right[key].getTime() : right[key];
        if (a === b) continue;
        return (a < b ? -1 : 1) * (direction === "desc" ? -1 : 1);
      }
      return 0;
    });
  }

  function projectWord(row: Row, args: Args = {}) {
    if (args.select) return Object.fromEntries(Object.keys(args.select).filter((key) => args.select![key]).map((key) => [key, row[key]]));
    const result = structuredClone(row);
    if (args.include?.translations) result.translations = [{ id: `ru-${row.id}`, wordId: row.id, language: "ru", text: row.translation }];
    return result;
  }

  function projectProgress(row: Row, args: Args) {
    const result = structuredClone(row);
    if (args.include?.word) result.word = projectWord(words.get(row.wordId)!, args.include.word === true ? {} : args.include.word);
    return result;
  }

  function projectSession(row: Row, args: Args) {
    if (args.select) return Object.fromEntries(Object.keys(args.select).filter((key) => args.select![key]).map((key) => [key, row[key]]));
    const result = structuredClone(row);
    if (args.include?.words) {
      const nested = args.include.words === true ? {} : args.include.words;
      result.words = [...answers.values()].filter((answer) => answer.sessionId === row.id && matches(answer, nested.where)).map((answer) => {
        const item = structuredClone(answer);
        if (nested.include?.word) item.word = projectWord(words.get(answer.wordId)!, nested.include.word === true ? {} : nested.include.word);
        return item;
      });
    }
    return result;
  }

  function seedWord(id: string, overrides: Row = {}) {
    const row = {
      id, german: id, article: "der", grammaticalNumber: "singular", translation: `перевод ${id}`,
      pluralForm: null, level: null, lessonNumber: null, notes: null,
      publicationStatus: "PUBLISHED", createdByUserId: null, createdAt: new Date(), updatedAt: new Date(), ...overrides,
    };
    words.set(id, row);
    return row;
  }

  function link(userId: string, wordId: string) {
    const row = { id: `link-${++sequence}`, userId, wordId, createdAt: new Date() };
    links.set(row.id, row);
    return row;
  }

  function seedProgress(userId: string, wordId: string, overrides: Row = {}) {
    const row = {
      id: `progress-${++sequence}`, userId, wordId, knownCount: 0, needsReviewCount: 0,
      consecutiveKnown: 0, currentIntervalDays: 0, lastReviewedAt: null, nextReviewAt: null, updatedAt: new Date(), ...overrides,
    };
    progress.set(row.id, row);
    return row;
  }

  const db = {
    user: { findUnique: jest.fn(async (_args: unknown) => ({ timeZone: "UTC", dailyGoal: 10 })) },
    word: {
      findMany: jest.fn(async (args: Args = {}) => ordered([...words.values()].filter((row) => matches(row, args.where)), args.orderBy).map((row) => projectWord(row, args))),
      count: jest.fn(async (args: Args = {}) => [...words.values()].filter((row) => matches(row, args.where)).length),
    },
    studySession: {
      findMany: jest.fn(async (args: Args = {}) => ordered([...sessions.values()].filter((row) => matches(row, args.where)), args.orderBy).slice(0, args.take).map((row) => projectSession(row, args))),
      findFirst: jest.fn(async (args: Args) => {
        const row = [...sessions.values()].find((item) => matches(item, args.where));
        return row ? projectSession(row, args) : null;
      }),
      count: jest.fn(async (args: Args = {}) => [...sessions.values()].filter((row) => matches(row, args.where)).length),
      create: jest.fn(async (args: Args) => {
        const { words: nested, ...data } = args.data!;
        const id: string = data.id ?? `session-${++sequence}`;
        if (sessions.has(id)) throw new Prisma.PrismaClientKnownRequestError("Unique", { code: "P2002", clientVersion: "6.19.3" });
        const row = { id, startedAt: new Date(), completedAt: new Date(), ...data };
        sessions.set(id, row);
        for (const answer of nested.create) {
          const item = { id: `answer-${++sequence}`, sessionId: id, answeredAt: new Date(), ...answer };
          answers.set(item.id, item);
        }
        return projectSession(row, args);
      }),
    },
    wordProgress: {
      findMany: jest.fn(async (args: Args = {}) => ordered([...progress.values()].filter((row) => matches(row, args.where)), args.orderBy).map((row) => projectProgress(row, args))),
      count: jest.fn(async (args: Args = {}) => [...progress.values()].filter((row) => matches(row, args.where)).length),
      upsert: jest.fn(async (args: { where: Row; create: Row; update: Row }) => {
        if (!args.where.userId_wordId) throw new Error("Expected a personal progress key");
        const row = [...progress.values()].find((item) => matches(item, args.where.userId_wordId));
        if (!row) return structuredClone(seedProgress(args.create.userId, args.create.wordId, args.create));
        for (const [key, value] of Object.entries(args.update)) {
          row[key] = typeof value === "object" && value !== null && Object.hasOwn(value, "increment") ? row[key] + (value as Row).increment : value;
        }
        row.updatedAt = new Date();
        return structuredClone(row);
      }),
    },
    $transaction: jest.fn(),
  };

  db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>, options?: Row) => {
    if (!["Serializable", "RepeatableRead"].includes(options?.isolationLevel)) throw new Error("Expected snapshot or serializable transaction");
    const tables = [words, links, progress, sessions, answers];
    const snapshots = tables.map((table) => structuredClone([...table.entries()]));
    try { return await work(db); }
    catch (error) {
      tables.forEach((table, index) => { table.clear(); for (const [id, row] of snapshots[index]) table.set(id, row); });
      throw error;
    }
  });

  const progressFor = (userId: string, wordId: string) => [...progress.values()].find((row) => row.userId === userId && row.wordId === wordId);
  const unlink = (userId: string, wordId: string) => { for (const [id, row] of links) if (row.userId === userId && row.wordId === wordId) links.delete(id); };
  return { db, words, links, progress, sessions, answers, seedWord, link, unlink, seedProgress, progressFor };
}
