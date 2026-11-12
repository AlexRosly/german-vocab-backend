import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../prisma.service";

export const WORD_INCLUDE = { translations: true, bookSources: { select: { sourceBook: true, lessonNumbers: true } } } satisfies Prisma.WordInclude;

export function readableWords(user: AuthUser): Prisma.WordWhereInput {
  return user.role === "ADMIN" ? {} : dictionaryWords(user.id);
}

export function dictionaryWords(userId: string): Prisma.WordWhereInput {
  return { OR: [{ publicationStatus: "PUBLISHED" }, { createdByUserId: userId }] };
}

@Injectable()
export class WordAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireReadable(user: AuthUser, wordId: string, db: Prisma.TransactionClient = this.prisma) {
    const word = await db.word.findFirst({
      where: { AND: [{ id: wordId }, readableWords(user)] },
      include: WORD_INCLUDE,
    });
    if (!word) throw new NotFoundException("Карточка не найдена");
    return word;
  }

  async beginEdit(tx: Prisma.TransactionClient, user: AuthUser, wordId: string): Promise<void> {
    const isAdmin = user.role === "ADMIN";
    // Check permissions and hold the row lock until commit, including against publication.
    const updated = await tx.word.updateMany({
      where: isAdmin ? { id: wordId } : {
        id: wordId,
        createdByUserId: user.id,
        publicationStatus: { in: ["PENDING_REVIEW", "REJECTED"] },
      },
      data: isAdmin ? { updatedAt: new Date() } : { publicationStatus: "PENDING_REVIEW" },
    });
    if (updated.count === 1) return;
    await this.requireReadable(user, wordId, tx);
    throw new ForbiddenException("Изменение этой карточки недоступно");
  }

  async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        });
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2034" || error.code === "P2002");
        if (!retryable) throw error;
        if (attempt === 2) throw new ConflictException("Конфликт одновременных изменений. Повторите запрос");
      }
    }
    throw new ConflictException("Повторите запрос");
  }
}
