import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { AuthUser } from "../auth/auth.service";
import { presentWord } from "../languages/word-presentation";
import { translationLanguage } from "../languages/language-options";
import { randomUUID } from "node:crypto";
import { dictionaryWords, WordAccessService } from "./word-access.service";
import { SavePersonalTranslationDto } from "./dto/personal-translation.dto";
const select = { text: true, revision: true } satisfies Prisma.PersonalWordTranslationSelect;
@Injectable()
export class PersonalTranslationsService {
  constructor(private readonly access: WordAccessService, private readonly prisma: PrismaService) {}
  private async requireOwnWord(tx: Prisma.TransactionClient, userId: string, wordId: string) {
    const word = await tx.word.findFirst({ where: { AND: [{ id: wordId }, { userWords: { some: { userId } } }, dictionaryWords(userId)] }, select: { id: true } });
    if (!word) throw new NotFoundException("Слово недоступно в вашем словаре");
  }
  get(userId: string, wordId: string, language: string) {
    language = translationLanguage(language);
    return this.access.transaction(async (tx) => {
      await this.requireOwnWord(tx, userId, wordId);
      const note = await tx.personalWordTranslation.findUnique({ where: { userId_wordId_language: { userId, wordId, language } }, select });
      return { wordId, language, text: note?.text ?? null, revision: note?.revision ?? null };
    });
  }
  save(userId: string, wordId: string, language: string, dto: SavePersonalTranslationDto) {
    language = translationLanguage(language);
    return this.access.transaction(async (tx) => {
      await this.requireOwnWord(tx, userId, wordId);
      const key = { userId, wordId, language };
      const note = await tx.personalWordTranslation.findUnique({ where: { userId_wordId_language: key }, select });
      if ((note?.revision ?? null) !== dto.revision) throw this.conflict();
      if (!dto.text) {
        if (note) {
          const deleted = await tx.personalWordTranslation.deleteMany({ where: { ...key, revision: dto.revision! } });
          if (deleted.count !== 1) throw this.conflict();
        }
        return { wordId, language, text: null, revision: null };
      }
      const revision = randomUUID();
      if (!note) await tx.personalWordTranslation.create({ data: { ...key, text: dto.text, revision } });
      else {
        const updated = await tx.personalWordTranslation.updateMany({ where: { ...key, revision: dto.revision! }, data: { text: dto.text, revision } });
        if (updated.count !== 1) throw this.conflict();
      }
      return { wordId, language, text: dto.text, revision };
    });
  }
  // One batched read, scoped to the caller, requested locale and current dictionary visibility.
  async present<T extends { id: string; translations: readonly { language: string; text: string }[] }>(user: AuthUser, words: readonly T[]) {
    if (!words.length) return [];
    const rows = await this.prisma.personalWordTranslation.findMany({
      where: { userId: user.id, language: user.translationLanguage, wordId: { in: [...new Set(words.map(word => word.id))] },
        word: { AND: [{ userWords: { some: { userId: user.id } } }, dictionaryWords(user.id)] } },
      select: { wordId: true, text: true },
    });
    const translations = new Map(rows.map(row => [row.wordId, row.text]));
    return words.map(word => {
      const common = presentWord(word, user.translationLanguage);
      const personal = translations.get(word.id);
      return personal === undefined ? common : { ...common, selectedTranslation: { language: user.translationLanguage, text: personal, source: "personal" as const } };
    });
  }
  private conflict() { return new ConflictException("Личный перевод изменился. Загрузите актуальную версию."); }
}
