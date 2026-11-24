import { personalExamplesReady } from "../words/personal-example-translations.service";
import { exportHistory, historyPeriod, type HistoryKind } from "./study-history-csv";
import { importSchemaReady } from "../dictionary-import/import-schema";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../prisma.service";
import { dictionaryWords } from "../words/word-access.service";
import { csvHeader, csvLine, EXPORT_COLUMNS, MAX_EXPORT_BYTES, MAX_EXPORT_WORDS, tooLarge, wordRow } from "./dictionary-csv";

const select = (userId: string, lessons: boolean, personalExamples: boolean) => ({
  id: true, german: true, article: true, grammaticalNumber: true, pluralForm: true, level: true, sourceBook: true, lessonNumber: true, notes: true, translation: true,
  translations: { select: { language: true, text: true }, orderBy: { language: "asc" } },
  verbForms: { select: { praeteritum: true, participle2: true, auxiliary: true, reflexive: true, usage: true }, orderBy: { position: "asc" } },
  examples: { select: { id: true, german: true, translation: true, ...(personalExamples ? {personalTranslations:{where:{userId},select:{language:true,text:true,sourceGerman:true},orderBy:{language:"asc" as const}}}:{}), translations: { select: { language: true, text: true }, orderBy: { language: "asc" } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  bookSources: { select: { sourceBook: true, lessonNumbers: true }, orderBy: { sourceBook: "asc" } },
  userWords: { where: { userId }, select: { isFavorite: true, isArchived: true, isDifficult: true } },
  personalNotes: { where: { userId }, select: { text: true } },
  personalTranslations: { where: { userId }, select: { language: true, text: true }, orderBy: { language: "asc" } },
  personalBooks: { where: { userId }, select: { titles: true, ...(lessons ? { lessons: true } : {}) } },
} satisfies Prisma.WordSelect);

@Injectable()
export class DictionaryExportService {
  constructor(private readonly prisma: PrismaService) {}
  history(user: AuthUser, kind: HistoryKind, period: { from?: string; to?: string }) {
    historyPeriod(period);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return exportHistory(tx, user.id, kind, period);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 60_000 });
  }
  export(user: AuthUser): Promise<{ csv: string; wordCount: number }> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      // ADMIN also exports only their own membership and private materials.
      const where: Prisma.WordWhereInput = { AND: [dictionaryWords(user.id), { userWords: { some: { userId: user.id } } }] };
      if (await tx.word.count({ where }) > MAX_EXPORT_WORDS || await tx.wordExample.count({ where: { word: where } }) > 10_000) tooLarge();
      const lessons = await importSchemaReady(tx), personalExamples = await personalExamplesReady(tx);
      const chunks = [csvHeader(EXPORT_COLUMNS)]; let bytes = Buffer.byteLength(chunks[0]), wordCount = 0, lastId: string | undefined;
      for (;;) {
        const words = await tx.word.findMany({ where, select: select(user.id, lessons, personalExamples), orderBy: { id: "asc" }, take: 200, ...(lastId ? { cursor: { id: lastId }, skip: 1 } : {}) });
        for (const word of words) {
          if (!word.userWords[0]) continue;
          const line = csvLine(EXPORT_COLUMNS, wordRow(word)); bytes += Buffer.byteLength(line);
          if (bytes > MAX_EXPORT_BYTES || ++wordCount > MAX_EXPORT_WORDS) tooLarge();
          chunks.push(line);
        }
        if (words.length < 200) break;
        lastId = words[words.length - 1].id;
      }
      return { csv: chunks.join(""), wordCount };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 60_000 });
  }
}
