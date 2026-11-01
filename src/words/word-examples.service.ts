import { Injectable, NotFoundException } from "@nestjs/common";
import { AuthUser } from "../auth/auth.service";
import { presentWord } from "../languages/word-presentation";
import { CreateWordExampleDto } from "./dto/create-word-example.dto";
import { UpdateWordExampleDto } from "./dto/update-word-example.dto";
import { WordAccessService } from "./word-access.service";
import { translationEntries } from "./translation-data";

@Injectable()
export class WordExamplesService {
  constructor(private readonly access: WordAccessService) {}

  list(user: AuthUser, wordId: string) {
    return this.access.transaction(async (tx) => {
      await this.access.requireReadable(user, wordId, tx);
      const examples = await tx.wordExample.findMany({ where: { wordId }, include: { translations: true }, orderBy: { createdAt: "asc" } });
      return examples.map((example) => presentWord(example, user.translationLanguage));
    });
  }

  create(user: AuthUser, wordId: string, dto: CreateWordExampleDto) {
    return this.access.transaction(async (tx) => {
      await this.access.beginEdit(tx, user, wordId);
      const entries = translationEntries(dto);
      const example = await tx.wordExample.create({ data: {
        wordId, german: dto.german.normalize("NFC").trim(),
        translation: entries.find((entry) => entry.language === "ru")?.text ?? "",
        translations: { create: entries },
      }, include: { translations: true } });
      return presentWord(example, user.translationLanguage);
    });
  }

  update(user: AuthUser, wordId: string, exampleId: string, dto: UpdateWordExampleDto) {
    return this.access.transaction(async (tx) => {
      await this.access.beginEdit(tx, user, wordId);
      const current = await tx.wordExample.findFirst({ where: { id: exampleId, wordId }, include: { translations: true } });
      if (!current) throw new NotFoundException("Пример не найден");
      const entries = translationEntries(dto, current.translations, current.translation);
      await tx.wordExample.updateMany({ where: { id: exampleId, wordId }, data: {
        ...(dto.german !== undefined ? { german: dto.german.normalize("NFC").trim() } : {}),
        translation: entries.find((entry) => entry.language === "ru")?.text ?? "",
      } });
      for (const entry of dto.translations ?? []) if (entry.text === null) await tx.wordExampleTranslation.deleteMany({ where: { exampleId, language: entry.language } });
      for (const entry of entries) await tx.wordExampleTranslation.upsert({
        where: { exampleId_language: { exampleId, language: entry.language } },
        create: { exampleId, ...entry }, update: { text: entry.text },
      });
      const saved = await tx.wordExample.findFirst({ where: { id: exampleId, wordId }, include: { translations: true } });
      return presentWord(saved!, user.translationLanguage);
    });
  }

  remove(user: AuthUser, wordId: string, exampleId: string) {
    return this.access.transaction(async (tx) => {
      await this.access.beginEdit(tx, user, wordId);
      const example = await tx.wordExample.findFirst({ where: { id: exampleId, wordId }, include: { translations: true } });
      if (!example) throw new NotFoundException("Пример не найден");
      await tx.wordExample.deleteMany({ where: { id: exampleId, wordId } });
      return presentWord(example, user.translationLanguage);
    });
  }
}
