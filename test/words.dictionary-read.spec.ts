import { PersonalTranslationsService } from "../src/words/personal-translations.service";
import { PrismaService } from "../src/prisma.service";
import { WordsService } from "../src/words/words.service";
import { WordsController } from "../src/words/words.controller";
import { WordAccessService } from "../src/words/word-access.service";
import { makeWordsDatabase, userA, userB } from "./support/words-database";
describe("A large personal dictionary carries its readable examples in one response", () => {
  it("returns 800 cards with example translations without one example query per card", async () => {
    const fixture = makeWordsDatabase();
    const prisma = fixture.db as unknown as PrismaService;
    const service = new WordsService(prisma, new WordAccessService(prisma));
    for (let n=0;n<800;n++) {
      const id = "bulk-"+n; fixture.seedWord(id);
      await fixture.db.userWord.upsert({ where: { userId_wordId: { userId: userA.id, wordId: id } }, create: { userId: userA.id, wordId: id }, update: {} });
      await fixture.db.wordExample.create({ data: { wordId: id, german: "Das ist ein Beispiel.", translation: "Это пример.", translations: { create: [{ language: "ru", text: "Это пример." }, { language: "uk", text: "Це приклад." }] } } });
    }
    const controller = new WordsController(service, new PersonalTranslationsService(new WordAccessService(prisma), prisma));
    const result = await controller.findMine({ ...userA, translationLanguage: "uk" }, {});
    expect(result).toHaveLength(800);
    expect(result.every(word => word.examples.length===1 && word.examples[0].selectedTranslation.text==="Це приклад.")).toBe(true);
    expect(fixture.db.word.findMany).toHaveBeenCalledTimes(1);
    expect(fixture.db.wordExample.findMany).not.toHaveBeenCalled();
  });
  it("does not expose examples from foreign private cards through a stray dictionary link", async () => {
    const fixture = makeWordsDatabase(); const prisma = fixture.db as unknown as PrismaService;
    fixture.seedWord("foreign", { publicationStatus: "PENDING_REVIEW", createdByUserId: userB.id });
    await fixture.db.userWord.upsert({ where: { userId_wordId: { userId: userA.id, wordId: "foreign" } }, create: { userId: userA.id, wordId: "foreign" }, update: {} });
    const controller = new WordsController(new WordsService(prisma, new WordAccessService(prisma)), new PersonalTranslationsService(new WordAccessService(prisma), prisma));
    expect(await controller.findMine(userA, {})).toEqual([]);
  });
  it("retains missing selected translations instead of falling back to Russian", async () => {
    const fixture = makeWordsDatabase(); const prisma = fixture.db as unknown as PrismaService;
    const service = new WordsService(prisma, new WordAccessService(prisma));
    await service.create(userA, { german: "testen", article: "none", grammaticalNumber: "not_applicable", examples: [{ german: "Wir testen die Anlage.", translation: "Мы проверяем установку." }] } as any);
    const result = await new WordsController(service, new PersonalTranslationsService(new WordAccessService(prisma), prisma)).findMine({ ...userA, translationLanguage: "en" }, {});
    expect(result[0].examples[0].selectedTranslation).toEqual({ language: "en", text: null });
  });
});
