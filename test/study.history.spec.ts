import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { admin, userA, userB } from "./support/words-database";
import { makeLanguageStudyDatabase } from "./support/language-study-database";

describe("Paginated personal study history (HTTP with in-memory Prisma)", () => {
  let app: INestApplication;
  let url: string;
  let fixture: ReturnType<typeof makeLanguageStudyDatabase>;
  let language = "en";
  const when = "2026-11-01T12:00:00.000Z";

  function seed(id: string, owner = userA.id, startedAt = when, wordId = "shared") {
    fixture.sessions.set(id, { id, userId: owner, startedAt: new Date(startedAt), completedAt: new Date(startedAt), totalWords: 1, knownCount: 1, needsReviewCount: 0 });
    fixture.answers.set(`answer-${id}`, { id: `answer-${id}`, sessionId: id, wordId, answer: "KNOWN", answeredAt: new Date(startedAt) });
  }
  beforeEach(async () => {
    language = "en"; fixture = makeLanguageStudyDatabase(); fixture.seedWord("shared", { german: "Baum", translation: "дерево" });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const actor = token === "a".repeat(43) ? { ...userA, translationLanguage: language } : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!actor) throw new UnauthorizedException();
        return { user: actor, sessionId: `auth-${actor.id}` };
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/study/history`;
  });
  afterEach(async () => { await app?.close(); });
  const request = (path = "", actor = "a") => fetch(url + path, { headers: actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {} });

  it("requires authentication and never grants ADMIN another user's history", async () => {
    seed("session-a");
    for (const path of ["", "/session-a"]) expect((await request(path, "")).status).toBe(401);
    for (const actor of ["b", "c"]) {
      expect(await (await request("", actor)).json()).toEqual({ sessions: [], nextCursor: null });
      expect((await request("/session-a", actor)).status).toBe(404);
    }
    expect(fixture.db.studySession.create).not.toHaveBeenCalled();
    expect(fixture.db.wordProgress.upsert).not.toHaveBeenCalled();
  });

  it("returns bounded summaries without word contents or another owner's rows", async () => {
    for (let n = 0; n < 55; n++) seed(`session-${String(n).padStart(3, "0")}`);
    seed("foreign", userB.id);
    const response = await request(); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.sessions).toHaveLength(20); expect(body.nextCursor).toEqual(expect.any(String));
    expect(Object.keys(body.sessions[0]).sort()).toEqual(["completedAt", "id", "knownCount", "needsReviewCount", "startedAt", "totalWords"]);
    expect(fixture.db.studySession.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 21, where: { userId: userA.id }, select: expect.any(Object) }));
    expect((await (await request("?limit=50")).json()).sessions).toHaveLength(50);
  });

  it("pages timestamps with tied IDs in a stable order without duplicates", async () => {
    for (const id of ["s-a", "s-c", "s-b"]) seed(id);
    seed("older", userA.id, "2025-01-01T00:00:00.000Z");
    const first = await (await request("?limit=2")).json();
    expect(first.sessions.map((row: { id: string }) => row.id)).toEqual(["s-c", "s-b"]);
    const second = await (await request(`?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.sessions.map((row: { id: string }) => row.id)).toEqual(["s-a", "older"]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps paging when the anchor is removed and new sessions arrive", async () => {
    for (const id of ["s-a", "s-c", "s-b"]) seed(id);
    const first = await (await request("?limit=2")).json();
    fixture.sessions.delete("s-b"); seed("newer", userA.id, "2026-11-02T00:00:00.000Z");
    const second = await (await request(`?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.sessions.map((row: { id: string }) => row.id)).toEqual(["s-a"]);
    expect((await (await request("?limit=1")).json()).sessions[0].id).toBe("newer");
  });

  it("validates page sizes, cursors and unknown identity query parameters before reading", async () => {
    const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const query of ["?limit=0", "?limit=51", "?limit=1.5", "?limit=NaN", "?userId=user-b", "?cursor=", "?cursor=bad", "?cursor=" + "x".repeat(513),
      "?cursor=" + cursor({ id: "s-a", startedAt: "invalid" }), "?cursor=" + cursor({ id: "s-a", startedAt: when, userId: userB.id }),
    ]) expect((await request(query)).status).toBe(400);
    expect(fixture.db.studySession.findMany).not.toHaveBeenCalled();
  });

  it("treats cursors only as positions while ownership always comes from auth", async () => {
    seed("s-a"); seed("foreign", userB.id, "2027-01-01T00:00:00.000Z");
    const other = await (await request("?limit=1", "b")).json();
    expect(other.nextCursor).toBeNull();
    const forgedPosition = Buffer.from(JSON.stringify({ id: "foreign", startedAt: "2027-01-01T00:00:00.000Z" })).toString("base64url");
    const own = await (await request(`?cursor=${forgedPosition}`)).json();
    expect(own.sessions.map((row: { id: string }) => row.id)).toEqual(["s-a"]);
  });

  it("preserves original counts and history after unlinking while hiding now-private foreign cards", async () => {
    seed("s-a"); fixture.link(userA.id, "shared"); fixture.unlink(userA.id, "shared");
    let response = await request("/s-a"); let detail = await response.json();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(detail.words).toHaveLength(1); expect(detail.words[0].word.selectedTranslation).toEqual({ language: "en", text: "tree" });
    expect(fixture.db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
    Object.assign(fixture.words.get("shared")!, { publicationStatus: "REJECTED", createdByUserId: userB.id });
    response = await request("/s-a"); detail = await response.json();
    expect(response.status).toBe(200); expect(detail).toMatchObject({ totalWords: 1, knownCount: 1, needsReviewCount: 0, words: [] });
    expect(JSON.stringify(detail)).not.toContain("shared");
    expect(fixture.answers.size).toBe(1); expect(fixture.sessions.size).toBe(1);
  });

  it("presents the selected language without changing stored answers or inventing Russian fallback", async () => {
    seed("s-a"); const before = structuredClone([...fixture.answers]);
    language = "uk";
    const detail = await (await request("/s-a")).json();
    expect(detail.words[0].word.selectedTranslation).toEqual({ language: "uk", text: null });
    expect([...fixture.answers]).toEqual(before); expect(fixture.progress.size).toBe(0);
    expect(fixture.db.wordProgress.upsert).not.toHaveBeenCalled();
  });
});
