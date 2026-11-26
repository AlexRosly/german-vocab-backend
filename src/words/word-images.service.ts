import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../prisma.service";
import { WordAccessService } from "./word-access.service";
import { encodeWordImage, ImageFile, WordImageStore } from "./word-image-store";

@Injectable()
export class WordImagesService {
  constructor(private readonly prisma: PrismaService, private readonly access: WordAccessService, private readonly store: WordImageStore) {}
  async config() {
    if (process.env.WORD_IMAGES_ENABLED !== "true") return { enabled: false, version: 1 };
    const result = await this.prisma.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public.word_images') IS NOT NULL AS ready`;
    return { enabled: result[0]?.ready === true, version: 1 };
  }
  private async ready() { if (!(await this.config()).enabled) throw new ServiceUnavailableException("Изображения карточек пока недоступны"); }
  private present(image: { revision: string; width: number; height: number; bytes: number } | null) { return image ? { revision: image.revision, width: image.width, height: image.height, bytes: image.bytes } : null; }
  async get(user: AuthUser, wordId: string) {
    await this.ready(); await this.access.requireReadable(user, wordId);
    return { image: this.present(await this.prisma.wordImage.findUnique({ where: { wordId } })) };
  }
  async content(user: AuthUser, wordId: string, revision: string) {
    await this.ready(); await this.access.requireReadable(user, wordId);
    const current = await this.prisma.wordImage.findUnique({ where: { wordId } });
    if (!current || current.revision !== revision) throw new NotFoundException("Изображение изменилось. Обновите карточку");
    return this.store.read(current.storageKey, current.sha256, current.bytes);
  }
  async save(user: AuthUser, wordId: string, revision: string | null, file: ImageFile) {
    await this.ready();
    const word = await this.access.requireReadable(user, wordId);
    if (user.role !== "ADMIN" && (word.createdByUserId !== user.id || word.publicationStatus === "PUBLISHED")) throw new ForbiddenException("Изменение этой карточки недоступно");
    const previous = await this.prisma.wordImage.findUnique({ where: { wordId } });
    if ((previous?.revision ?? null) !== revision) throw new ConflictException("Изображение изменилось. Загрузите актуальную версию");
    const encoded = await encodeWordImage(file);
    const storageKey = await this.store.write(encoded);
    return this.access.transaction(async tx => {
      await this.access.beginEdit(tx, user, wordId);
      const current = await tx.wordImage.findUnique({ where: { wordId } });
      if ((current?.revision ?? null) !== revision) throw new ConflictException("Изображение изменилось. Загрузите актуальную версию");
      const data = { storageKey, sha256: encoded.sha256, bytes: encoded.data.length, width: encoded.width, height: encoded.height, revision: storageKey.slice(0, -5) };
      const saved = await tx.wordImage.upsert({ where: { wordId }, create: { wordId, ...data }, update: data });
      return { image: this.present(saved) };
    });
  }
  async remove(user: AuthUser, wordId: string, revision: string | null) {
    await this.ready();
    return this.access.transaction(async tx => {
      await this.access.beginEdit(tx, user, wordId);
      const current = await tx.wordImage.findUnique({ where: { wordId } });
      if ((current?.revision ?? null) !== revision) throw new ConflictException("Изображение изменилось. Загрузите актуальную версию");
      if (current) await tx.wordImage.delete({ where: { wordId } });
      return { image: null };
    });
  }
}
