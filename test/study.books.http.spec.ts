import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";
import { AuthService } from "../src/auth/auth.service";
import { admin, userA, userB } from "./support/words-database";

describe("Book statistics: private paginated sources, authenticated HTTP", () => {
  let app: INestApplication, base: string;
  const query = jest.fn();
  beforeEach(async () => {
    query.mockReset().mockImplementation(async (sql: { values: unknown[] }) => sql.values?.includes(userA.id)
      ? [{ totalGroups: 1n, rows: [{ sourceBook: "Book A", lessonNumber: null, sessions: 2, answers: 3, known: 1, needsReview: 2, words: 2 }] }]
      : [{ totalGroups: 0n, rows: [] }]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ $queryRaw: query })
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!user) throw new UnauthorizedException(); return { user, sessionId: `auth-${user.id}` };
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/study/statistics/books`;
    query.mockClear();
  });
  afterEach(async () => { await app?.close(); });
  const get = (suffix = "", actor = "a") => fetch(base + suffix, { headers: actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {} });
  it("requires authentication and rejects invalid and ownership query parameters before a database read", async () => {
    expect((await get("", "")).status).toBe(401);
    for (const q of ["?days=8", "?page=0", "?page=1.2", "?page=100001", "?book=", "?book=%20", "?book=a&unassigned=true", "?unassigned=false", "?userId=other", "?book=a&book=b"]) expect((await get(q)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("uses exact rolling boundaries and one parameterized snapshot without exposing raw history", async () => {
    const response = await get("?days=7&page=1"); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = await response.json(); expect(data).toMatchObject({ days: 7, page: 1, pageSize: 10, totalGroups: 1, scope: "books", book: null });
    expect(Date.parse(data.to) - Date.parse(data.from)).toBe(7 * 86400000);
    const sql = query.mock.calls[0][0]; expect(sql.values).toEqual(expect.arrayContaining([userA.id, data.from, data.to, 10, 0]));
    expect(data.rows[0]).toEqual({ sourceBook: "Book A", lessonNumber: null, sessions: 2, answers: 3, known: 1, needsReview: 2, words: 2 });
  });
  it("isolates another user and ADMIN; safely binds book titles and paginates lessons", async () => {
    for (const actor of ["b", "c"]) { const r = await get("?days=90", actor); expect(r.status).toBe(200); expect((await r.json()).rows).toEqual([]); }
    query.mockResolvedValue([{ totalGroups: 0n, rows: [] }]);
    const title = "'); DROP TABLE words; --";
    const r = await get(`?book=${encodeURIComponent(title)}&page=2`); expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ scope: "lessons", book: title, page: 2 });
    const sql = query.mock.calls.at(-1)![0]; expect(sql.values).toContain(title); expect(sql.sql).not.toContain(title); expect(sql.values.at(-1)).toBe(10);
    expect((await get("?unassigned=true")).status).toBe(200);
  });
  it("rejects unsafe aggregate integers instead of silently rounding them", async () => {
    query.mockResolvedValue([{ totalGroups: 9007199254740992n, rows: [] }]); expect((await get()).status).toBe(500);
  });
});
