import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { makeWordsDatabase, userA, userB, admin } from "./support/words-database";

describe("Personal translations HTTP: privacy, locale and optimistic concurrency", () => {
  let app: INestApplication, url: string, fixture: ReturnType<typeof makeWordsDatabase>;
  beforeEach(async () => {
    fixture = makeWordsDatabase(); fixture.seedWord("shared");
    fixture.seedWord("private", { publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id });
    fixture.translations.set("shared-ru", { id: "shared-ru", wordId: "shared", language: "ru", text: "общий стол" });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!user) throw new UnauthorizedException(); return { user, sessionId: `session-${user.id}` };
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1"); url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/words`;
  });
  afterEach(async () => { await app?.close(); });
  const request = (path: string, method = "GET", body?: unknown, actor = "a") => fetch(url + path, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const path = (language = "ru", id = "shared") => `/${id}/personal-translations/${language}`;
  const save = (text = "мой стол", revision: string | null = null, actor = "a", language = "ru", id = "shared") => request(path(language, id), "PUT", { text, revision }, actor);
  const link = async (actor = "a", id = "shared") => expect((await request(`/${id}/dictionary`, "POST", undefined, actor)).status).toBe(200);

  it("requires authentication, membership and current readability even for ADMIN", async () => {
    for (const method of ["GET", "PUT"]) expect((await request(path(), method, method === "PUT" ? { text: "x", revision: null } : undefined, "")).status).toBe(401);
    for (const actor of ["a", "b", "c"]) expect((await request(path(), "GET", undefined, actor)).status).toBe(404);
    fixture.links.set("bad-link", { userId: admin.id, wordId: "private" });
    expect((await request(path("ru", "private"), "GET", undefined, "c")).status).toBe(404);
  });
  it("isolates users and languages, keeps shared/legacy translations and publication intact", async () => {
    for (const actor of ["a", "b", "c"]) await link(actor);
    const original = structuredClone(fixture.words.get("shared"));
    const response = await save("A_ONLY"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ wordId: "shared", language: "ru", text: "A_ONLY", revision: expect.any(String) });
    await save("B_ONLY", null, "b"); await save("PRIVATE_POLSKI", null, "a", "pl");
    expect((await (await request(path(), "GET", undefined, "b")).json()).text).toBe("B_ONLY");
    expect(await (await request(path()+"?userId=user-a", "GET", undefined, "c")).json()).toEqual({ wordId: "shared", language: "ru", text: null, revision: null });
    const mine = await (await request("/mine")).json();
    expect(mine[0].selectedTranslation).toEqual({ language: "ru", text: "A_ONLY", source: "personal" });
    expect(mine[0].translations[0].text).toBe("общий стол"); expect(mine[0]).not.toHaveProperty("personalTranslations");
    expect(JSON.stringify(mine)).not.toContain("B_ONLY"); expect(JSON.stringify(mine)).not.toContain("PRIVATE_POLSKI");
    for (const endpoint of ["", "/shared"]) expect(JSON.stringify(await (await request(endpoint)).json())).not.toContain("A_ONLY");
    expect(fixture.words.get("shared")).toEqual(original);
  });
  it("clears only one locale and restores its shared translation, retaining other locales/users", async () => {
    await link(); await link("b"); const first = await (await save()).json();
    await save("Inny język", null, "a", "pl"); await save("Other user", null, "b");
    expect(await (await save("   ", first.revision)).json()).toEqual({ wordId: "shared", language: "ru", text: null, revision: null });
    expect((await (await request("/mine")).json())[0].selectedTranslation).toEqual({ language: "ru", text: "общий стол" });
    expect(fixture.privateTranslations.size).toBe(2);
    expect((await (await request(path("pl"))).json()).text).toBe("Inny język");
  });
  it("retains private data after unlink and denies reads/writes until readable membership is restored", async () => {
    await link(); const first = await (await save()).json(); await request("/shared/dictionary", "DELETE");
    expect((await request(path())).status).toBe(404); expect((await save("overwrite", first.revision)).status).toBe(404);
    expect(fixture.privateTranslations.size).toBe(1); await link(); expect(await (await request(path())).json()).toEqual(first);
    fixture.words.get("shared")!.publicationStatus = "REJECTED";
    expect((await request(path())).status).toBe(404); expect(await (await request("/mine")).json()).toEqual([]);
  });
  it("allows authors' own pending cards without publishing them", async () => {
    await link("a", "private"); expect((await save("私の訳", null, "a", "en", "private")).status).toBe(200);
    expect(fixture.words.get("private")!.publicationStatus).toBe("PENDING_REVIEW");
  });
  it("rejects stale updates, clears and stale recreation, including conditional-write races", async () => {
    await link(); const first = await (await save()).json(); const second = await (await save("changed", first.revision)).json();
    for (const text of ["stale", ""]) expect((await save(text, first.revision)).status).toBe(409);
    expect((await save("create again", null)).status).toBe(409);
    fixture.db.personalWordTranslation.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await save("raced", second.revision)).status).toBe(409);
    expect(await (await request(path())).json()).toEqual(second);
    await save("", second.revision); const recreated = await (await save("recreated")).json();
    expect(recreated.revision).not.toBe(second.revision); expect((await save("stale", second.revision)).status).toBe(409);
  });
  it("validates locale, missing revision, Unicode length and owner injection before writing", async () => {
    await link();
    for (const body of [{}, { text: "x" }, { text: null, revision: null }, { text: "x".repeat(1001), revision: null }, { text: "x", revision: "../bad" }, { text: "x", revision: null, userId: userB.id }, { text: "x", revision: null, role: "ADMIN" }]) expect((await request(path(), "PUT", body)).status).toBe(400);
    for (const language of ["xx", "en-US"]) expect((await save("x", null, "a", language)).status).toBe(400);
    expect(fixture.db.personalWordTranslation.create).not.toHaveBeenCalled();
    expect((await save("🌳".repeat(1000))).status).toBe(200);
  });
  it("normalizes NFC and line endings, preserving text as literal data", async () => {
    await link(); expect((await (await save("  <b>cafe\u0301</b>\r\nNext  ", null, "a", " FR ")).json()).text).toBe("<b>café</b>\nNext");
  });
});
