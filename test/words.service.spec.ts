import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../src/prisma.service";
import { WordsService } from "../src/words/words.service";
import { WordAccessService } from "../src/words/word-access.service";
import { WordExamplesService } from "../src/words/word-examples.service";
import { ArticleDto, CreateWordDto, GrammaticalNumberDto } from "../src/words/dto/create-word.dto";
import { admin, makeWordsDatabase, userA, userB } from "./support/words-database";

const card: CreateWordDto = { german: "Baum", article: ArticleDto.der, grammaticalNumber: GrammaticalNumberDto.singular, translation: "дерево" };

describe("Personal dictionaries and word permissions (in-memory Prisma)", () => {
  let fixture: ReturnType<typeof makeWordsDatabase>;
  let words: WordsService;
  let examples: WordExamplesService;

  beforeEach(() => {
    fixture = makeWordsDatabase();
    const prisma = fixture.db as unknown as PrismaService;
    const access = new WordAccessService(prisma);
    words = new WordsService(prisma, access);
    examples = new WordExamplesService(access);
  });

  it("lists and searches only published cards", async () => {
    fixture.seedWord("published");
    fixture.seedWord("pending", { publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id });
    fixture.seedWord("rejected", { publicationStatus: "REJECTED", createdByUserId: userB.id });
    expect((await words.findAll()).map((word) => word.id)).toEqual(["published"]);
    expect((await words.findAll("TISCH")).map((word) => word.id)).toEqual(["published"]);
    expect((await words.findAll("стол")).map((word) => word.id)).toEqual(["published"]);
    expect(await words.findAll("missing")).toEqual([]);
  });

  it("adds one shared word only to the requesting user's dictionary, idempotently", async () => {
    fixture.seedWord("published");
    await words.addToDictionary(userA, "published");
    await words.addToDictionary(userA, "published");
    expect((await words.findMine(userA)).map((word) => word.id)).toEqual(["published"]);
    expect(await words.findMine(userB)).toEqual([]);
    expect(fixture.links.size).toBe(1);
    expect(fixture.words.size).toBe(1);
    expect(fixture.db.word.create).not.toHaveBeenCalled();
  });

  it("creates a pending card, its Russian translation and the creator's link atomically", async () => {
    const created = await words.create(userA, { ...card, german: "  Baum  " });
    expect(created).toMatchObject({ german: "Baum", publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id, translation: "дерево" });
    expect(created.translations).toEqual([expect.objectContaining({ language: "ru", text: "дерево" })]);
    expect((await words.findMine(userA)).map((word) => word.id)).toEqual([created.id]);
    expect(await words.findMine(userB)).toEqual([]);
    expect(await words.findAll()).toEqual([]);
    expect(fixture.db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
  });

  it("hides another author's pending/rejected word and its examples, even when its ID is known", async () => {
    for (const status of ["PENDING_REVIEW", "REJECTED"]) {
      fixture.seedWord("private", { publicationStatus: status, createdByUserId: userA.id });
      await expect(words.findOne(userB, "private")).rejects.toBeInstanceOf(NotFoundException);
      await expect(words.addToDictionary(userB, "private")).rejects.toBeInstanceOf(NotFoundException);
      await expect(examples.list(userB, "private")).rejects.toBeInstanceOf(NotFoundException);
      expect((await words.findOne(userA, "private")).id).toBe("private");
    }
    expect(fixture.links.size).toBe(0);
  });

  it("does not show a foreign private word through a stray dictionary link", async () => {
    fixture.seedWord("foreign", { publicationStatus: "REJECTED", createdByUserId: userB.id });
    fixture.links.set("bad-link", { id: "bad-link", userId: userA.id, wordId: "foreign" });
    expect(await words.findMine(userA)).toEqual([]);
  });

  it("preserves the author's dictionary link when the card becomes published", async () => {
    const created = await words.create(userA, card);
    // Simulate a future moderation decision; this stage does not expose a publication route.
    fixture.words.get(created.id)!.publicationStatus = "PUBLISHED";
    expect((await words.findAll()).map((word) => word.id)).toEqual([created.id]);
    expect((await words.findMine(userA)).map((word) => word.id)).toEqual([created.id]);
    expect(await words.findMine(userB)).toEqual([]);
    await words.addToDictionary(userB, created.id);
    expect(fixture.words.size).toBe(1);
    expect(fixture.links.size).toBe(2);
  });

  it("unlinks only the caller's dictionary and never deletes the shared word", async () => {
    fixture.seedWord("shared");
    await words.addToDictionary(userA, "shared");
    await words.addToDictionary(userB, "shared");
    expect(await words.removeFromDictionary(userA, "shared")).toEqual({ deleted: true });
    expect(await words.removeFromDictionary(userA, "shared")).toEqual({ deleted: true });
    expect(await words.findMine(userA)).toEqual([]);
    expect((await words.findMine(userB)).map((word) => word.id)).toEqual(["shared"]);
    expect(fixture.words.has("shared")).toBe(true);
    expect(fixture.db.word.delete).not.toHaveBeenCalled();
  });

  it("allows an author to revise a rejected card and resubmits it with a synchronized translation", async () => {
    fixture.seedWord("own", { publicationStatus: "REJECTED", createdByUserId: userA.id, notes: "old", pluralForm: "Tische" });
    const result = await words.update(userA, "own", { translation: "письменный стол", notes: null, pluralForm: null });
    expect(result).toMatchObject({ publicationStatus: "PENDING_REVIEW", translation: "письменный стол", notes: null, pluralForm: null });
    expect(result.translations).toEqual([expect.objectContaining({ language: "ru", text: "письменный стол" })]);
  });

  it("forbids ordinary users from changing published or foreign private cards", async () => {
    fixture.seedWord("published", { createdByUserId: userA.id });
    fixture.seedWord("foreign", { publicationStatus: "PENDING_REVIEW", createdByUserId: userB.id });
    await expect(words.update(userA, "published", { translation: "changed" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(words.update(userA, "foreign", { translation: "changed" })).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.words.get("published")!.translation).toBe("стол");
    expect(fixture.words.get("foreign")!.translation).toBe("стол");
  });

  it("lets an administrator edit existing cards but still creates new cards as pending", async () => {
    fixture.seedWord("legacy");
    expect((await words.update(admin, "legacy", { translation: "письменный стол" })).publicationStatus).toBe("PUBLISHED");
    expect((await words.create(admin, card)).publicationStatus).toBe("PENDING_REVIEW");
  });

  it("reports an available exact duplicate without automatically merging or adding it", async () => {
    fixture.seedWord("available", { german: "Baum", translation: "дерево" });
    const error = await words.create(userA, { ...card, german: "  BAUM " }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ wordId: "available" });
    expect(fixture.words.size).toBe(1);
    expect(fixture.links.size).toBe(0);
  });

  it("does not disclose or reuse another author's identical private card", async () => {
    const foreign = await words.create(userB, card);
    const own = await words.create(userA, card);
    expect(own.id).not.toBe(foreign.id);
    const error = await words.create(userA, card).catch((value: unknown) => value);
    expect((error as ConflictException).getResponse()).toMatchObject({ wordId: own.id });
    expect(fixture.words.size).toBe(2);
  });

  it("keeps different articles, grammatical forms, translations and meaning notes separate for review", async () => {
    fixture.seedWord("published", { ...card });
    const variants: CreateWordDto[] = [
      { ...card, article: ArticleDto.das },
      { ...card, grammaticalNumber: GrammaticalNumberDto.plural },
      { ...card, translation: "другое значение" },
      { ...card, notes: "Отдельный смысл" },
      { ...card, pluralForm: "Bäume" },
    ];
    for (const variant of variants) expect((await words.create(userA, variant)).publicationStatus).toBe("PENDING_REVIEW");
    expect(fixture.words.size).toBe(6);
  });

  it("applies the same editing rules to examples of published and private cards", async () => {
    fixture.seedWord("published");
    fixture.seedWord("own", { publicationStatus: "REJECTED", createdByUserId: userA.id });
    await expect(examples.create(userA, "published", { german: "Beispiel", translation: "пример" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(examples.create(userB, "own", { german: "Beispiel", translation: "пример" })).rejects.toBeInstanceOf(NotFoundException);
    const created = await examples.create(userA, "own", { german: " Beispiel ", translation: " пример " });
    expect(created).toMatchObject({ wordId: "own", german: "Beispiel", translation: "пример" });
    expect(fixture.words.get("own")!.publicationStatus).toBe("PENDING_REVIEW");
    expect((await examples.create(admin, "published", { german: "OK", translation: "пример" })).wordId).toBe("published");
  });

  it("scopes example updates/removals to their parent word and rolls back a failed edit", async () => {
    fixture.seedWord("own", { publicationStatus: "REJECTED", createdByUserId: userA.id });
    fixture.examples.set("foreign-example", { id: "foreign-example", wordId: "other", german: "old", translation: "старый" });
    await expect(examples.update(userA, "own", "foreign-example", { german: "changed" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(examples.remove(userA, "own", "foreign-example")).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.words.get("own")!.publicationStatus).toBe("REJECTED");
    expect(fixture.examples.get("foreign-example")!.german).toBe("old");
    const created = await examples.create(userA, "own", { german: "old", translation: "старый" });
    expect(await examples.update(userA, "own", created.id, { german: "new" })).toMatchObject({ german: "new" });
    await examples.remove(userA, "own", created.id);
    expect(fixture.examples.has(created.id)).toBe(false);
  });

  it("rolls back a word update if saving the translation fails", async () => {
    fixture.seedWord("own", { publicationStatus: "REJECTED", createdByUserId: userA.id });
    fixture.db.wordTranslation.upsert.mockRejectedValueOnce(new Error("storage failure"));
    await expect(words.update(userA, "own", { translation: "changed" })).rejects.toThrow("storage failure");
    expect(fixture.words.get("own")).toMatchObject({ publicationStatus: "REJECTED", translation: "стол" });
  });

  it("retries a serialization conflict and limits repeated write conflicts", async () => {
    const conflict = () => new Prisma.PrismaClientKnownRequestError("Conflict", { code: "P2034", clientVersion: "6.19.3" });
    fixture.db.$transaction.mockRejectedValueOnce(conflict());
    expect((await words.create(userA, card)).publicationStatus).toBe("PENDING_REVIEW");
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(2);
    fixture.db.$transaction.mockRejectedValue(conflict());
    await expect(words.create(userA, { ...card, german: "Wald" })).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(5);
  });
  it("rolls back the word, dictionary link and translations when an initial example fails", async () => {
    fixture.db.wordExample.create.mockRejectedValueOnce(new Error("example write failed"));
    await expect(words.create(userA, { ...card, examples: [{ german: "Ein Baum." }] })).rejects.toThrow("example write failed");
    expect(fixture.words.size).toBe(0); expect(fixture.links.size).toBe(0);
    expect(fixture.translations.size).toBe(0); expect(fixture.examples.size).toBe(0);
  });

  it("keeps word language patches independent and synchronizes legacy Russian only with Russian", async () => {
    const created = await words.create(userA, { ...card, translations: [{ language: "en", text: "tree" }] });
    const updated = await words.update(userA, created.id, { translations: [{ language: "ru", text: null }, { language: "uk", text: "дерево" }] });
    expect(updated.translation).toBe("");
    expect(updated.translations.map((entry) => entry.language).sort()).toEqual(["en", "uk"]);
    const restored = await words.update(userA, created.id, { translation: "дерево" });
    expect(restored.translations).toHaveLength(3); expect(restored.translation).toBe("дерево");
  });

  it("compares multilingual meanings without treating every missing Russian translation as a duplicate", async () => {
    const base = { german: "Bank", article: ArticleDto.die, grammaticalNumber: GrammaticalNumberDto.singular };
    await words.create(userA, { ...base, translations: [{ language: "en", text: "bench" }] });
    await expect(words.create(userA, { ...base, translations: [{ language: "en", text: "bench" }] })).rejects.toBeInstanceOf(ConflictException);
    await expect(words.create(userA, { ...base, translations: [{ language: "en", text: "bank" }] })).resolves.toMatchObject({ translation: "" });
  });

  it("selects the example translation in the reader's language and never falls back to Russian", async () => {
    fixture.seedWord("shared");
    await examples.create(admin, "shared", { german: "Ein Tisch.", translations: [{ language: "ru", text: "Стол." }, { language: "en", text: "A table." }] });
    expect((await examples.list({ ...userA, translationLanguage: "en" }, "shared"))[0].selectedTranslation).toEqual({ language: "en", text: "A table." });
    expect((await examples.list({ ...userA, translationLanguage: "uk" }, "shared"))[0].selectedTranslation).toEqual({ language: "uk", text: null });
  });

});
