import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { AuthUser } from "../auth/auth.service";
import { WordAccessService, readableWords, WORD_INCLUDE } from "./word-access.service";

@Injectable()
export class WordRelationsService {
  constructor(private readonly access: WordAccessService) {}

  list(user: AuthUser, id: string) {
    return this.access.transaction(async (tx) => {
      await this.access.requireReadable(user, id, tx);
      const edges = await tx.wordRelation.findMany({ where: { OR: [{ leftWordId: id }, { rightWordId: id }] } });
      const ids = edges.map(edge => edge.leftWordId === id ? edge.rightWordId : edge.leftWordId);
      // Filter targets on every request: publication may change after linking.
      return tx.word.findMany({ where: { AND: [{ id: { in: ids } }, readableWords(user)] }, include: WORD_INCLUDE, orderBy: [{ german: "asc" }, { id: "asc" }] });
    });
  }

  save(user: AuthUser, id: string, relatedId: string, remove = false) {
    if (user.role !== "ADMIN") throw new ForbiddenException("Требуются права администратора");
    if (id === relatedId) throw new BadRequestException("Нельзя связать карточку с самой собой");
    const pair = id < relatedId ? { leftWordId: id, rightWordId: relatedId } : { leftWordId: relatedId, rightWordId: id };
    return this.access.transaction(async (tx) => {
      await this.access.requireReadable(user, id, tx);
      await this.access.requireReadable(user, relatedId, tx);
      if (remove) {
        await tx.wordRelation.deleteMany({ where: pair });
        return { deleted: true };
      }
      await tx.wordRelation.upsert({ where: { leftWordId_rightWordId: pair }, create: pair, update: {} });
      return { linked: true };
    });
  }
}
