import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { dictionaryWords, WordAccessService } from "./word-access.service";
import { SavePersonalBooksDto } from "./dto/personal-books.dto";
const select = { titles: true, revision: true } satisfies Prisma.PersonalWordBooksSelect;
@Injectable()
export class PersonalBooksService {
  constructor(private readonly access: WordAccessService) {}
  private async requireOwnWord(tx: Prisma.TransactionClient, userId: string, wordId: string) {
    const word = await tx.word.findFirst({ where: { AND: [{ id: wordId }, { userWords: { some: { userId } } }, dictionaryWords(userId)] }, select: { id: true } });
    if (!word) throw new NotFoundException("Слово недоступно в вашем словаре");
  }
  get(userId: string, wordId: string) {
    return this.access.transaction(async tx => {
      await this.requireOwnWord(tx, userId, wordId);
      const books = await tx.personalWordBooks.findUnique({ where: { userId_wordId: { userId, wordId } }, select });
      return { wordId, titles: books?.titles ?? [], revision: books?.revision ?? null };
    });
  }
  save(userId: string, wordId: string, dto: SavePersonalBooksDto) {
    return this.access.transaction(async tx => {
      await this.requireOwnWord(tx, userId, wordId);
      const key = { userId, wordId };
      const books = await tx.personalWordBooks.findUnique({ where: { userId_wordId: key }, select });
      if ((books?.revision ?? null) !== dto.revision) throw this.conflict();
      if (!dto.titles.length) {
        if (books) {
          const deleted = await tx.personalWordBooks.deleteMany({ where: { ...key, revision: dto.revision! } });
          if (deleted.count !== 1) throw this.conflict();
        }
        return { wordId, titles: [], revision: null };
      }
      const revision = randomUUID();
      if (!books) await tx.personalWordBooks.create({ data: { ...key, titles: dto.titles, revision } });
      else {
        const updated = await tx.personalWordBooks.updateMany({ where: { ...key, revision: dto.revision! }, data: { titles: dto.titles, revision } });
        if (updated.count !== 1) throw this.conflict();
      }
      return { wordId, titles: dto.titles, revision };
    });
  }
  private conflict() { return new ConflictException("Книги изменились. Загрузите актуальную версию."); }
}
