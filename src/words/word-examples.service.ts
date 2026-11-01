import { Injectable, NotFoundException } from "@nestjs/common";
import { AuthUser } from "../auth/auth.service";
import { CreateWordExampleDto } from "./dto/create-word-example.dto";
import { UpdateWordExampleDto } from "./dto/update-word-example.dto";
import { WordAccessService } from "./word-access.service";

@Injectable()
export class WordExamplesService {
  constructor(private readonly access: WordAccessService) {}

  async list(user: AuthUser, wordId: string) {
    return this.access.transaction(async (tx) => {
      await this.access.requireReadable(user, wordId, tx);
      return tx.wordExample.findMany({ where: { wordId }, orderBy: { createdAt: "asc" } });
    });
  }

  create(user: AuthUser, wordId: string, dto: CreateWordExampleDto) {
    return this.access.transaction(async (tx) => {
      await this.access.beginEdit(tx, user, wordId);
      return tx.wordExample.create({
        data: { wordId, german: dto.german.trim(), translation: dto.translation.trim() },
      });
    });
  }

  update(user: AuthUser, wordId: string, exampleId: string, dto: UpdateWordExampleDto) {
    return this.access.transaction(async (tx) => {
      await this.access.beginEdit(tx, user, wordId);
      const updated = await tx.wordExample.updateMany({
        where: { id: exampleId, wordId },
        data: {
          ...(dto.german !== undefined ? { german: dto.german.trim() } : {}),
          ...(dto.translation !== undefined ? { translation: dto.translation.trim() } : {}),
        },
      });
      if (updated.count !== 1) throw new NotFoundException("Пример не найден");
      return tx.wordExample.findFirst({ where: { id: exampleId, wordId } });
    });
  }

  remove(user: AuthUser, wordId: string, exampleId: string) {
    return this.access.transaction(async (tx) => {
      await this.access.beginEdit(tx, user, wordId);
      const example = await tx.wordExample.findFirst({ where: { id: exampleId, wordId } });
      if (!example) throw new NotFoundException("Пример не найден");
      await tx.wordExample.deleteMany({ where: { id: exampleId, wordId } });
      return example;
    });
  }
}
