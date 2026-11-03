import { Prisma } from "@prisma/client";
type Row = Record<string, any>;
export function personalTranslationsModel(rows: Map<string, Row>, matches: (row: Row, where?: Row) => boolean) {
  const key = (row: Row) => `${row.userId}:${row.wordId}:${row.language}`;
  return {
    findMany: jest.fn(async ({ where }: any) => [...rows.values()].filter(row => matches(row, where)).map(row => ({ ...row }))),
    findUnique: jest.fn(async ({ where }: any) => rows.get(key(where.userId_wordId_language)) ?? null),
    create: jest.fn(async ({ data }: any) => { if (rows.has(key(data))) throw new Prisma.PrismaClientKnownRequestError("Unique", { code: "P2002", clientVersion: "6.19.3" }); rows.set(key(data), { ...data }); return data; }),
    updateMany: jest.fn(async ({ where, data }: any) => { const row = rows.get(key(where)); if (!row || !matches(row, where)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    deleteMany: jest.fn(async ({ where }: any) => { const row = rows.get(key(where)); if (!row || !matches(row, where)) return { count: 0 }; rows.delete(key(where)); return { count: 1 }; }),
  };
}
