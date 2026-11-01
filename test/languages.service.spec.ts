import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../src/prisma.service";
import { presentWord } from "../src/languages/word-presentation";
import { PreferencesService } from "../src/preferences/preferences.service";
import { WordTranslationsService } from "../src/words/word-translations.service";
import { WordAccessService } from "../src/words/word-access.service";
import { WordsService } from "../src/words/words.service";
import { ModerationService } from "../src/moderation/moderation.service";
import { makeLanguageUsers } from "./support/language-users";
import { makeModerationDatabase } from "./support/moderation-database";
import { admin, userA, userB } from "./support/words-database";

describe("Independent language preferences", () => {
  let store: ReturnType<typeof makeLanguageUsers>;
  let preferences: PreferencesService;
  beforeEach(() => {
    store = makeLanguageUsers();
    preferences = new PreferencesService({ user: store.model } as unknown as PrismaService);
  });

  it("returns only the requested user's two language preferences", async () => {
    expect(await preferences.get(userA.id)).toEqual({ interfaceLanguage: "ru", translationLanguage: "ru" });
    expect(await preferences.get(userA.id)).not.toHaveProperty("role");
  });

  it("changes interface and translation languages independently without affecting another user", async () => {
    expect(await preferences.update(userA.id, { interfaceLanguage: "de" })).toEqual({ interfaceLanguage: "de", translationLanguage: "ru" });
    expect(await preferences.update(userA.id, { translationLanguage: "en" })).toEqual({ interfaceLanguage: "de", translationLanguage: "en" });
    expect(await preferences.get(userB.id)).toEqual({ interfaceLanguage: "ru", translationLanguage: "ru" });
    expect(store.users.get(userA.id)!.role).toBe("USER");
  });

  it("normalizes supported language codes", async () => {
    expect(await preferences.update(userA.id, { interfaceLanguage: " UK ", translationLanguage: " EN " })).toEqual({ interfaceLanguage: "uk", translationLanguage: "en" });
  });

  it("rejects empty, unsupported and null preferences without writing", () => {
    for (const dto of [{}, { interfaceLanguage: "fr" }, { translationLanguage: "xx" }, { interfaceLanguage: null }, { translationLanguage: null }]) {
      expect(() => preferences.update(userA.id, dto as Parameters<PreferencesService["update"]>[1])).toThrow(BadRequestException);
    }
    expect(store.model.update).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing preferences owner", async () => {
    await expect(preferences.get("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("Word translation presentation", () => {
  const source = { id: "word", translation: "старое поле", translations: [{ language: "ru", text: "дерево" }, { language: "en", text: "tree" }] };

  it("selects Russian from WordTranslation rather than the legacy field", () => {
    expect(presentWord(source, "ru")).toMatchObject({ translation: "старое поле", selectedTranslation: { language: "ru", text: "дерево" } });
  });

  it("selects the requested language without modifying the stored word", () => {
    const before = structuredClone(source);
    expect(presentWord(source, "en").selectedTranslation).toEqual({ language: "en", text: "tree" });
    expect(source).toEqual(before);
    expect(source).not.toHaveProperty("selectedTranslation");
  });

  it("returns null for a missing translation without a hidden Russian fallback", () => {
    expect(presentWord(source, "uk").selectedTranslation).toEqual({ language: "uk", text: null });
    expect(presentWord({ translation: "русский legacy", translations: [] }, "ru").selectedTranslation.text).toBeNull();
  });
});

describe("WordTranslation writes and permissions", () => {
  let fixture: ReturnType<typeof makeModerationDatabase>;
  let translations: WordTranslationsService;
  let moderation: ModerationService;
  beforeEach(() => {
    fixture = makeModerationDatabase();
    fixture.seedWord("own", { german: "Baum", translation: "дерево", publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id });
    fixture.seedWord("published");
    fixture.translations.set("ru-own", { id: "ru-own", wordId: "own", language: "ru", text: "дерево" });
    const prisma = fixture.db as unknown as PrismaService;
    const access = new WordAccessService(prisma);
    translations = new WordTranslationsService(access, new WordsService(prisma, access));
    moderation = new ModerationService(prisma);
  });

  it("creates or replaces one language without changing Russian or other translations", async () => {
    await translations.set(userA, "own", "EN", { text: " tree " });
    await translations.set(userA, "own", "en", { text: "a tree" });
    await translations.set(userA, "own", "uk", { text: "дерево" });
    expect(await translations.get(userA, "own", "en")).toEqual({ wordId: "own", language: "en", text: "a tree" });
    expect(fixture.words.get("own")!.translation).toBe("дерево");
    expect(fixture.translations.get("ru-own")!.text).toBe("дерево");
    expect([...fixture.translations.values()].filter((row) => row.wordId === "own" && row.language === "en")).toHaveLength(1);
    expect(fixture.translations.size).toBe(3);
  });

  it("keeps the legacy Russian field and Russian WordTranslation in sync", async () => {
    await translations.set(userA, "own", "en", { text: "tree" });
    await translations.set(userA, "own", "ru", { text: "дерево, растение" });
    expect(fixture.words.get("own")!.translation).toBe("дерево, растение");
    expect(fixture.translations.get("ru-own")!.text).toBe("дерево, растение");
    expect((await translations.get(userA, "own", "en")).text).toBe("tree");
  });

  it("keeps duplicate protection for Russian and English through the translation endpoint", async () => {
    fixture.seedWord("same-published", { german: "Baum", translation: "дерево, растение" });
    await expect(translations.set(userA, "own", "ru", { text: "дерево, растение" })).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.words.get("own")!.translation).toBe("дерево");
    fixture.translations.set("en-same", { id: "en-same", wordId: "same-published", language: "en", text: "tree" });
    await expect(translations.set(userA, "own", "en", { text: "tree" })).rejects.toBeInstanceOf(ConflictException);
    expect((await translations.get(userA, "own", "en")).text).toBeNull();
  });

  it("does not reveal a foreign private word or its translations", async () => {
    await expect(translations.get(userB, "own", "ru")).rejects.toBeInstanceOf(NotFoundException);
    await expect(translations.set(userB, "own", "en", { text: "attack" })).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.translations.size).toBe(1);
  });

  it("lets ordinary users read published translations but reserves edits to administrators", async () => {
    expect(await translations.get(userA, "published", "en")).toEqual({ wordId: "published", language: "en", text: null });
    await expect(translations.set(userA, "published", "en", { text: "table" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(await translations.set(admin, "published", "en", { text: "table" })).toEqual({ wordId: "published", language: "en", text: "table" });
    expect(fixture.words.get("published")!.publicationStatus).toBe("PUBLISHED");
  });

  it("resubmits rejected words and invalidates a review when a translation changes", async () => {
    fixture.words.get("own")!.publicationStatus = "REJECTED";
    await translations.set(userA, "own", "en", { text: "tree" });
    expect(fixture.words.get("own")!.publicationStatus).toBe("PENDING_REVIEW");
    const reviewed = await moderation.findOne(admin, "own");
    await translations.set(userA, "own", "en", { text: "a tree" });
    await expect(moderation.changeStatus(admin, "own", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects unsupported languages and empty/oversized translations", async () => {
    await expect(translations.set(userA, "own", "fr", { text: "arbre" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(translations.get(userA, "own", "xx")).rejects.toBeInstanceOf(BadRequestException);
    for (const text of ["", "   ", "a".repeat(1001)]) {
      await expect(translations.set(userA, "own", "en", { text })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(fixture.db.wordTranslation.upsert).not.toHaveBeenCalled();
  });

  it("rolls back rejected-word resubmission if saving the translation fails", async () => {
    fixture.words.get("own")!.publicationStatus = "REJECTED";
    fixture.db.wordTranslation.upsert.mockRejectedValueOnce(new Error("storage failure"));
    await expect(translations.set(userA, "own", "en", { text: "tree" })).rejects.toThrow("storage failure");
    expect(fixture.words.get("own")!.publicationStatus).toBe("REJECTED");
    expect(fixture.translations.size).toBe(1);
  });
});
