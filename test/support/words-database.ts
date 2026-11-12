import { personalTranslationsModel } from "./personal-translations-database";
import { Prisma } from "@prisma/client";
import { AuthUser } from "../../src/auth/auth.service";

export const userA: AuthUser = { id: "user-a", email: "a@example.com", emailVerified: null, interfaceLanguage: "ru", translationLanguage: "ru", role: "USER" };
export const userB: AuthUser = { ...userA, id: "user-b", email: "b@example.com" };
export const admin: AuthUser = { ...userA, id: "admin", email: "admin@example.com", role: "ADMIN" };

// An in-memory Prisma test double; this does not emulate PostgreSQL locking/isolation.
// Reject unknown operators so an accidentally unhandled filter cannot silently pass.
type Row = Record<string, any>;
type Args = { where?: Row; include?: Row; select?: Row; data?: Row; orderBy?: Row };

export function makeWordsDatabase() {
  const relations = new Map<string, Row>();
  const privateTranslations = new Map<string, Row>();
  const privateBooks = new Map<string, Row>();
  const words = new Map<string, Row>();
  const links = new Map<string, Row>();
  const translations = new Map<string, Row>();
  const examples = new Map<string, Row>();
  const exampleTranslations = new Map<string, Row>();
  let sequence = 0;

  function valueMatches(value: unknown, condition: any): boolean {
    if (condition === null || typeof condition !== "object") return value === condition;
    const normalize = (item: unknown) => condition.mode === "insensitive" && typeof item === "string" ? item.toLocaleLowerCase("de") : item;
    for (const [operator, expected] of Object.entries(condition)) {
      if (operator === "mode") continue;
      if (operator === "equals" && normalize(value) === normalize(expected)) continue;
      if (operator === "not" && !valueMatches(value, expected)) continue;
      if (operator === "in" && (expected as unknown[]).includes(value)) continue;
      if (operator === "contains" && typeof value === "string" && String(normalize(value)).includes(String(normalize(expected)))) continue;
      if (["equals", "not", "in", "contains"].includes(operator)) return false;
      throw new Error(`Unsupported filter: ${operator}`);
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
        const word = words.get(row.wordId); if (!word || !matches(word, condition)) return false;
      } else if (field === "bookSources") {
        if (!Object.hasOwn(condition, "some")) throw new Error("Unsupported book source filter");
        if (!(row.bookSources ?? []).some((item: Row) => matches(item, condition.some))) return false;
      } else if (field === "userWords" || field === "translations") {
        const table = field === "userWords" ? links : translations;
        const related = [...table.values()].filter((item) => item.wordId === row.id);
        if (Object.hasOwn(condition, "some")) { if (!related.some((item) => matches(item, condition.some))) return false; }
        else if (Object.hasOwn(condition, "none")) { if (related.some((item) => matches(item, condition.none))) return false; }
        else throw new Error("Unsupported relation filter");
      } else if (!valueMatches(row[field], condition)) return false;
    }
    return true;
  }

  function project(row: Row | undefined, args: Args) {
    if (!row) return null;
    if (args.select) return Object.fromEntries(Object.keys(args.select).filter((key) => args.select![key]).map((key) => [key, row[key]]));
    const result = structuredClone(row);
    if (args.include?.translations) {
      const table = row.wordId ? exampleTranslations : translations;
      result.translations = [...table.values()].filter((item) => row.wordId ? item.exampleId === row.id : item.wordId === row.id).map((item) => structuredClone(item));
    }
    if (args.include?.bookSources) result.bookSources = structuredClone(row.bookSources ?? []);
    if (args.include?.userWords) {
      const nested = args.include.userWords;
      result.userWords = [...links.values()].filter(item => item.wordId === row.id && matches(item, nested.where)).map(item => project(item, { select: nested.select }));
    }
    if (args.include?.examples) {
      result.examples = [...examples.values()].filter(item => item.wordId === row.id).map(item => project(item, { include: args.include!.examples.include }));
    }
    return result;
  }

  function seedWord(id: string, overrides: Row = {}) {
    const row = {
      id, german: "Tisch", article: "der", grammaticalNumber: "singular", translation: "стол",
      pluralForm: null, level: null, lessonNumber: null, sourceBook: null, notes: null,
      publicationStatus: "PUBLISHED", createdByUserId: null, createdAt: new Date(), updatedAt: new Date(),
      ...overrides,
    };
    words.set(id, row);
    return row;
  }

  const db = {
    personalWordBooks: {
      findMany: jest.fn(async (args: Args) => [...privateBooks.values()].filter(row => matches(row, args.where)).map(row => project(row, args))),
      findUnique: jest.fn(async (args: any) => project([...privateBooks.values()].find(row => matches(row, args.where.userId_wordId)), args)),
      create: jest.fn(async (args: Args) => { const data = structuredClone(args.data!); privateBooks.set(data.userId + ":" + data.wordId, data); return data; }),
      updateMany: jest.fn(async (args: Args) => { let count = 0; for (const row of privateBooks.values()) if (matches(row, args.where)) { Object.assign(row, structuredClone(args.data)); count++; } return { count }; }),
      deleteMany: jest.fn(async (args: Args) => { let count = 0; for (const [id, row] of privateBooks) if (matches(row, args.where)) { privateBooks.delete(id); count++; } return { count }; }),
    },
    wordRelation: {
      findMany: jest.fn(async (args: Args) => [...relations.values()].filter(row => matches(row, args.where))),
      upsert: jest.fn(async (args: any) => {
        const pair = args.where.leftWordId_rightWordId;
        const key = pair.leftWordId + ":" + pair.rightWordId;
        if (!relations.has(key)) relations.set(key, { ...args.create });
        return structuredClone(relations.get(key));
      }),
    },
    personalWordTranslation: personalTranslationsModel(privateTranslations, matches),
    word: {
      findMany: jest.fn(async (args: Args = {}) => [...words.values()].filter((row) => matches(row, args.where)).map((row) => project(row, args))),
      findFirst: jest.fn(async (args: Args) => project([...words.values()].find((row) => matches(row, args.where)), args)),
      create: jest.fn(async (args: Args) => {
        const { translations: nestedTranslations, examples: nestedExamples, userWords: nestedLinks, ...data } = args.data!;
        const id = `word-${++sequence}`;
        const row = seedWord(id, data);
        if (nestedTranslations) {
          for (const entry of (Array.isArray(nestedTranslations.create) ? nestedTranslations.create : [nestedTranslations.create])) {
            const translation = { id: `translation-${++sequence}`, wordId: id, ...entry };
            translations.set(translation.id, translation);
          }
        }
        for (const example of nestedExamples?.create ?? []) await db.wordExample.create({ data: { wordId: id, ...example } });
        if (nestedLinks) {
          const link = { id: `link-${++sequence}`, isFavorite: false, isArchived: false, revision: `entry-${sequence}`, wordId: id, createdAt: new Date(), ...nestedLinks.create };
          links.set(link.id, link);
        }
        return project(row, args);
      }),
      updateMany: jest.fn(async (args: Args) => {
        let count = 0;
        for (const row of words.values()) if (matches(row, args.where)) { Object.assign(row, args.data, { updatedAt: new Date() }); count += 1; }
        return { count };
      }),
      update: jest.fn(async (args: Args) => {
        const row = [...words.values()].find((item) => matches(item, args.where));
        if (!row) throw new Error("Missing word");
        Object.assign(row, args.data, { updatedAt: new Date() });
        return project(row, args);
      }),
      delete: jest.fn(() => { throw new Error("Global word deletion is forbidden in this stage"); }),
    },
    userWord: {
      createMany: jest.fn(async (args: { data: Row[]; skipDuplicates: boolean }) => {
        let count = 0;
        for (const data of args.data) {
          const existing = [...links.values()].some(row => row.userId === data.userId && row.wordId === data.wordId);
          if (existing && args.skipDuplicates) continue;
          if (existing) throw new Error("Duplicate dictionary entry");
          const link = { id: `link-${++sequence}`, isFavorite: false, isArchived: false, revision: `entry-${sequence}`, createdAt: new Date(), ...data };
          links.set(link.id, link); count++;
        }
        return { count };
      }),
      findUnique: jest.fn(async (args: any) => project([...links.values()].find(row => matches(row, args.where.userId_wordId)), args)),
      updateMany: jest.fn(async (args: Args) => { let count = 0; for (const row of links.values()) if (matches(row, args.where)) { Object.assign(row, args.data); count++; } return { count }; }),
      upsert: jest.fn(async (args: { where: Row; create: Row; update: Row }) => {
        const existing = [...links.values()].find((row) => matches(row, args.where.userId_wordId));
        if (existing) return structuredClone(existing);
        const link = { id: `link-${++sequence}`, isFavorite: false, isArchived: false, revision: `entry-${sequence}`, createdAt: new Date(), ...args.create };
        links.set(link.id, link);
        return structuredClone(link);
      }),
      deleteMany: jest.fn(async (args: Args) => {
        let count = 0;
        for (const [id, row] of links) if (matches(row, args.where)) { links.delete(id); count += 1; }
        return { count };
      }),
    },
    wordExampleTranslation: {
      deleteMany: jest.fn(async (args: Args) => {
        let count = 0;
        for (const [id, row] of exampleTranslations) if (matches(row, args.where)) { exampleTranslations.delete(id); count++; }
        return { count };
      }),
      upsert: jest.fn(async (args: { where: Row; create: Row; update: Row }) => {
        const existing = [...exampleTranslations.values()].find((row) => matches(row, args.where.exampleId_language));
        if (existing) { Object.assign(existing, args.update); return structuredClone(existing); }
        const row = { id: `example-translation-${++sequence}`, ...args.create }; exampleTranslations.set(row.id, row); return structuredClone(row);
      }),
    },
    wordTranslation: {
      deleteMany: jest.fn(async (args: Args) => {
        let count = 0;
        for (const [id, row] of translations) if (matches(row, args.where)) { translations.delete(id); count++; }
        return { count };
      }),
      upsert: jest.fn(async (args: { where: Row; create: Row; update: Row }) => {
        const existing = [...translations.values()].find((row) => matches(row, args.where.wordId_language));
        if (existing) { Object.assign(existing, args.update); return structuredClone(existing); }
        const row = { id: `translation-${++sequence}`, ...args.create };
        translations.set(row.id, row);
        return structuredClone(row);
      }),
    },
    wordExample: {
      findMany: jest.fn(async (args: Args) => [...examples.values()].filter((row) => matches(row, args.where)).map((row) => project(row, args))),
      findFirst: jest.fn(async (args: Args) => project([...examples.values()].find((row) => matches(row, args.where)), args)),
      create: jest.fn(async (args: Args) => {
        const { translations: nested, ...data } = args.data!;
        const row = { id: `example-${++sequence}`, ...data };
        examples.set(row.id, row);
        for (const entry of nested?.create ?? []) await db.wordExampleTranslation.upsert({ where: { exampleId_language: { exampleId: row.id, language: entry.language } }, create: { exampleId: row.id, ...entry }, update: {} });
        return project(row, args);
      }),
      updateMany: jest.fn(async (args: Args) => {
        let count = 0;
        for (const row of examples.values()) if (matches(row, args.where)) { Object.assign(row, args.data); count += 1; }
        return { count };
      }),
      deleteMany: jest.fn(async (args: Args) => {
        let count = 0;
        for (const [id, row] of examples) if (matches(row, args.where)) { examples.delete(id); count += 1; }
        return { count };
      }),
    },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>, options?: Row) => {
    if (options?.isolationLevel !== Prisma.TransactionIsolationLevel.Serializable) throw new Error("Expected serializable transaction");
    const tables = [privateBooks, words, links, translations, examples, exampleTranslations, privateTranslations, relations];
    const snapshots = tables.map((table) => structuredClone([...table.entries()]));
    try { return await work(db); }
    catch (error) {
      tables.forEach((table, index) => { table.clear(); for (const [id, row] of snapshots[index]) table.set(id, row); });
      throw error;
    }
  });
  return { db, relations, privateTranslations, privateBooks, words, links, translations, examples, exampleTranslations, seedWord };
}
