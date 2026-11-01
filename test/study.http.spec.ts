import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { admin, userA, userB } from "./support/words-database";
import { makeStudyDatabase } from "./support/study-database";

const body = (wordId = "shared", answer = "KNOWN") => ({ totalWords: 1, words: [{ wordId, answer }] });

describe("Personal study HTTP (full AppModule, mocked persistence)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let fixture: ReturnType<typeof makeStudyDatabase>;

  beforeEach(async () => {
    fixture = makeStudyDatabase();
    fixture.seedWord("shared"); fixture.link(userA.id, "shared"); fixture.link(userB.id, "shared");
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!user) throw new UnauthorizedException();
        return { user, sessionId: `auth-session-${user.id}` };
      } })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  afterEach(async () => { await app?.close(); });

  function request(path: string, method = "GET", payload?: unknown, actor = "a", key?: string) {
    return fetch(`${baseUrl}/study/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {}),
        ...(key === undefined ? {} : { "Idempotency-Key": key }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  it("loads the complete application and protects every study route", async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    for (const path of ["sessions", "progress", "due", "new"]) {
      expect((await request(path, "GET", undefined, "")).status).toBe(401);
      expect((await request(path, "GET", undefined, "z")).status).toBe(401);
    }
    expect((await request("sessions", "POST", body(), "")).status).toBe(401);
    expect(fixture.db.word.findMany).not.toHaveBeenCalled();
    expect(fixture.db.studySession.create).not.toHaveBeenCalled();
    expect((await fetch(`${baseUrl}/words`)).status).toBe(401);
  });

  it("records the authenticated user's session and isolates another user's progress/history", async () => {
    const first = await request("sessions", "POST", body());
    expect(first.status).toBe(201);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    const saved = await first.json();
    expect(saved).toMatchObject({ userId: userA.id, totalWords: 1, knownCount: 1, needsReviewCount: 0 });
    expect(saved.words[0].word.id).toBe("shared");
    expect(await (await request("sessions", "GET", undefined, "b")).json()).toEqual([]);
    expect((await (await request("progress", "GET", undefined, "b")).json()).wordsWithProgress).toBe(0);
    expect((await request("sessions", "POST", body("shared", "NEEDS_REVIEW"), "b")).status).toBe(201);
    const historyA = await (await request("sessions")).json();
    const historyB = await (await request("sessions", "GET", undefined, "b")).json();
    expect(historyA).toHaveLength(1);
    expect(historyB).toHaveLength(1);
    expect(historyA[0].userId).toBe(userA.id);
    expect(historyB[0].userId).toBe(userB.id);
    expect((await (await request("progress")).json()).knownAnswers).toBe(1);
    expect((await (await request("progress", "GET", undefined, "b")).json()).needsReviewAnswers).toBe(1);
  });

  it("takes identity only from auth even when query parameters specify another user", async () => {
    await request("sessions", "POST", body("shared", "NEEDS_REVIEW"), "b");
    const progress = await (await request("progress?userId=user-b")).json();
    expect(progress).toMatchObject({ totalSessions: 0, knownAnswers: 0, needsReviewAnswers: 0, wordsWithProgress: 0 });
    expect(await (await request("sessions?userId=user-b")).json()).toEqual([]);
    expect((await (await request("new?userId=user-b")).json()).count).toBe(1);
  });

  it("allows studying owned pending/rejected cards and rejects foreign/private/unenrolled ones", async () => {
    fixture.seedWord("own", { publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id }); fixture.link(userA.id, "own");
    expect((await request("sessions", "POST", body("own"))).status).toBe(201);
    fixture.words.get("own")!.publicationStatus = "REJECTED";
    expect((await request("sessions", "POST", body("own"))).status).toBe(201);
    fixture.link(userB.id, "own");
    expect((await request("sessions", "POST", body("own"), "b")).status).toBe(404);
    fixture.seedWord("library-only");
    expect((await request("sessions", "POST", body("library-only"))).status).toBe(404);
    expect((await request("sessions", "POST", body("shared"), "c")).status).toBe(404);
    expect((await request("sessions", "POST", { totalWords: 2, words: [body().words[0], body("missing").words[0]] })).status).toBe(404);
    expect(fixture.sessions.size).toBe(2);
  });

  it("validates nested answers, totals and extra fields before any write", async () => {
    const invalid = [
      undefined, null, {}, { ...body(), userId: userB.id }, { ...body(), role: "ADMIN" },
      { ...body(), knownCount: 100 }, { ...body(), totalWords: "1" }, { ...body(), totalWords: 2 },
      { totalWords: 0, words: [] }, { totalWords: 1, words: [null] },
      { totalWords: 1, words: [[body().words[0]]] }, { totalWords: 1, words: [{ ...body().words[0], userId: userB.id }] },
      body(" "), body("shared", "UNKNOWN"), { totalWords: 1, words: [{ wordId: "shared", answer: null }] },
      { totalWords: 2, words: [body().words[0], body().words[0]] },
      { totalWords: 501, words: Array.from({ length: 501 }, (_, index) => ({ wordId: `word-${index}`, answer: "KNOWN" })) },
    ];
    for (const payload of invalid) expect((await request("sessions", "POST", payload)).status).toBe(400);
    expect(fixture.db.studySession.create).not.toHaveBeenCalled();
    expect(fixture.db.wordProgress.upsert).not.toHaveBeenCalled();
  });

  it("returns the same session on a repeated key and refuses changed answers", async () => {
    const first = await request("sessions", "POST", body(), "a", "request-0001");
    const replay = await request("sessions", "POST", body(), "a", "request-0001");
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect((await request("sessions", "POST", body("shared", "NEEDS_REVIEW"), "a", "request-0001")).status).toBe(409);
    expect(fixture.sessions.size).toBe(1);
    expect(fixture.progressFor(userA.id, "shared")?.knownCount).toBe(1);
  });

  it("allows two users to use the same idempotency key for their own sessions", async () => {
    const first = await (await request("sessions", "POST", body(), "a", "request-0001")).json();
    const second = await (await request("sessions", "POST", body(), "b", "request-0001")).json();
    expect(first.id).not.toBe(second.id);
    expect(first.userId).toBe(userA.id);
    expect(second.userId).toBe(userB.id);
    expect(fixture.sessions.size).toBe(2);
  });

  it("rejects malformed idempotency headers and keys supplied in the body", async () => {
    for (const key of ["", "short", "key with spaces", "comma,key", "x".repeat(129)]) {
      expect((await request("sessions", "POST", body(), "a", key)).status).toBe(400);
    }
    expect((await request("sessions", "POST", { ...body(), idempotencyKey: "request-0001" })).status).toBe(400);
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps history but excludes unlinked words from active progress/new/due", async () => {
    await request("sessions", "POST", body());
    fixture.unlink(userA.id, "shared");
    expect((await (await request("sessions")).json()).length).toBe(1);
    expect(await (await request("progress")).json()).toMatchObject({ totalSessions: 1, totalWordsInDictionary: 0, wordsWithProgress: 0, dueCount: 0 });
    expect(await (await request("new")).json()).toEqual({ count: 0, words: [] });
    expect(await (await request("due")).json()).toEqual({ dueCount: 0, words: [] });
    expect((await request("sessions", "POST", body())).status).toBe(404);
    expect(fixture.progressFor(userA.id, "shared")?.knownCount).toBe(1);
  });

  it("filters current privacy inside history while keeping original session totals", async () => {
    await request("sessions", "POST", body(), "a", "request-0001");
    fixture.words.get("shared")!.publicationStatus = "REJECTED";
    const history = await (await request("sessions")).json();
    expect(history[0]).toMatchObject({ userId: userA.id, totalWords: 1, knownCount: 1, words: [] });
    const replay = await (await request("sessions", "POST", body(), "a", "request-0001")).json();
    expect(replay.words).toEqual([]);
    expect(fixture.sessions.size).toBe(1);
  });

  it("returns only this user's due counters and marks all study GET responses no-store", async () => {
    fixture.seedProgress(userA.id, "shared", { knownCount: 4, nextReviewAt: new Date(0), lastReviewedAt: new Date() });
    fixture.seedProgress(userB.id, "shared", { knownCount: 40, nextReviewAt: new Date(0), lastReviewedAt: new Date() });
    const due = await (await request("due")).json();
    expect(due.dueCount).toBe(1);
    expect(due.words[0].progress.knownCount).toBe(4);
    const progress = await (await request("progress")).json();
    expect(progress).toMatchObject({ knownAnswers: 4, dueCount: 1, studiedToday: 1 });
    for (const path of ["new", "due", "progress", "sessions"]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});
