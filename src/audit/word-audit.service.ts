import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";

@Injectable()
export class WordAuditService {
  constructor(private readonly prisma: PrismaService) {}
  async ready() {
    const rows = await this.prisma.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public.word_audit_events') IS NOT NULL AS ready`;
    return rows[0]?.ready === true;
  }
  async list(query: { page: number; search?: string; wordId?: string }) {
    if (!await this.ready()) throw new ServiceUnavailableException("Журнал изменений пока недоступен");
    const where: Prisma.WordAuditEventWhereInput = { ...(query.wordId ? { wordId: query.wordId } : {}), ...(query.search ? { wordGerman: { contains: query.search, mode: "insensitive" } } : {}) };
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const items = await tx.wordAuditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * 25, take: 25,
        select: { id: true, wordId: true, wordGerman: true, entity: true, action: true, before: true, after: true, actorId: true, actorRole: true, transactionId: true, createdAt: true } });
      return { page: query.page, pageSize: 25, total: await tx.wordAuditEvent.count({ where }), items: items.map(({ actorId, actorRole, ...row }) => ({ ...row, actor: !actorId ? "system" : actorRole === "ADMIN" ? "admin" : "user" })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
  }
}
