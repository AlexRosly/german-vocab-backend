import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma, StudyAnswer } from "@prisma/client";
import { PrismaService } from "../src/prisma.service";
import { StudyService } from "../src/study/study.service";
import { CreateStudySessionDto } from "../src/study/dto/create-study-session.dto";
import { makeStudyDatabase } from "./support/study-database";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const DAY_MS = 86_400_000;
const A = "user-a";
const B = "user-b";
const body = (wordId = "shared", answer: StudyAnswer = "KNOWN"): CreateStudySessionDto => ({ totalWords: 1, words: [{ wordId, answer }] });

describe("Personal study service (in-memory Prisma)", () => {
  let fixture: ReturnType<typeof makeStudyDatabase>;
  let study: StudyService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    fixture = makeStudyDatabase();
    study = new StudyService(fixture.db as unknown as PrismaService);
    fixture.seedWord("shared");
    fixture.link(A, "shared");
    fixture.link(B, "shared");
  });
  afterEach(() => jest.useRealTimers());

  it("stores sessions and progress separately for users learning the same word", async () => {
    const first = await study.createSession(A, body());
    const second = await study.createSession(B, body("shared", "NEEDS_REVIEW"));
    expect(first.userId).toBe(A);
    expect(second.userId).toBe(B);
    expect(fixture.progressFor(A, "shared")).toMatchObject({ knownCount: 1, needsReviewCount: 0, consecutiveKnown: 1 });
    expect(fixture.progressFor(B, "shared")).toMatchObject({ knownCount: 0, needsReviewCount: 1, consecutiveKnown: 0 });
    expect(fixture.progress.size).toBe(2);
    expect((await study.getSessions(A)).map((item) => item.id)).toEqual([first.id]);
    expect((await study.getSessions(B)).map((item) => item.id)).toEqual([second.id]);
  });

  it("preserves the 1, 3, 7, 14, 30 day schedule and its 30 day cap", async () => {
    const expected = [1, 3, 7, 14, 30, 30, 30];
    for (let index = 0; index < expected.length; index += 1) {
      await study.createSession(A, body());
      expect(fixture.progressFor(A, "shared")).toMatchObject({
        knownCount: index + 1, consecutiveKnown: index + 1, currentIntervalDays: expected[index],
        lastReviewedAt: NOW, nextReviewAt: new Date(NOW.getTime() + expected[index] * DAY_MS),
      });
    }
  });

  it("resets the series on NEEDS_REVIEW and restarts it on the next KNOWN", async () => {
    fixture.seedProgress(A, "shared", { knownCount: 5, consecutiveKnown: 5, currentIntervalDays: 30 });
    await study.createSession(A, body("shared", "NEEDS_REVIEW"));
    expect(fixture.progressFor(A, "shared")).toMatchObject({ knownCount: 5, needsReviewCount: 1, consecutiveKnown: 0, currentIntervalDays: 1, nextReviewAt: new Date(NOW.getTime() + DAY_MS) });
    await study.createSession(A, body());
    expect(fixture.progressFor(A, "shared")).toMatchObject({ knownCount: 6, needsReviewCount: 1, consecutiveKnown: 1, currentIntervalDays: 1 });
  });

  it("counts early KNOWN answers and schedules from the actual review time", async () => {
    fixture.seedProgress(A, "shared", { knownCount: 1, consecutiveKnown: 1, currentIntervalDays: 1, nextReviewAt: new Date(NOW.getTime() + DAY_MS) });
    const reviewTime = new Date(NOW.getTime() + 60_000);
    jest.setSystemTime(reviewTime);
    await study.createSession(A, body());
    expect(fixture.progressFor(A, "shared")).toMatchObject({ consecutiveKnown: 2, currentIntervalDays: 3, lastReviewedAt: reviewTime, nextReviewAt: new Date(reviewTime.getTime() + 3 * DAY_MS) });
  });

  it("allows creators to study their pending and rejected personal cards", async () => {
    for (const status of ["PENDING_REVIEW", "REJECTED"]) {
      fixture.seedWord(status, { publicationStatus: status, createdByUserId: A });
      fixture.link(A, status);
      expect((await study.createSession(A, body(status))).words[0].word.id).toBe(status);
      expect(fixture.progressFor(A, status)?.knownCount).toBe(1);
    }
  });

  it("rejects unenrolled, missing and foreign private words without creating records", async () => {
    fixture.seedWord("library-only");
    fixture.seedWord("private", { publicationStatus: "PENDING_REVIEW", createdByUserId: B });
    fixture.link(A, "private");
    for (const id of ["library-only", "private", "missing"]) {
      await expect(study.createSession(A, body(id))).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(fixture.sessions.size).toBe(0);
    expect(fixture.progress.size).toBe(0);
    expect(fixture.db.studySession.create).not.toHaveBeenCalled();
  });

  it("checks every submitted word before saving a mixed session", async () => {
    await expect(study.createSession(A, { totalWords: 2, words: [body().words[0], { wordId: "missing", answer: "KNOWN" }] })).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.sessions.size).toBe(0);
    expect(fixture.progress.size).toBe(0);
  });

  it("does not give administrators a bypass around their personal dictionary", async () => {
    await expect(study.createSession("admin", body())).rejects.toBeInstanceOf(NotFoundException);
    fixture.link("admin", "shared");
    expect((await study.createSession("admin", body())).userId).toBe("admin");
  });

  it("lists only enrolled, visible words with no progress for this user", async () => {
    fixture.seedProgress(B, "shared", { knownCount: 5 });
    fixture.seedWord("own", { publicationStatus: "PENDING_REVIEW", createdByUserId: A });
    fixture.link(A, "own");
    fixture.seedWord("rejected", { publicationStatus: "REJECTED", createdByUserId: A });
    fixture.link(A, "rejected");
    fixture.seedWord("studied"); fixture.link(A, "studied"); fixture.seedProgress(A, "studied");
    fixture.seedWord("library-only");
    fixture.seedWord("hidden", { publicationStatus: "PENDING_REVIEW", createdByUserId: B }); fixture.link(A, "hidden");
    const result = await study.getNewWords(A);
    expect(result.count).toBe(3);
    expect(result.words.map((word) => word.id).sort()).toEqual(["own", "rejected", "shared"]);
    expect((await study.getNewWords(B)).count).toBe(0);
  });

  it("returns only this user's due enrolled words and keeps the original date ordering", async () => {
    fixture.seedProgress(A, "shared", { knownCount: 1, nextReviewAt: new Date(NOW.getTime() - 1000) });
    fixture.seedProgress(B, "shared", { knownCount: 99, nextReviewAt: new Date(NOW.getTime() - 9000) });
    fixture.seedWord("own", { publicationStatus: "PENDING_REVIEW", createdByUserId: A }); fixture.link(A, "own");
    fixture.seedProgress(A, "own", { nextReviewAt: new Date(NOW.getTime() - 2000) });
    fixture.seedWord("future"); fixture.link(A, "future"); fixture.seedProgress(A, "future", { nextReviewAt: new Date(NOW.getTime() + 1) });
    fixture.seedWord("null-date"); fixture.link(A, "null-date"); fixture.seedProgress(A, "null-date");
    fixture.seedWord("removed"); fixture.seedProgress(A, "removed", { nextReviewAt: new Date(0) });
    fixture.seedWord("hidden", { publicationStatus: "REJECTED", createdByUserId: B }); fixture.link(A, "hidden"); fixture.seedProgress(A, "hidden", { nextReviewAt: new Date(0) });
    const result = await study.getDueWords(A);
    expect(result.dueCount).toBe(2);
    expect(result.words.map((word) => word.id)).toEqual(["own", "shared"]);
    expect(result.words[1].progress.knownCount).toBe(1);
  });

  it("calculates statistics from a consistent snapshot of this user's active dictionary", async () => {
    fixture.seedWord("new"); fixture.link(A, "new");
    fixture.seedWord("own", { publicationStatus: "REJECTED", createdByUserId: A }); fixture.link(A, "own");
    fixture.seedProgress(A, "shared", { knownCount: 3, needsReviewCount: 1, lastReviewedAt: NOW, nextReviewAt: new Date(0) });
    fixture.seedProgress(A, "own", { needsReviewCount: 2, lastReviewedAt: new Date(NOW.getTime() - DAY_MS), nextReviewAt: new Date(NOW.getTime() + DAY_MS) });
    fixture.seedProgress(B, "shared", { knownCount: 99, needsReviewCount: 88, lastReviewedAt: NOW, nextReviewAt: new Date(0) });
    fixture.seedWord("removed"); fixture.seedProgress(A, "removed", { knownCount: 50, lastReviewedAt: NOW, nextReviewAt: new Date(0) });
    fixture.seedWord("hidden", { publicationStatus: "REJECTED", createdByUserId: B }); fixture.link(A, "hidden"); fixture.seedProgress(A, "hidden", { knownCount: 70 });
    fixture.sessions.set("a", { id: "a", userId: A, startedAt: NOW });
    fixture.sessions.set("b1", { id: "b1", userId: B, startedAt: NOW });
    fixture.sessions.set("b2", { id: "b2", userId: B, startedAt: NOW });
    expect(await study.getProgress(A)).toMatchObject({ totalSessions: 1, totalWordsInDictionary: 3, wordsWithProgress: 2, studiedToday: 1, dueCount: 1, knownAnswers: 3, needsReviewAnswers: 3 });
    expect(await study.getProgress(B)).toMatchObject({ totalSessions: 2, totalWordsInDictionary: 1, wordsWithProgress: 1, knownAnswers: 99, needsReviewAnswers: 88 });
    expect(fixture.db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
  });

  it("keeps history and saved progress after unlinking, and resumes it after re-adding", async () => {
    const session = await study.createSession(A, body());
    fixture.unlink(A, "shared");
    expect((await study.getProgress(A)).totalSessions).toBe(1);
    expect((await study.getProgress(A)).wordsWithProgress).toBe(0);
    expect((await study.getSessions(A))[0].id).toBe(session.id);
    expect((await study.getSessions(A))[0].words[0].word.id).toBe("shared");
    expect((await study.getDueWords(A)).dueCount).toBe(0);
    await expect(study.createSession(A, body())).rejects.toBeInstanceOf(NotFoundException);
    fixture.link(A, "shared");
    expect((await study.getNewWords(A)).count).toBe(0);
    await study.createSession(A, body());
    expect(fixture.progressFor(A, "shared")).toMatchObject({ knownCount: 2, consecutiveKnown: 2, currentIntervalDays: 3 });
  });

  it("hides a now-private foreign word even inside the caller's own history", async () => {
    await study.createSession(A, body());
    fixture.words.get("shared")!.publicationStatus = "REJECTED";
    const history = await study.getSessions(A);
    expect(history).toHaveLength(1);
    expect(history[0].totalWords).toBe(1);
    expect(history[0].words).toEqual([]);
    expect((await study.getProgress(A)).totalWordsInDictionary).toBe(0);
    expect((await study.getNewWords(A)).count).toBe(0);
  });

  it("saves an idempotent session only once and returns its original timestamps", async () => {
    const first = await study.createSession(A, body(), "request-0001");
    jest.setSystemTime(new Date(NOW.getTime() + DAY_MS));
    const replay = await study.createSession(A, body(), "request-0001");
    expect(replay).toEqual(first);
    expect(fixture.sessions.size).toBe(1);
    expect(fixture.progressFor(A, "shared")?.knownCount).toBe(1);
  });

  it("scopes an idempotency key to the authenticated user", async () => {
    const first = await study.createSession(A, body(), "request-0001");
    const second = await study.createSession(B, body(), "request-0001");
    expect(first.id).not.toBe(second.id);
    expect(fixture.sessions.size).toBe(2);
    expect(fixture.progressFor(A, "shared")?.knownCount).toBe(1);
    expect(fixture.progressFor(B, "shared")?.knownCount).toBe(1);
  });

  it("rejects reuse of a key with changed answers without changing progress", async () => {
    await study.createSession(A, body(), "request-0001");
    await expect(study.createSession(A, body("shared", "NEEDS_REVIEW"), "request-0001")).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.progressFor(A, "shared")).toMatchObject({ knownCount: 1, needsReviewCount: 0 });
    expect(fixture.sessions.size).toBe(1);
  });

  it("accepts an identical idempotent payload with answers in a different order", async () => {
    fixture.seedWord("second"); fixture.link(A, "second");
    const payload: CreateStudySessionDto = { totalWords: 2, words: [body().words[0], body("second", "NEEDS_REVIEW").words[0]] };
    const first = await study.createSession(A, payload, "request-0001");
    expect((await study.createSession(A, { ...payload, words: [...payload.words].reverse() }, "request-0001")).id).toBe(first.id);
    expect(fixture.progressFor(A, "second")?.needsReviewCount).toBe(1);
  });

  it("allows a harmless idempotent replay after unlinking but refuses a new session", async () => {
    const first = await study.createSession(A, body(), "request-0001");
    fixture.unlink(A, "shared");
    expect((await study.createSession(A, body(), "request-0001")).id).toBe(first.id);
    await expect(study.createSession(A, body(), "request-0002")).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.progressFor(A, "shared")?.knownCount).toBe(1);
  });

  it("treats requests without a key as distinct intentional sessions", async () => {
    const first = await study.createSession(A, body());
    const second = await study.createSession(A, body());
    expect(first.id).not.toBe(second.id);
    expect(fixture.progressFor(A, "shared")?.knownCount).toBe(2);
  });

  it("validates counts, word IDs, unique answers and keys before any transaction", async () => {
    const invalid: unknown[] = [null, {}, { totalWords: 0, words: [] }, { ...body(), totalWords: 2 },
      { totalWords: 2, words: [body().words[0], body().words[0]] },
      { totalWords: 1, words: [null] }, { totalWords: 1, words: [{ wordId: " ", answer: "KNOWN" }] },
      { totalWords: 1, words: [{ wordId: "shared", answer: "BAD" }] },
    ];
    for (const dto of invalid) await expect(study.createSession(A, dto as CreateStudySessionDto)).rejects.toBeInstanceOf(BadRequestException);
    for (const key of ["", "short", "key with spaces", "ключ-1234", "x".repeat(129)]) {
      await expect(study.createSession(A, body(), key)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back the session and earlier progress writes if one progress write fails", async () => {
    fixture.seedWord("second"); fixture.link(A, "second");
    const original = fixture.db.wordProgress.upsert.getMockImplementation()!;
    fixture.db.wordProgress.upsert.mockImplementationOnce(original).mockRejectedValueOnce(new Error("storage failure"));
    await expect(study.createSession(A, { totalWords: 2, words: [body().words[0], body("second").words[0]] })).rejects.toThrow("storage failure");
    expect(fixture.sessions.size).toBe(0);
    expect(fixture.answers.size).toBe(0);
    expect(fixture.progress.size).toBe(0);
  });

  it.each(["P2034", "P2002"])("retries %s without saving the answer twice", async (code) => {
    fixture.db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Conflict", { code, clientVersion: "6.19.3" }));
    await study.createSession(A, body(), "request-0001");
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(2);
    expect(fixture.sessions.size).toBe(1);
    expect(fixture.progressFor(A, "shared")?.knownCount).toBe(1);
  });

  it("limits retries when write conflicts persist", async () => {
    fixture.db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Conflict", { code: "P2034", clientVersion: "6.19.3" }));
    await expect(study.createSession(A, body())).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(3);
  });
});
