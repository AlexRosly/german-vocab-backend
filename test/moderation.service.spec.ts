import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../src/prisma.service";
import { ModerationService } from "../src/moderation/moderation.service";
import { WordAccessService } from "../src/words/word-access.service";
import { WordExamplesService } from "../src/words/word-examples.service";
import { WordsService } from "../src/words/words.service";
import { makeModerationDatabase } from "./support/moderation-database";
import { admin, userA, userB } from "./support/words-database";

describe("Administrative moderation (in-memory Prisma)", () => {
  let fixture: ReturnType<typeof makeModerationDatabase>;
  let moderation: ModerationService;
  let words: WordsService;
  let examples: WordExamplesService;

  beforeEach(() => {
    fixture = makeModerationDatabase();
    fixture.seedWord("pending", { german: "Baum", translation: "дерево", publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id });
    fixture.seedWord("published");
    fixture.seedWord("rejected", { german: "Haus", translation: "дом", publicationStatus: "REJECTED", createdByUserId: userB.id });
    fixture.links.set("author-link", { id: "author-link", userId: userA.id, wordId: "pending", createdAt: new Date() });
    fixture.translations.set("ru-pending", { id: "ru-pending", wordId: "pending", language: "ru", text: "дерево", updatedAt: new Date() });
    fixture.examples.set("example", { id: "example", wordId: "pending", german: "Der Baum ist hoch.", translation: "Дерево высокое.", createdAt: new Date(), updatedAt: new Date() });
    const prisma = fixture.db as unknown as PrismaService;
    moderation = new ModerationService(prisma);
    const access = new WordAccessService(prisma);
    words = new WordsService(prisma, access);
    examples = new WordExamplesService(access);
  });

  it("checks the administrator role at every service entry point", async () => {
    expect(() => moderation.findAll(userA)).toThrow(ForbiddenException);
    await expect(moderation.findOne(userA, "pending")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(moderation.changeStatus(userA, "pending", { publicationStatus: "PUBLISHED", expectedRevision: "a".repeat(64) })).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.db.word.findMany).not.toHaveBeenCalled();
    expect(fixture.db.word.findUnique).not.toHaveBeenCalled();
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it("defaults the queue to pending words and supports all three status filters", async () => {
    expect((await moderation.findAll(admin)).map((word) => word.id)).toEqual(["pending"]);
    expect((await moderation.findAll(admin, "PUBLISHED")).map((word) => word.id)).toEqual(["published"]);
    expect((await moderation.findAll(admin, "REJECTED")).map((word) => word.id)).toEqual(["rejected"]);
  });

  it("returns the full review card and a stable revision without personal dictionaries", async () => {
    const first = await moderation.findOne(admin, "pending");
    const second = await moderation.findOne(admin, "pending");
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(second.revision).toBe(first.revision);
    expect(first.examples).toEqual([expect.objectContaining({ id: "example", german: "Der Baum ist hoch." })]);
    expect(first.translations).toEqual([expect.objectContaining({ language: "ru", text: "дерево" })]);
    expect(first).not.toHaveProperty("userWords");
    expect(first).not.toHaveProperty("progress");
  });

  it("publishes the same Word and preserves its author and personal link", async () => {
    const reviewed = await moderation.findOne(admin, "pending");
    const linksBefore = structuredClone([...fixture.links.values()]);
    const result = await moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision });
    expect(result).toMatchObject({ id: "pending", publicationStatus: "PUBLISHED", createdByUserId: userA.id });
    expect(result.revision).not.toBe(reviewed.revision);
    expect([...fixture.links.values()]).toEqual(linksBefore);
    expect((await words.findAll()).map((word) => word.id)).toContain("pending");
    expect((await words.findMine(userA)).map((word) => word.id)).toEqual(["pending"]);
    expect(await words.findMine(userB)).toEqual([]);
    await words.addToDictionary(userB, "pending");
    expect(fixture.words.size).toBe(3);
    expect(fixture.links.size).toBe(2);
    expect(fixture.db.word.delete).not.toHaveBeenCalled();
  });

  it("rejects without deleting the author's card, translations, examples or dictionary link", async () => {
    const reviewed = await moderation.findOne(admin, "pending");
    const linksBefore = structuredClone([...fixture.links.values()]);
    const translationsBefore = structuredClone([...fixture.translations.values()]);
    const examplesBefore = structuredClone([...fixture.examples.values()]);
    await moderation.changeStatus(admin, "pending", { publicationStatus: "REJECTED", expectedRevision: reviewed.revision });
    expect((await words.findOne(userA, "pending")).publicationStatus).toBe("REJECTED");
    expect((await words.findMine(userA)).map((word) => word.id)).toEqual(["pending"]);
    await expect(words.findOne(userB, "pending")).rejects.toBeInstanceOf(NotFoundException);
    await expect(words.addToDictionary(userB, "pending")).rejects.toBeInstanceOf(NotFoundException);
    expect([...fixture.links.values()]).toEqual(linksBefore);
    expect([...fixture.translations.values()]).toEqual(translationsBefore);
    expect([...fixture.examples.values()]).toEqual(examplesBefore);
    expect(fixture.db.word.update).toHaveBeenCalledWith(expect.objectContaining({ data: { publicationStatus: "REJECTED" } }));
  });

  it("can withdraw and restore a published word while retaining existing dictionary links", async () => {
    let reviewed = await moderation.findOne(admin, "pending");
    reviewed = await moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision });
    await words.addToDictionary(userB, "pending");
    const linksBefore = structuredClone([...fixture.links.values()]);
    reviewed = await moderation.changeStatus(admin, "pending", { publicationStatus: "REJECTED", expectedRevision: reviewed.revision });
    expect(await words.findMine(userB)).toEqual([]);
    expect((await words.findMine(userA)).map((word) => word.id)).toEqual(["pending"]);
    reviewed = await moderation.changeStatus(admin, "pending", { publicationStatus: "PENDING_REVIEW", expectedRevision: reviewed.revision });
    expect((await moderation.findAll(admin)).map((word) => word.id)).toEqual(["pending"]);
    await moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision });
    expect((await words.findMine(userB)).map((word) => word.id)).toEqual(["pending"]);
    expect([...fixture.links.values()]).toEqual(linksBefore);
  });

  it("does not let a second administrator overwrite an already changed decision", async () => {
    const first = await moderation.findOne(admin, "pending");
    const secondAdmin = { ...admin, id: "admin-two" };
    const second = await moderation.findOne(secondAdmin, "pending");
    await moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: first.revision });
    const error = await moderation.changeStatus(secondAdmin, "pending", { publicationStatus: "REJECTED", expectedRevision: second.revision }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: "STALE_REVIEW" });
    expect(fixture.words.get("pending")!.publicationStatus).toBe("PUBLISHED");
  });

  it("requires a new review after the author edits the word through the normal API service", async () => {
    const reviewed = await moderation.findOne(admin, "pending");
    await words.update(userA, "pending", { translation: "дерево (растение)" });
    await expect(moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.words.get("pending")!.publicationStatus).toBe("PENDING_REVIEW");
  });

  it.each(["create", "update", "remove"] as const)("requires a new review after an example %s", async (operation) => {
    const reviewed = await moderation.findOne(admin, "pending");
    if (operation === "create") await examples.create(userA, "pending", { german: "Ein Baum.", translation: "Дерево." });
    if (operation === "update") await examples.update(userA, "pending", "example", { german: "Ein anderer Baum." });
    if (operation === "remove") await examples.remove(userA, "pending", "example");
    // Content hashing must still work if timestamps fall in the same millisecond.
    fixture.words.get("pending")!.updatedAt = reviewed.updatedAt;
    await expect(moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).rejects.toBeInstanceOf(ConflictException);
  });

  it("includes non-Russian translations in the reviewed revision", async () => {
    fixture.translations.set("en-pending", { id: "en-pending", wordId: "pending", language: "en", text: "tree" });
    const reviewed = await moderation.findOne(admin, "pending");
    fixture.translations.get("en-pending")!.text = "a tree";
    await expect(moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).rejects.toBeInstanceOf(ConflictException);
  });

  it("includes example translations in the reviewed revision, even if the German text is unchanged", async () => {
    fixture.exampleTranslations.set("en-example", { id: "en-example", exampleId: "example", language: "en", text: "The tree is tall." });
    const reviewed = await moderation.findOne(admin, "pending");
    expect(reviewed.examples[0].translations).toEqual([expect.objectContaining({ language: "en", text: "The tree is tall." })]);
    fixture.exampleTranslations.get("en-example")!.text = "The tree is high.";
    await expect(moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).rejects.toBeInstanceOf(ConflictException);
  });

  it("detects matching published meanings in English without requiring a Russian translation", async () => {
    Object.assign(fixture.words.get("published")!, { german: "Baum", translation: "" });
    Object.assign(fixture.words.get("pending")!, { translation: "" });
    fixture.translations.delete("ru-pending");
    fixture.translations.set("en-published", { id: "en-published", wordId: "published", language: "en", text: "tree" });
    fixture.translations.set("en-pending", { id: "en-pending", wordId: "pending", language: "en", text: "tree" });
    const reviewed = await moderation.findOne(admin, "pending");
    await expect(moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).rejects.toBeInstanceOf(ConflictException);
  });

  it("blocks an exact published duplicate without merging or deleting either card", async () => {
    Object.assign(fixture.words.get("pending")!, { german: "TISCH", translation: "стол" });
    const reviewed = await moderation.findOne(admin, "pending");
    const error = await moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: "DUPLICATE_WORD", wordId: "published" });
    expect(fixture.words.size).toBe(3);
    expect(fixture.links.size).toBe(1);
    expect(fixture.words.get("pending")!.publicationStatus).toBe("PENDING_REVIEW");
    expect(fixture.db.word.delete).not.toHaveBeenCalled();
  });

  it.each([
    { article: "das" }, { grammaticalNumber: "plural" }, { translation: "другое значение" },
    { pluralForm: "Tische" }, { notes: "Отдельное значение" },
  ])("keeps a distinct meaning or grammatical form separate: %j", async (difference) => {
    Object.assign(fixture.words.get("pending")!, { german: "Tisch", translation: "стол", ...difference });
    const reviewed = await moderation.findOne(admin, "pending");
    expect((await moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).publicationStatus).toBe("PUBLISHED");
    expect(fixture.words.size).toBe(3);
  });

  it("returns an unchanged card for the current status with its current revision", async () => {
    const reviewed = await moderation.findOne(admin, "pending");
    const result = await moderation.changeStatus(admin, "pending", { publicationStatus: "PENDING_REVIEW", expectedRevision: reviewed.revision });
    expect(result).toEqual(reviewed);
    expect(fixture.db.word.update).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing review card without a write", async () => {
    await expect(moderation.findOne(admin, "missing")).rejects.toBeInstanceOf(NotFoundException);
    await expect(moderation.changeStatus(admin, "missing", { publicationStatus: "PUBLISHED", expectedRevision: "a".repeat(64) })).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.db.word.update).not.toHaveBeenCalled();
  });

  it("retries a serialization conflict and re-checks the review after retrying", async () => {
    const reviewed = await moderation.findOne(admin, "pending");
    fixture.db.$transaction.mockImplementationOnce(async () => {
      // Simulate a committed author edit from a competing transaction.
      fixture.words.get("pending")!.notes = "New author content";
      throw new Prisma.PrismaClientKnownRequestError("Conflict", { code: "P2034", clientVersion: "6.19.3" });
    });
    await expect(moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(2);
    expect(fixture.words.get("pending")!.publicationStatus).toBe("PENDING_REVIEW");
    expect(fixture.db.word.update).not.toHaveBeenCalled();
  });

  it("retries a transient serialization failure and limits persistent conflicts", async () => {
    const conflict = () => new Prisma.PrismaClientKnownRequestError("Conflict", { code: "P2034", clientVersion: "6.19.3" });
    const reviewed = await moderation.findOne(admin, "pending");
    fixture.db.$transaction.mockRejectedValueOnce(conflict());
    await moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision });
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(2);
    fixture.db.$transaction.mockRejectedValue(conflict());
    await expect(moderation.changeStatus(admin, "pending", { publicationStatus: "REJECTED", expectedRevision: reviewed.revision })).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(5);
  });

  it("rolls back a failed publication write without affecting dictionary links", async () => {
    const reviewed = await moderation.findOne(admin, "pending");
    const original = fixture.db.word.update.getMockImplementation()!;
    fixture.db.word.update.mockImplementationOnce(async (args) => { await original(args); throw new Error("storage failure"); });
    await expect(moderation.changeStatus(admin, "pending", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).rejects.toThrow("storage failure");
    expect(fixture.words.get("pending")!.publicationStatus).toBe("PENDING_REVIEW");
    expect(fixture.links.has("author-link")).toBe(true);
  });
});
