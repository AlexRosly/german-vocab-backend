import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";
import { AuthService } from "../src/auth/auth.service";
import { admin, userA, userB } from "./support/words-database";

describe("Study statistics: authenticated aggregate without vocabulary access", () => {
  let app: INestApplication;
  let base: string;
  const groupBy = jest.fn();
  const dailyQuery = jest.fn();
  const transaction = jest.fn();
  beforeEach(async () => {
    groupBy.mockReset().mockImplementation(async ({ where }) => where.userId === userA.id ? [
      { mode: "spelling", _count: { _all: 2 }, _sum: { totalWords: 7, knownCount: 4, needsReviewCount: 3 } },
      { mode: null, _count: { _all: 1 }, _sum: { totalWords: 2, knownCount: 1, needsReviewCount: 1 } },
    ] : []);
    dailyQuery.mockReset().mockImplementation(async (_sql, zone, owner, from, to) => {
      if (owner !== userA.id) return [];
      const date = (s: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s));
      return [
        { date: date(from), sessions: 2n, answers: 7n, known: 4n, needsReview: 3n },
        { date: date(to), sessions: 1n, answers: 2n, known: 1n, needsReview: 1n },
      ];
    });
    const db = { studySession: { groupBy }, user: { findUnique: jest.fn().mockResolvedValue({ timeZone: "Europe/Berlin" }) }, $queryRaw: dailyQuery, $transaction: transaction };
    transaction.mockReset().mockImplementation(async fn => fn(db));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!user) throw new UnauthorizedException();
        return { user, sessionId: `auth-${user.id}` };
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/study/statistics`;
  });
  afterEach(async () => { await app?.close(); });
  const get = (query = "", actor = "a") => fetch(base + query, { headers: actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {} });

  it("requires authentication and rejects extra ownership parameters and unsupported periods", async () => {
    expect((await get("", "")).status).toBe(401);
    for (const q of ["?days=0", "?days=31", "?days=abc", "?days=7&days=30", "?userId=other"]) expect((await get(q)).status).toBe(400);
    expect(groupBy).not.toHaveBeenCalled();
  });
  it("includes legacy unknown modes, labels repeated answers as answers and uses a bounded rolling interval", async () => {
    const response = await get(); expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = await response.json(); expect(response.status).toBe(200);
    expect(data.days).toBe(30); expect(Date.parse(data.to) - Date.parse(data.from)).toBe(30 * 86400000);
    expect(data.totals).toEqual({ sessions: 3, answers: 9, known: 5, needsReview: 4 });
    expect(data.byMode.map((r: { mode: string | null }) => r.mode)).toEqual(["forward", "reverse", "article", "plural", "spelling", null]);
    expect(data.byMode[5].answers).toBe(2);
    expect(data.activity.timeZone).toBe("Europe/Berlin");
    expect(data.activity.activeDays).toBe(2);
    expect(data.activity.days.reduce((sum: number, row: { answers: number }) => sum + row.answers, 0)).toBe(9);
    expect(data.activity.days.some((row: { sessions: number }) => row.sessions === 0)).toBe(true);
    expect(dailyQuery).toHaveBeenCalledWith(expect.anything(), "Europe/Berlin", userA.id, data.from, data.to);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 15000 });
    expect(groupBy).toHaveBeenCalledWith({ by: ["mode"], where: { userId: userA.id, completedAt: { gte: new Date(data.from), lte: new Date(data.to) } },
      _count: { _all: true }, _sum: { totalWords: true, knownCount: true, needsReviewCount: true } });
  });
  it("isolates both another user and the administrator and returns empty counters", async () => {
    for (const [actor, id] of [["b", userB.id], ["c", admin.id]]) {
      const r = await get("?days=7", actor); expect(r.status).toBe(200);
      expect((await r.json()).totals).toEqual({ sessions: 0, answers: 0, known: 0, needsReview: 0 });
      expect(groupBy.mock.calls.at(-1)![0].where.userId).toBe(id);
    }
    expect((await get("?days=90")).status).toBe(200);
  });
});
