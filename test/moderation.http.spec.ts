import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { makeModerationDatabase } from "./support/moderation-database";
import { admin, userA, userB } from "./support/words-database";

describe("Moderation HTTP (full AppModule, mocked persistence)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let fixture: ReturnType<typeof makeModerationDatabase>;
  let currentAdminRole: "ADMIN" | "USER";

  beforeEach(async () => {
    fixture = makeModerationDatabase();
    currentAdminRole = "ADMIN";
    fixture.seedWord("pending", { german: "Baum", translation: "дерево", publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id });
    fixture.seedWord("published");
    fixture.seedWord("rejected", { german: "Haus", translation: "дом", publicationStatus: "REJECTED", createdByUserId: userB.id });
    fixture.links.set("author-link", { id: "author-link", userId: userA.id, wordId: "pending", createdAt: new Date() });
    fixture.translations.set("ru-pending", { id: "ru-pending", wordId: "pending", language: "ru", text: "дерево" });
    fixture.examples.set("example", { id: "example", wordId: "pending", german: "Der Baum ist hoch.", translation: "Дерево высокое." });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB :
          token === "c".repeat(43) ? { ...admin, role: currentAdminRole } : null;
        if (!user) throw new UnauthorizedException();
        return { user, sessionId: `session-${user.id}` };
      } })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  afterEach(async () => { await app?.close(); });

  function request(path: string, method = "GET", payload?: unknown, actor = "c", extraHeaders: Record<string, string> = {}) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {}), ...extraHeaders },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }
  async function review(id = "pending") {
    const response = await request(`/moderation/words/${id}`);
    expect(response.status).toBe(200);
    return response.json() as Promise<{ revision: string; [key: string]: any }>;
  }

  it("requires authentication and ADMIN for every moderation endpoint", async () => {
    for (const [path, method] of [
      ["/moderation/words", "GET"], ["/moderation/words/pending", "GET"], ["/moderation/words/pending/status", "PATCH"],
    ]) {
      expect((await request(path, method, undefined, "")).status).toBe(401);
      expect((await request(path, method, undefined, "z")).status).toBe(401);
      expect((await request(path, method, undefined, "a")).status).toBe(403);
    }
    expect(fixture.db.word.findMany).not.toHaveBeenCalled();
    expect(fixture.db.word.findUnique).not.toHaveBeenCalled();
    expect(fixture.db.word.update).not.toHaveBeenCalled();
  });

  it("does not accept an administrative role from headers, query or body", async () => {
    expect((await request("/moderation/words?role=ADMIN", "GET", undefined, "a", { "X-Role": "ADMIN" })).status).toBe(403);
    expect((await request("/moderation/words/pending/status", "PATCH", {
      publicationStatus: "PUBLISHED", expectedRevision: "a".repeat(64), role: "ADMIN", userId: admin.id,
    }, "a")).status).toBe(403);
    expect(fixture.words.get("pending")!.publicationStatus).toBe("PENDING_REVIEW");
  });

  it("returns the pending queue by default and supports explicit status filters", async () => {
    const response = await request("/moderation/words");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).map((word: { id: string }) => word.id)).toEqual(["pending"]);
    expect((await (await request("/moderation/words?status=PUBLISHED")).json()).map((word: { id: string }) => word.id)).toEqual(["published"]);
    expect((await (await request("/moderation/words?status=REJECTED")).json()).map((word: { id: string }) => word.id)).toEqual(["rejected"]);
    for (const query of ["status=INVALID", "status=published", "status=PUBLISHED&status=REJECTED", "userId=user-a"]) {
      expect((await request(`/moderation/words?${query}`)).status).toBe(400);
    }
  });

  it("returns the card, examples, translations and revision, and handles missing IDs", async () => {
    const reviewed = await review();
    expect(reviewed).toMatchObject({ id: "pending", createdByUserId: userA.id, publicationStatus: "PENDING_REVIEW" });
    expect(reviewed.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewed.examples).toEqual([expect.objectContaining({ german: "Der Baum ist hoch." })]);
    expect(reviewed.translations).toEqual([expect.objectContaining({ language: "ru", text: "дерево" })]);
    expect(reviewed).not.toHaveProperty("userWords");
    expect((await request("/moderation/words/missing")).status).toBe(404);
    expect((await request("/moderation/words/missing/status", "PATCH", { publicationStatus: "REJECTED", expectedRevision: reviewed.revision })).status).toBe(404);
  });

  it("publishes a word into the library while keeping the author's link and other dictionaries separate", async () => {
    const reviewed = await review();
    const response = await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ id: "pending", publicationStatus: "PUBLISHED" });
    expect((await (await request("/words", "GET", undefined, "b")).json()).map((word: { id: string }) => word.id)).toContain("pending");
    expect((await (await request("/words/mine", "GET", undefined, "a")).json()).map((word: { id: string }) => word.id)).toEqual(["pending"]);
    expect(await (await request("/words/mine", "GET", undefined, "b")).json()).toEqual([]);
    expect((await request("/words/pending/dictionary", "POST", undefined, "b")).status).toBe(200);
    expect(fixture.words.size).toBe(3);
    expect(fixture.links.size).toBe(2);
    expect((await request("/words/pending", "PATCH", { notes: "author change" }, "a")).status).toBe(403);
  });

  it("rejects a word without removing its author's access or personal link", async () => {
    const reviewed = await review();
    expect((await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "REJECTED", expectedRevision: reviewed.revision })).status).toBe(200);
    expect((await request("/words/pending", "GET", undefined, "a")).status).toBe(200);
    expect((await request("/words/pending", "GET", undefined, "b")).status).toBe(404);
    expect((await request("/words/pending/dictionary", "POST", undefined, "b")).status).toBe(404);
    expect((await (await request("/words/mine", "GET", undefined, "a")).json())[0].publicationStatus).toBe("REJECTED");
    expect(fixture.words.has("pending")).toBe(true);
    expect(fixture.links.has("author-link")).toBe(true);
    expect(fixture.examples.has("example")).toBe(true);
    expect(fixture.translations.has("ru-pending")).toBe(true);
  });

  it("returns an edited rejected card to the moderation queue automatically", async () => {
    const reviewed = await review();
    await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "REJECTED", expectedRevision: reviewed.revision });
    expect((await request("/words/pending", "PATCH", { notes: "Уточнённое значение" }, "a")).status).toBe(200);
    expect((await (await request("/moderation/words")).json()).map((word: { id: string }) => word.id)).toEqual(["pending"]);
    expect(fixture.words.get("pending")!.publicationStatus).toBe("PENDING_REVIEW");
  });

  it("rejects a stale review after author edits through words or examples routes", async () => {
    const reviewed = await review();
    expect((await request("/words/pending", "PATCH", { notes: "Changed after review" }, "a")).status).toBe(200);
    const stale = await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "STALE_REVIEW" });
    const refreshed = await review();
    expect((await request("/words/pending/examples/example", "PATCH", { german: "Ein anderer Baum." }, "a")).status).toBe(200);
    expect((await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "PUBLISHED", expectedRevision: refreshed.revision })).status).toBe(409);
    expect(fixture.words.get("pending")!.publicationStatus).toBe("PENDING_REVIEW");
  });

  it("validates the desired status, revision and extra fields before writing", async () => {
    const reviewed = await review();
    const valid = { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision };
    for (const payload of [
      undefined, null, {}, { ...valid, publicationStatus: "INVALID" }, { ...valid, publicationStatus: null },
      { publicationStatus: "PUBLISHED" }, { ...valid, expectedRevision: "bad" }, { ...valid, expectedRevision: null },
      { ...valid, expectedRevision: "A".repeat(64) }, { ...valid, userId: userA.id }, { ...valid, role: "ADMIN" },
      { ...valid, createdByUserId: admin.id }, { ...valid, translation: "Injected translation" },
    ]) expect((await request("/moderation/words/pending/status", "PATCH", payload)).status).toBe(400);
    expect(fixture.db.word.update).not.toHaveBeenCalled();
  });

  it("does not allow publication through the ordinary words DTO, even for an administrator", async () => {
    expect((await request("/words/pending", "PATCH", { publicationStatus: "PUBLISHED" }, "a")).status).toBe(400);
    expect((await request("/words/pending", "PATCH", { publicationStatus: "PUBLISHED" }, "c")).status).toBe(400);
    expect((await request("/words", "POST", { german: "Arbeit", article: "die", grammaticalNumber: "singular", translation: "работа", publicationStatus: "PUBLISHED" }, "c")).status).toBe(400);
    expect(fixture.words.get("pending")!.publicationStatus).toBe("PENDING_REVIEW");
  });

  it("blocks publication of a confirmed exact duplicate without merging records", async () => {
    Object.assign(fixture.words.get("pending")!, { german: "Tisch", translation: "стол" });
    const reviewed = await review();
    const response = await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DUPLICATE_WORD", wordId: "published" });
    expect(fixture.words.size).toBe(3);
    expect(fixture.links.size).toBe(1);
  });

  it("handles repeated decisions without toggling status or repeating a write", async () => {
    const reviewed = await review();
    const published = await (await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).json();
    expect((await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision })).status).toBe(409);
    const repeated = await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "PUBLISHED", expectedRevision: published.revision });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(published);
    expect(fixture.db.word.update).toHaveBeenCalledTimes(1);
  });

  it("uses the administrator's currently resolved role for each new request", async () => {
    expect((await request("/moderation/words")).status).toBe(200);
    currentAdminRole = "USER";
    expect((await request("/moderation/words")).status).toBe(403);
    expect((await request("/moderation/words/pending/status", "PATCH", { publicationStatus: "PUBLISHED", expectedRevision: "a".repeat(64) })).status).toBe(403);
  });
});
