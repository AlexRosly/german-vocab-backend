import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma.service";
import { StudyService } from "../src/study/study.service";
import { canonicalTimeZone, localDay, localDayFormatter } from "../src/preferences/study-preferences";
import { makeStudyDatabase } from "./support/study-database";

describe("Calendar days and personal daily goals", () => {
  afterEach(() => jest.useRealTimers());
  it.each([
    ["Europe/Berlin", "2026-03-28T23:00:00Z", "2026-03-29"],
    ["Europe/Berlin", "2026-03-29T21:59:59Z", "2026-03-29"],
    ["Europe/Berlin", "2026-03-29T22:00:00Z", "2026-03-30"],
    ["Europe/Berlin", "2026-10-25T00:30:00Z", "2026-10-25"],
    ["Europe/Berlin", "2026-10-25T01:30:00Z", "2026-10-25"],
    ["Europe/Berlin", "2026-10-25T23:00:00Z", "2026-10-26"],
    ["Asia/Kathmandu", "2026-11-01T18:15:00Z", "2026-11-02"],
    ["America/New_York", "2026-11-01T03:59:59Z", "2026-10-31"],
  ])("uses the local calendar in %s at %s", (zone, instant, expected) => {
    expect(localDay(localDayFormatter(zone), new Date(instant))).toBe(expected);
  });
  it("rejects invalid, numeric offsets, empty and oversized timezone input", () => {
    for (const value of [null, "", "Mars/Test", "+02:00", " Europe/Berlin ", "x".repeat(101)]) {
      expect(() => canonicalTimeZone(value)).toThrow(BadRequestException);
    }
    expect(canonicalTimeZone("europe/berlin")).toBe("Europe/Berlin");
  });
  it("counts each active personal word once in the chosen local day without changing SRS", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-01T23:30:00Z") });
    const fixture = makeStudyDatabase();
    fixture.db.user.findUnique.mockResolvedValue({ timeZone: "Europe/Berlin", dailyGoal: 2 });
    const study = new StudyService(fixture.db as unknown as PrismaService);
    for (const word of ["today", "yesterday", "removed", "private", "other", "future"]) fixture.seedWord(word);
    for (const word of ["today", "yesterday", "private", "future"]) fixture.link("a", word);
    fixture.words.get("private")!.publicationStatus = "PENDING_REVIEW";
    fixture.words.get("private")!.createdByUserId = "b";
    for (const word of ["today", "removed", "private"]) fixture.seedProgress("a", word, { lastReviewedAt: new Date("2026-11-01T23:00:00Z"), knownCount: 7 });
    fixture.seedProgress("a", "yesterday", { lastReviewedAt: new Date("2026-11-01T22:59:59.999Z") });
    fixture.seedProgress("a", "future", { lastReviewedAt: new Date("2026-11-02T00:00:00Z") });
    fixture.seedProgress("b", "other", { lastReviewedAt: new Date("2026-11-01T23:00:00Z") });
    const before = structuredClone([...fixture.progress]);
    expect(await study.getProgress("a")).toMatchObject({ timeZone: "Europe/Berlin", dailyGoal: 2, studyDate: "2026-11-02", studiedToday: 1 });
    fixture.db.user.findUnique.mockResolvedValue({ timeZone: "UTC", dailyGoal: 10 });
    expect(await study.getProgress("a")).toMatchObject({ studyDate: "2026-11-01", studiedToday: 2 });
    expect([...fixture.progress]).toEqual(before);
    expect(fixture.db.wordProgress.upsert).not.toHaveBeenCalled();
    expect(fixture.db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
  });
  it("does not count idempotent replay or repeated answers as additional daily words", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z") });
    const fixture = makeStudyDatabase(); fixture.seedWord("tree"); fixture.link("a", "tree");
    const study = new StudyService(fixture.db as unknown as PrismaService);
    const body = { totalWords: 1, words: [{ wordId: "tree", answer: "KNOWN" as const }] };
    await study.createSession("a", body, "request-0001");
    await study.createSession("a", body, "request-0001");
    await study.createSession("a", body, "request-0002");
    expect(await study.getProgress("a")).toMatchObject({ studiedToday: 1, totalSessions: 2 });
  });
});
