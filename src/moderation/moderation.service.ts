import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, WordPublicationStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../prisma.service";
import { WORD_INCLUDE } from "../words/word-access.service";
import { ChangePublicationStatusDto } from "./dto/change-publication-status.dto";

const DETAIL_INCLUDE = {
  translations: { orderBy: { language: "asc" } },
  examples: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.WordInclude;
type ReviewCard = Prisma.WordGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function withRevision(word: ReviewCard) {
  const content = {
    id: word.id,
    german: word.german,
    article: word.article,
    grammaticalNumber: word.grammaticalNumber,
    translation: word.translation,
    pluralForm: word.pluralForm,
    level: word.level,
    lessonNumber: word.lessonNumber,
    notes: word.notes,
    publicationStatus: word.publicationStatus,
    createdByUserId: word.createdByUserId,
    updatedAt: word.updatedAt,
    translations: word.translations.map(({ id, language, text, updatedAt }) => ({ id, language, text, updatedAt })).sort((a, b) => a.id.localeCompare(b.id)),
    examples: word.examples.map(({ id, german, translation, updatedAt }) => ({ id, german, translation, updatedAt })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  return { ...word, revision: createHash("sha256").update(JSON.stringify(content)).digest("hex") };
}

@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: AuthUser, status: WordPublicationStatus = "PENDING_REVIEW") {
    this.requireAdmin(user);
    return this.prisma.word.findMany({
      where: { publicationStatus: status },
      include: WORD_INCLUDE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  async findOne(user: AuthUser, id: string) {
    this.requireAdmin(user);
    const word = await this.prisma.word.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!word) throw new NotFoundException("Карточка не найдена");
    return withRevision(word);
  }

  async changeStatus(user: AuthUser, id: string, dto: ChangePublicationStatusDto) {
    this.requireAdmin(user);
    return this.writeTransaction(async (tx) => {
      const word = await tx.word.findUnique({ where: { id }, include: DETAIL_INCLUDE });
      if (!word) throw new NotFoundException("Карточка не найдена");
      const reviewed = withRevision(word);
      if (reviewed.revision !== dto.expectedRevision) {
        throw new ConflictException({ code: "STALE_REVIEW", message: "Карточка изменилась. Откройте её заново перед решением" });
      }
      if (word.publicationStatus === dto.publicationStatus) return reviewed;
      if (dto.publicationStatus === "PUBLISHED") await this.checkPublishedDuplicate(tx, word);

      // Serializable retries re-read the revision if an author changes the card while it is reviewed.
      const updated = await tx.word.update({
        where: { id },
        data: { publicationStatus: dto.publicationStatus },
        include: DETAIL_INCLUDE,
      });
      return withRevision(updated);
    });
  }

  private requireAdmin(user: AuthUser): void {
    if (user.role !== "ADMIN") throw new ForbiddenException("Требуются права администратора");
  }

  private async checkPublishedDuplicate(tx: Prisma.TransactionClient, word: ReviewCard): Promise<void> {
    const duplicate = await tx.word.findFirst({
      where: {
        id: { not: word.id },
        publicationStatus: "PUBLISHED",
        german: { equals: word.german, mode: "insensitive" },
        article: word.article,
        grammaticalNumber: word.grammaticalNumber,
        translation: word.translation,
        pluralForm: word.pluralForm,
        notes: word.notes,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        code: "DUPLICATE_WORD",
        message: "В библиотеке уже есть карточка с таким словом, формой и переводом",
        wordId: duplicate.id,
      });
    }
  }

  private async writeTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error;
        if (attempt === 2) throw new ConflictException("Конфликт одновременных изменений. Откройте карточку заново");
      }
    }
    throw new ConflictException("Повторите запрос");
  }
}
