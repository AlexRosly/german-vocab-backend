import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { dictionaryWords, WordAccessService } from "./word-access.service";
import { SavePersonalNoteDto } from "./dto/personal-note.dto";
const select = { text: true, revision: true } satisfies Prisma.PersonalWordNoteSelect;
@Injectable()
export class PersonalNotesService {
  constructor(private readonly access: WordAccessService) {}
  private async requireOwnWord(tx: Prisma.TransactionClient, userId: string, wordId: string) {
    const word = await tx.word.findFirst({ where: { AND: [{ id: wordId }, { userWords: { some: { userId } } }, dictionaryWords(userId)] }, select: { id: true } });
    if (!word) throw new NotFoundException("Слово недоступно в вашем словаре");
  }
  get(userId: string, wordId: string) {
    return this.access.transaction(async (tx) => {
      await this.requireOwnWord(tx, userId, wordId);
      const note = await tx.personalWordNote.findUnique({ where: { userId_wordId: { userId, wordId } }, select });
      return { wordId, text: note?.text ?? null, revision: note?.revision ?? null };
    });
  }
  save(userId: string, wordId: string, dto: SavePersonalNoteDto) {
    return this.access.transaction(async (tx) => {
      await this.requireOwnWord(tx, userId, wordId);
      const key = { userId, wordId };
      const note = await tx.personalWordNote.findUnique({ where: { userId_wordId: key }, select });
      if ((note?.revision ?? null) !== dto.revision) throw this.conflict();
      if (!dto.text) {
        if (note) {
          const deleted = await tx.personalWordNote.deleteMany({ where: { ...key, revision: dto.revision! } });
          if (deleted.count !== 1) throw this.conflict();
        }
        return { wordId, text: null, revision: null };
      }
      const revision = randomUUID();
      if (!note) await tx.personalWordNote.create({ data: { ...key, text: dto.text, revision } });
      else {
        const updated = await tx.personalWordNote.updateMany({ where: { ...key, revision: dto.revision! }, data: { text: dto.text, revision } });
        if (updated.count !== 1) throw this.conflict();
      }
      return { wordId, text: dto.text, revision };
    });
  }
  private conflict() { return new ConflictException("Личная заметка изменилась. Загрузите актуальную версию."); }
}
