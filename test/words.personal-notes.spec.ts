import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { Prisma } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { makeWordsDatabase, userA, userB, admin } from "./support/words-database";
describe("Private word notes (HTTP, real services and mock Prisma)", () => {
  let app: INestApplication; let url: string; let fixture: ReturnType<typeof makeWordsDatabase>;
  let notes: Map<string, { userId: string; wordId: string; text: string; revision: string }>;
  let model: any;
  beforeEach(async () => {
    fixture = makeWordsDatabase(); notes = new Map(); fixture.seedWord("shared", { notes: "Shared hint" });
    fixture.seedWord("private", { publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id });
    model = {
      findUnique: jest.fn(async ({ where }: any) => { const key = where.userId_wordId; const row = notes.get(`${key.userId}:${key.wordId}`); return row ? { text: row.text, revision: row.revision } : null; }),
      create: jest.fn(async ({ data }: any) => { const key = `${data.userId}:${data.wordId}`; if (notes.has(key)) throw new Prisma.PrismaClientKnownRequestError("Unique", { code: "P2002", clientVersion: "6.19.3" }); notes.set(key, { ...data }); return data; }),
      updateMany: jest.fn(async ({ where, data }: any) => { const row = notes.get(`${where.userId}:${where.wordId}`); if (!row || row.revision !== where.revision) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
      deleteMany: jest.fn(async ({ where }: any) => { const key = `${where.userId}:${where.wordId}`; const row = notes.get(key); if (!row || row.revision !== where.revision) return { count: 0 }; notes.delete(key); return { count: 1 }; }),
    };
    Object.assign(fixture.db, { personalWordNote: model });
    const original = fixture.db.$transaction.getMockImplementation()!;
    fixture.db.$transaction.mockImplementation(async (work: any, options: any) => {
      const snapshot = structuredClone([...notes]); try { return await original(work, options); }
      catch (error) { notes.clear(); for (const [key, row] of snapshot) notes.set(key, row); throw error; }
    });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!user) throw new UnauthorizedException(); return { user, sessionId: `auth-${user.id}` };
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1"); url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/words`;
  });
  afterEach(async () => { await app?.close(); });
  const request = (path: string, method = "GET", body?: unknown, actor = "a") => fetch(url + path, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const link = async (id = "shared", actor = "a") => { expect((await request(`/${id}/dictionary`, "POST", undefined, actor)).status).toBe(200); };
  const save = (text = "My own hint", revision: string | null = null, actor = "a", id = "shared") => request(`/${id}/personal-note`, "PUT", { text, revision }, actor);
  it("requires authentication, active own dictionary link and visibility without ADMIN bypass", async () => {
    for (const method of ["GET", "PUT"]) expect((await request("/shared/personal-note", method, method === "PUT" ? { text: "x", revision: null } : undefined, "")).status).toBe(401);
    for (const actor of ["a", "b", "c"]) expect((await request("/shared/personal-note", "GET", undefined, actor)).status).toBe(404);
    fixture.links.set("invalid", { userId: admin.id, wordId: "private" });
    expect((await request("/private/personal-note", "GET", undefined, "c")).status).toBe(404);
    expect(model.create).not.toHaveBeenCalled();
  });
  it("keeps different users' notes separate even for the same shared published card", async () => {
    for (const actor of ["a", "b", "c"]) await link("shared", actor);
    const a = await save(); const body = await a.json(); expect(a.status).toBe(200); expect(a.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(["revision", "text", "wordId"]);
    expect(body).toEqual({ wordId: "shared", text: "My own hint", revision: expect.any(String) });
    await save("B private hint", null, "b");
    expect(await (await request("/shared/personal-note?userId=user-a", "GET", undefined, "c")).json()).toEqual({ wordId: "shared", text: null, revision: null });
    expect((await (await request("/shared/personal-note", "GET", undefined, "a")).json()).text).toBe("My own hint");
    expect((await (await request("/shared/personal-note", "GET", undefined, "b")).json()).text).toBe("B private hint");
  });
  it("does not leak notes into shared card, library or dictionary responses", async () => {
    await link(); await save("UNIQUE_PRIVATE_HINT");
    for (const path of ["", "/mine", "/shared"]) expect(JSON.stringify(await (await request(path)).json())).not.toContain("UNIQUE_PRIVATE_HINT");
    expect(fixture.words.get("shared")!.notes).toBe("Shared hint"); expect(fixture.db.word.update).not.toHaveBeenCalled();
  });
  it("retains notes after unlinking and restores access only after re-adding the card", async () => {
    await link(); const note = await (await save()).json(); await request("/shared/dictionary", "DELETE");
    expect((await request("/shared/personal-note")).status).toBe(404); expect(notes.size).toBe(1);
    await link(); expect(await (await request("/shared/personal-note")).json()).toEqual(note);
  });
  it("permits an author to annotate their own pending card", async () => {
    await link("private"); expect((await save("Pending own note", null, "a", "private")).status).toBe(200);
    expect(fixture.words.get("private")!.publicationStatus).toBe("PENDING_REVIEW");
  });
  it("rejects stale saves, stale clears and concurrent creation without overwriting", async () => {
    await link(); const first = await (await save()).json(); const second = await (await save("New note", first.revision)).json();
    for (const text of ["Old tab overwrite", ""]) expect((await save(text, first.revision)).status).toBe(409);
    expect((await save("Duplicate create", null)).status).toBe(409);
    expect(await (await request("/shared/personal-note")).json()).toEqual(second);
  });
  it("clears only the requested user's note and rejects stale revisions after recreation", async () => {
    await link(); await link("shared", "b"); const first = await (await save()).json(); await save("B", null, "b");
    expect(await (await save("   ", first.revision)).json()).toEqual({ wordId: "shared", text: null, revision: null });
    expect(notes.size).toBe(1); expect(await (await save("", null)).json()).toEqual({ wordId: "shared", text: null, revision: null });
    const recreated = await (await save("Recreated", null)).json(); expect(recreated.revision).not.toBe(first.revision); expect((await save("stale", first.revision)).status).toBe(409);
  });
  it("rejects null, missing, oversized and injected fields before any note write", async () => {
    await link();
    for (const body of [{}, { text: "x" }, { text: null, revision: null }, { text: "x".repeat(2001), revision: null }, { text: "x", revision: 4 }, { text: "x", revision: "bad/key" },
      { text: "x", revision: null, userId: userB.id }, { text: "x", revision: null, role: "ADMIN" }]) expect((await request("/shared/personal-note", "PUT", body)).status).toBe(400);
    expect(model.create).not.toHaveBeenCalled();
  });
  it("preserves literal HTML and normalizes only outer space and line endings", async () => {
    await link(); const response = await save("  <b>my hint</b>\r\nSecond line  ");
    expect((await response.json()).text).toBe("<b>my hint</b>\nSecond line");
  });
});
