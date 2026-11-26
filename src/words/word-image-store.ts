import { BadRequestException, HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as sharpModule from "sharp";
const sharp = sharpModule as unknown as typeof import("sharp").default;

export const IMAGE_UPLOAD_LIMIT = 4 * 1024 * 1024;
export const IMAGE_OUTPUT_LIMIT = 96 * 1024;
const STORAGE_LIMIT = 384 * 1024 * 1024;
const imageKey = /^[a-f0-9-]{36}\.webp$/;
export type ImageFile = { buffer: Buffer; size: number; mimetype: string };
export type EncodedImage = { data: Buffer; width: number; height: number; sha256: string };

let encoding = false;
export async function encodeWordImage(file?: ImageFile): Promise<EncodedImage> {
  if (encoding) throw new HttpException("Другое изображение ещё обрабатывается. Повторите через несколько секунд", 429);
  encoding = true;
  try { return await normalizeWordImage(file); } finally { encoding = false; }
}
async function normalizeWordImage(file?: ImageFile): Promise<EncodedImage> {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length || file.buffer.length > IMAGE_UPLOAD_LIMIT || file.size !== file.buffer.length) throw new BadRequestException("Выберите JPEG, PNG или WebP до 4 МБ");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) throw new BadRequestException("Выберите JPEG, PNG или WebP до 4 МБ");
  try {
    const image = sharp(file.buffer, { limitInputPixels: 24_000_000, failOn: "warning", animated: false });
    const meta = await image.metadata();
    const expected = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[file.mimetype];
    if (meta.format !== expected || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw Error("unsupported_image");
    // Re-encoding strips EXIF/GPS and rejects SVG, animation, corrupt data and oversized dimensions.
    for (const [edge, quality] of [[720, 78], [600, 62], [480, 45]]) {
      const result = await image.clone().rotate().resize(edge, edge, { fit: "inside", withoutEnlargement: true }).webp({ quality, effort: 3 }).toBuffer({ resolveWithObject: true });
      if (result.data.length <= IMAGE_OUTPUT_LIMIT) return { data: result.data, width: result.info.width, height: result.info.height, sha256: createHash("sha256").update(result.data).digest("hex") };
    }
  } catch { throw new BadRequestException("Не удалось прочитать изображение. Выберите JPEG, PNG или WebP без анимации"); }
  throw new BadRequestException("Изображение слишком сложное. Выберите файл меньшего размера");
}

@Injectable()
export class WordImageStore {
  readonly root = path.resolve(process.cwd(), "storage/word-images");
  private writing: Promise<void> = Promise.resolve();
  private async directory() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw new ServiceUnavailableException("Хранилище изображений недоступно");
  }
  async write(image: EncodedImage) {
    const previous = this.writing; let unlock!: () => void;
    this.writing = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    try {
      await this.directory();
      let total = 0;
      const names = await fs.readdir(this.root);
      if (names.length >= 10000) throw new ServiceUnavailableException("Хранилище изображений заполнено. Обратитесь к администратору");
      for (const name of names) {
        const stat = await fs.lstat(path.join(this.root, name));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new ServiceUnavailableException("Хранилище изображений недоступно");
        total += stat.size;
      }
      if (total + image.data.length > STORAGE_LIMIT) throw new ServiceUnavailableException("Хранилище изображений заполнено. Обратитесь к администратору");
      const key = randomUUID() + ".webp";
      const handle = await fs.open(path.join(this.root, key), "wx", 0o600);
      try { await handle.writeFile(image.data); await handle.sync(); } finally { await handle.close(); }
      return key;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Хранилище изображений недоступно");
    } finally { unlock(); }
  }
  async read(key: string, expectedHash: string, bytes: number) {
    if (!imageKey.test(key)) throw new ServiceUnavailableException("Изображение временно недоступно");
    try {
      await this.directory();
      const target = path.join(this.root, key);
      const before = await fs.lstat(target);
      if (!before.isFile() || before.isSymbolicLink() || before.size !== bytes || bytes > IMAGE_OUTPUT_LIMIT) throw Error("invalid_file");
      const file = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== bytes) throw Error("invalid_file");
        const data = await file.readFile();
        if (createHash("sha256").update(data).digest("hex") !== expectedHash) throw Error("hash_mismatch");
        return data;
      } finally { await file.close(); }
    } catch { throw new ServiceUnavailableException("Изображение временно недоступно"); }
  }
}
