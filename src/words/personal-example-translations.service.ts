import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuthUser } from "../auth/auth.service";
import { translationLanguage } from "../languages/language-options";
import { presentWord } from "../languages/word-presentation";
import { PrismaService } from "../prisma.service";
import { dictionaryWords, WordAccessService } from "./word-access.service";
import { SavePersonalExampleTranslationDto } from "./dto/personal-example-translation.dto";

export async function personalExamplesReady(db: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<boolean> {
  const result = await db.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public.personal_example_translations') IS NOT NULL AS ready`;
  return result[0]?.ready === true;
}
type Example = { id: string; wordId: string; german: string; translations: readonly { language: string; text: string }[] };
export async function presentPersonalExamples<T extends { id: string; examples?: readonly Example[] }>(db: Prisma.TransactionClient, user: AuthUser, words: readonly T[]) {
  const ids = words.flatMap(w => (w.examples ?? []).map(e => e.id));
  const ready = ids.length > 0 && await personalExamplesReady(db);
  const rows = ready ? await db.personalExampleTranslation.findMany({ where: {
    userId: user.id, language: user.translationLanguage, exampleId: { in: [...new Set(ids)] },
    example: { word: { AND: [dictionaryWords(user.id), { userWords: { some: { userId: user.id } } }] } },
  }, select: { exampleId: true, text: true, sourceGerman: true } }) : [];
  const byId = new Map(rows.map(row => [row.exampleId, row]));
  return words.map(word => ({ ...word, personalExampleTranslationsEnabled: ready, examples: word.examples?.map(example => {
    const common = presentWord(example, user.translationLanguage), personal = byId.get(example.id);
    return !personal ? common : personal.sourceGerman !== example.german
      ? { ...common, personalTranslationStale: true }
      : { ...common, selectedTranslation: { language: user.translationLanguage, text: personal.text, source: "personal" as const } };
  }) }));
}

@Injectable()
export class PersonalExampleTranslationsService {
  constructor(private readonly access: WordAccessService, private readonly prisma: PrismaService) {}
  private async example(tx: Prisma.TransactionClient, userId: string, wordId: string, exampleId: string, language: string) {
    const example = await tx.wordExample.findFirst({ where: { id: exampleId, wordId,
      word: { AND: [dictionaryWords(userId), { userWords: { some: { userId } } }] } }, select: { id: true, german: true, translations: {where:{language},select:{text:true}} } });
    if (!example) throw new NotFoundException("Пример недоступен в вашем словаре");
    if (!await personalExamplesReady(tx)) throw new ServiceUnavailableException("Личные переводы примеров пока недоступны");
    return example;
  }
  private response(wordId: string, exampleId: string, language: string, german: string, commonText: string | null, row: { text: string; revision: string; sourceGerman: string } | null) {
    return { wordId, exampleId, language, german, commonText, text: row?.text ?? null, revision: row?.revision ?? null,
      sourceGerman: row?.sourceGerman ?? null, stale: row !== null && row.sourceGerman !== german };
  }
  get(userId: string, wordId: string, exampleId: string, language: string) {
    language = translationLanguage(language);
    return this.access.transaction(async tx => {
      const example = await this.example(tx, userId, wordId, exampleId, language);
      const row = await tx.personalExampleTranslation.findUnique({ where: { userId_exampleId_language: { userId, exampleId, language } } });
      return this.response(wordId, exampleId, language, example.german, example.translations[0]?.text ?? null, row);
    });
  }
  save(userId: string, wordId: string, exampleId: string, language: string, dto: SavePersonalExampleTranslationDto) {
    language = translationLanguage(language);
    return this.access.transaction(async tx => {
      const example = await this.example(tx, userId, wordId, exampleId, language);
      if (example.german !== dto.sourceGerman) throw new ConflictException("Пример изменился. Перечитайте личный перевод.");
      const key = { userId, exampleId, language }, where = { userId_exampleId_language: key };
      const current = await tx.personalExampleTranslation.findUnique({ where });
      if ((current?.revision ?? null) !== dto.revision) throw this.conflict();
      if (!dto.text) {
        if (current && (await tx.personalExampleTranslation.deleteMany({ where: { ...key, revision: dto.revision! } })).count !== 1) throw this.conflict();
        return this.response(wordId, exampleId, language, example.german, example.translations[0]?.text ?? null, null);
      }
      const data = { text: dto.text, sourceGerman: example.german, revision: randomUUID() };
      if (!current) await tx.personalExampleTranslation.create({ data: { ...key, ...data } });
      else if ((await tx.personalExampleTranslation.updateMany({ where: { ...key, revision: dto.revision! }, data })).count !== 1) throw this.conflict();
      return this.response(wordId, exampleId, language, example.german, example.translations[0]?.text ?? null, data);
    });
  }
  private conflict() { return new ConflictException("Личный перевод изменился. Загрузите актуальную версию."); }
}
