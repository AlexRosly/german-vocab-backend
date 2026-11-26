import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as sharpModule from "sharp";
const sharp = sharpModule as unknown as typeof import("sharp").default;
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { WordAccessService } from "../src/words/word-access.service";
import { WordImageStore, encodeWordImage, IMAGE_UPLOAD_LIMIT } from "../src/words/word-image-store";
import { WordImagesService } from "../src/words/word-images.service";
import { WordImagesController, WordImagesConfigController } from "../src/words/word-images.controller";
import { DictionaryExportThrottle } from "../src/dictionary-export/dictionary-export.controller";
import { makeWordsDatabase, userA, userB, admin } from "./support/words-database";

describe("Word images: HTTP permissions, sanitized files and revisions", () => {
  let app: INestApplication, base: string, root: string, ready: boolean, fixture: ReturnType<typeof makeWordsDatabase>, store: WordImageStore;
  let png: Buffer, rows: Map<string, any>;
  const auth = (actor = "c") => ({ Authorization: `Bearer ${actor.repeat(43)}` });
  beforeEach(async () => {
    process.env.WORD_IMAGES_ENABLED = "true"; ready = true; rows = new Map(); fixture = makeWordsDatabase();
    fixture.seedWord("shared"); fixture.seedWord("own", { publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id }); fixture.seedWord("hidden", { publicationStatus: "PENDING_REVIEW", createdByUserId: userB.id });
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wk-image-test-")); store = new WordImageStore(); Object.defineProperty(store, "root", { value: root });
    png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#b7e5c2" } }).png().toBuffer();
    const db = Object.assign(fixture.db, { $queryRaw: jest.fn(async () => [{ ready }]), wordImage: {
      findUnique: async ({ where }: any) => rows.get(where.wordId) ?? null,
      upsert: async ({ where, create, update }: any) => { const data = rows.has(where.wordId) ? { ...rows.get(where.wordId), ...update } : create; rows.set(where.wordId, data); return data; },
      delete: async ({ where }: any) => { const data = rows.get(where.wordId); rows.delete(where.wordId); return data; },
    } });
    const module = await Test.createTestingModule({ imports: [AuthModule], controllers: [WordImagesController, WordImagesConfigController], providers: [WordImagesService, WordImageStore, WordAccessService, PrismaService, DictionaryExportThrottle] })
      .overrideProvider(WordImageStore).useValue(store).overrideProvider(PrismaService).useValue(db).overrideProvider(AuthService).useValue({ authenticate: async (token: string) => { const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null; if (!user) throw new UnauthorizedException(); return { user, sessionId: "qa" }; } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1"); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  afterEach(async () => { await app?.close(); await fs.rm(root, { recursive: true, force: true }); delete process.env.WORD_IMAGES_ENABLED; });
  function put(id = "shared", revision = "", actor = "c", bytes = png, type = "image/png", extra = false) { const body = new FormData(); body.append("revision", revision); body.append("file", new Blob([new Uint8Array(bytes)], { type }), "../../untrusted.png"); if (extra) body.append("userId", userB.id); return fetch(`${base}/words/${id}/image`, { method: "PUT", headers: auth(actor), body }); }
  const get = (id = "shared", actor = "a") => fetch(`${base}/words/${id}/image`, { headers: auth(actor) });
  it("keeps feature off without enablement or schema and requires authentication", async () => {
    expect((await fetch(base + "/word-images/config")).status).toBe(401);
    ready = false; expect(await (await fetch(base + "/word-images/config", { headers: auth() })).json()).toEqual({ enabled: false, version: 1 }); expect((await get()).status).toBe(503);
    ready = true; delete process.env.WORD_IMAGES_ENABLED; expect((await put()).status).toBe(503); expect(rows.size).toBe(0);
  });
  it("ADMIN uploads common image; users can read but cannot change a published card", async () => {
    expect((await put("shared", "", "a")).status).toBe(403); expect(await fs.readdir(root)).toEqual([]);
    const saved = await put(); expect(saved.status).toBe(200); const data = await saved.json(); expect(data.image.width).toBe(720); expect(data.image.height).toBe(480); expect(data.image.bytes).toBeLessThanOrEqual(98304); expect(data.image.storageKey).toBeUndefined();
    expect(await (await get()).json()).toEqual(data); const binary = await fetch(`${base}/words/shared/image/content?revision=${data.image.revision}`, { headers: auth("a") });
    expect(binary.status).toBe(200); expect(binary.headers.get("Content-Type")).toBe("image/webp"); expect(binary.headers.get("Cache-Control")).toBe("private, no-store"); expect(binary.headers.get("X-Content-Type-Options")).toBe("nosniff"); const bytes = Buffer.from(await binary.arrayBuffer()); expect(bytes.length).toBe(data.image.bytes); expect((await sharp(bytes).metadata()).format).toBe("webp");
  });
  it("owner can change own pending/rejected image; foreign private metadata and bytes stay hidden", async () => {
    expect((await put("own", "", "a")).status).toBe(200); const { image } = await (await get("own", "a")).json();
    expect((await get("own", "b")).status).toBe(404); expect((await fetch(`${base}/words/own/image/content?revision=${image.revision}`, { headers: auth("b") })).status).toBe(404);
    expect((await put("hidden", "", "a")).status).toBe(404);
    fixture.words.get("own")!.publicationStatus = "PUBLISHED"; expect((await put("own", image.revision, "a")).status).toBe(403);
  });
  it("rejects stale replacement/delete; old bytes are retained for matching backups", async () => {
    const first = (await (await put()).json()).image; const secondResponse = await put("shared", first.revision); expect(secondResponse.status).toBe(200); const second = (await secondResponse.json()).image;
    expect(second.revision).not.toBe(first.revision); expect((await put("shared", first.revision)).status).toBe(409);
    const del = (revision: string) => fetch(base + "/words/shared/image", { method: "DELETE", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ revision }) });
    expect((await del(first.revision)).status).toBe(409); expect((await del(second.revision)).status).toBe(200); expect(await (await get()).json()).toEqual({ image: null });
    expect((await fs.readdir(root)).length).toBeGreaterThanOrEqual(2); expect((await fetch(`${base}/words/shared/image/content?revision=${first.revision}`, { headers: auth() })).status).toBe(404);
  });
  it.each([["image/png", Buffer.from("not a picture")], ["image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')], ["image/jpeg", null]])("rejects spoofed/corrupt or unsupported %s input", async (type, value) => {
    expect((await put("shared", "", "c", value ?? png, type)).status).toBe(400); expect(rows.size).toBe(0);
  });
  it("limits upload size and rejects missing/invalid revision and injected fields", async () => {
    expect((await put("shared", "not-a-uuid")).status).toBe(400); expect((await put("shared", "", "c", png, "image/png", true)).status).toBe(400);
    expect((await put("shared", "", "c", Buffer.alloc(IMAGE_UPLOAD_LIMIT + 1))).status).toBe(413); expect(rows.size).toBe(0);
  });
  it("strips metadata and detects missing/corrupt stored files without leaking paths", async () => {
    const jpeg = await sharp(png).jpeg().withMetadata({ orientation: 6 }).toBuffer(); const converted = await encodeWordImage({ buffer: jpeg, size: jpeg.length, mimetype: "image/jpeg" }); expect((await sharp(converted.data).metadata()).exif).toBeUndefined();
    const result = await put(); const image = (await result.json()).image, row = rows.get("shared"); await fs.writeFile(path.join(root, row.storageKey), Buffer.alloc(row.bytes));
    const failure = await fetch(`${base}/words/shared/image/content?revision=${image.revision}`, { headers: auth() }); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain(root);
    await expect(store.read("../outside.webp", "x", 1)).rejects.toMatchObject({ status: 503 });
  });
});
