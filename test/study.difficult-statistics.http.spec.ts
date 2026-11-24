import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";
import { AuthService } from "../src/auth/auth.service";
import { admin, userA, userB } from "./support/words-database";

describe("Difficult word statistics: current private flags and bounded saved answers", () => {
  let app: INestApplication, base: string;
  const query = jest.fn();
  const empty = { words: 0n, archived: 0n, practiced: 0n, sessions: 0n, answers: 0n, known: 0n, needsReview: 0n };
  beforeEach(async () => {
    query.mockReset().mockImplementation(async (_sql, owner) => [owner === userA.id
      ? { words: 4n, archived: 1n, practiced: 3n, sessions: 2n, answers: 5n, known: 2n, needsReview: 3n } : empty]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ $queryRaw: query })
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!user) throw new UnauthorizedException(); return { user, sessionId: `auth-${user.id}` };
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/study/statistics/difficult`;
    query.mockClear();
  });
  afterEach(async () => { await app?.close(); });
  const get = (suffix = "", actor = "a") => fetch(base + suffix, { headers: actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {} });
  it("requires authentication and rejects ownership overrides and unsupported periods", async () => {
    expect((await get("", "")).status).toBe(401);
    for (const q of ["?days=8", "?days=abc", "?days=7&days=30", "?userId=other", "?page=1"]) expect((await get(q)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("reports current marks separately from period answers in one snapshot, without exposing cards", async () => {
    const r = await get("?days=7"); expect(r.status).toBe(200); expect(r.headers.get("Cache-Control")).toBe("no-store");
    const data = await r.json(); expect(data.current).toEqual({ words: 4, active: 3, archived: 1 });
    expect(data.period).toEqual({ words: 3, withoutAnswers: 1, sessions: 2, answers: 5, known: 2, needsReview: 3 });
    expect(Date.parse(data.to) - Date.parse(data.from)).toBe(7 * 86400000);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.anything(), userA.id, userA.id, userA.id, data.from, data.to);
    expect(Object.keys(data).sort()).toEqual(["current", "days", "from", "period", "to"]);
  });
  it("isolates another user and ADMIN and supports all three periods", async () => {
    for (const [actor, owner] of [["b", userB.id], ["c", admin.id]]) {
      const r = await get("?days=90", actor); expect(r.status).toBe(200);
      expect((await r.json()).current).toEqual({ words: 0, active: 0, archived: 0 });
      expect(query.mock.calls.at(-1)!.slice(1, 4)).toEqual([owner, owner, owner]);
    }
    expect((await get()).status).toBe(200);
  });
  it("rejects unsafe or inconsistent aggregates instead of reporting invented results", async () => {
    for (const row of [{ ...empty, words: 9007199254740992n }, { ...empty, archived: 1n },
      { ...empty, practiced: 1n }, { ...empty, answers: 1n }, { ...empty, needsReview: -1n }]) {
      query.mockResolvedValue([row]); expect((await get()).status).toBe(500);
    }
  });
});
