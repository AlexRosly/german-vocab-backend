import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../prisma.service";
import { CreateWordDto } from "./dto/create-word.dto";
import { UpdateWordDto } from "./dto/update-word.dto";
import { meaningWhere, translationEntries } from "./translation-data";
import { dictionaryWords, WordAccessService, WORD_INCLUDE } from "./word-access.service";

function searchWhere(query?: string): Prisma.WordWhereInput {
  if (!query) return {};
  return { OR: [
    { german: { contains: query, mode: "insensitive" } },
    { translation: { contains: query, mode: "insensitive" } },
    { translations: { some: { text: { contains: query, mode: "insensitive" } } } },
  ] };
}

@Injectable()
export class WordsService {
  constructor(private readonly prisma: PrismaService, private readonly access: WordAccessService) {}

  findAll(query?: string) {
    return this.prisma.word.findMany({
      where: { AND: [{ publicationStatus: "PUBLISHED" }, searchWhere(query)] },
      include: WORD_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  findMine(user: AuthUser, query?: string) {
    return this.prisma.word.findMany({
      where: { AND: [
        { userWords: { some: { userId: user.id } } },
        dictionaryWords(user.id),
        searchWhere(query),
      ] },
      include: { ...WORD_INCLUDE, examples: { include: { translations: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
      orderBy: { createdAt: "desc" },
    });
  }

  findOne(user: AuthUser, id: string) {
    return this.access.requireReadable(user, id);
  }

  create(user: AuthUser, dto: CreateWordDto) {
    return this.access.transaction(async (tx) => {
      const entries = translationEntries(dto);
      const data = this.cardData({ ...dto, translation: entries.find((entry) => entry.language === "ru")?.text ?? "" });
      await this.ensureNoDuplicate(tx, user, data, entries);
      return tx.word.create({
        data: {
          ...data,
          publicationStatus: "PENDING_REVIEW",
          createdByUserId: user.id,
          translations: { create: entries },
          examples: { create: (dto.examples ?? []).map((example) => {
            const translations = translationEntries(example);
            return { german: example.german.normalize("NFC").trim(), translation: translations.find((entry) => entry.language === "ru")?.text ?? "", translations: { create: translations } };
          }) },
          userWords: { create: { userId: user.id } },
        },
        include: WORD_INCLUDE,
      });
    });
  }

  update(user: AuthUser, id: string, dto: UpdateWordDto) {
    return this.access.transaction(async (tx) => {
      await this.access.beginEdit(tx, user, id);
      const current = await this.access.requireReadable(user, id, tx);
      const entries = translationEntries(dto, current.translations, current.translation);
      const data = this.cardData({
        german: dto.german ?? current.german,
        article: dto.article ?? current.article,
        grammaticalNumber: dto.grammaticalNumber ?? current.grammaticalNumber,
        translation: entries.find((entry) => entry.language === "ru")?.text ?? "",
        pluralForm: dto.pluralForm === undefined ? current.pluralForm : dto.pluralForm,
        level: dto.level === undefined ? current.level : dto.level,
        lessonNumber: dto.lessonNumber === undefined ? current.lessonNumber : dto.lessonNumber,
        notes: dto.notes === undefined ? current.notes : dto.notes,
      });
      await this.ensureNoDuplicate(tx, user, data, entries, id);
      await tx.word.update({ where: { id }, data });
      for (const language of (dto.translations ?? []).filter((entry) => entry.text === null).map((entry) => entry.language)) {
        await tx.wordTranslation.deleteMany({ where: { wordId: id, language } });
      }
      for (const entry of entries) await tx.wordTranslation.upsert({
        where: { wordId_language: { wordId: id, language: entry.language } },
        create: { wordId: id, ...entry }, update: { text: entry.text },
      });
      return this.access.requireReadable(user, id, tx);
    });
  }

  addToDictionary(user: AuthUser, wordId: string) {
    return this.access.transaction(async (tx) => {
      const word = await tx.word.findFirst({
        where: { AND: [{ id: wordId }, dictionaryWords(user.id)] },
        include: WORD_INCLUDE,
      });
      if (!word) throw new NotFoundException("Карточка не найдена");
      await tx.userWord.upsert({
        where: { userId_wordId: { userId: user.id, wordId } },
        create: { userId: user.id, wordId },
        update: {},
      });
      return word;
    });
  }

  async removeFromDictionary(user: AuthUser, wordId: string) {
    await this.prisma.userWord.deleteMany({ where: { userId: user.id, wordId } });
    return { deleted: true };
  }

  private cardData(dto: {
    german: string; article: string; grammaticalNumber: string; translation: string;
    pluralForm?: string | null; level?: string | null; lessonNumber?: number | null; notes?: string | null;
  }) {
    return {
      german: dto.german.normalize("NFC").trim().replace(/\s+/gu, " "),
      article: dto.article as CreateWordDto["article"],
      grammaticalNumber: dto.grammaticalNumber as CreateWordDto["grammaticalNumber"],
      translation: dto.translation.normalize("NFC").trim(),
      pluralForm: dto.pluralForm?.normalize("NFC").trim() || null,
      level: (dto.level ?? null) as CreateWordDto["level"],
      lessonNumber: dto.lessonNumber ?? null,
      notes: dto.notes?.normalize("NFC").trim() || null,
    };
  }

  private async ensureNoDuplicate(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    data: ReturnType<WordsService["cardData"]>,
    entries: { language: string; text: string }[],
    excludedId?: string,
  ): Promise<void> {
    // Never report another author's private card or merge ambiguous meanings.
    const duplicate = await tx.word.findFirst({
      where: { AND: [
        dictionaryWords(user.id),
        {
          ...(excludedId ? { id: { not: excludedId } } : {}),
          german: { equals: data.german, mode: "insensitive" },
          article: data.article,
          grammaticalNumber: data.grammaticalNumber,
          ...meaningWhere(entries, data.translation),
          pluralForm: data.pluralForm,
          notes: data.notes,
        },
      ] },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        message: "Доступная карточка с таким словом, формой и переводом уже существует",
        wordId: duplicate.id,
      });
    }
  }
}
