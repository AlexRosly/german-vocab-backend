import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { PersonalBooksController } from "../src/words/personal-books.controller";
import { PersonalBooksService } from "../src/words/personal-books.service";
import { PersonalTranslationsService } from "../src/words/personal-translations.service";
import { WordsController } from "../src/words/words.controller";
import { WordsService } from "../src/words/words.service";
import { WordAccessService } from "../src/words/word-access.service";
import { admin, makeWordsDatabase, userA, userB } from "./support/words-database";

describe("Source books and private books (real HTTP/services, mocked Prisma)", () => {
  let app: INestApplication, base: string;
  let fixture: ReturnType<typeof makeWordsDatabase>;
  beforeEach(async () => {
    fixture = makeWordsDatabase(); fixture.seedWord("published", { sourceBook: "B1+ Brückenkurs" });
    const module = await Test.createTestingModule({
      imports: [AuthModule], controllers: [WordsController, PersonalBooksController],
      providers: [WordsService, WordAccessService, PersonalTranslationsService, PersonalBooksService, PrismaService],
    }).overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!user) throw new UnauthorizedException(); return { user, sessionId: "test" };
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/words`;
  });
  afterEach(async () => { await app?.close(); });
  const card = { german: "Baum", article: "der", grammaticalNumber: "singular", translation: "дерево" };
  function request(path = "", method = "GET", body?: unknown, actor = "a") {
    return fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function link(actor = "a") { expect((await request("/published/dictionary", "POST", undefined, actor)).status).toBe(200); }
  const save = (titles: unknown, revision: unknown = null, actor = "a") => request("/published/personal-books", "PUT", { titles, revision }, actor);

  it("requires authentication, dictionary membership and readable cards even for ADMIN", async () => {
    expect((await request("/published/personal-books", "GET", undefined, "")).status).toBe(401);
    expect((await request("/published/personal-books")).status).toBe(404);
    expect((await save(["A1 Treffpunkt"], null, "c")).status).toBe(404);
    await link(); expect((await request("/published/personal-books")).status).toBe(200);
    fixture.words.get("published")!.publicationStatus = "REJECTED";
    expect((await request("/published/personal-books")).status).toBe(404);
    expect((await save(["A1 Treffpunkt"])).status).toBe(404);
  });
  it("stores source book on a pending word, normalizes it and preserves it on unrelated edits", async () => {
    const created = await request("", "POST", { ...card, sourceBook: "  A1.1   Schritte plus  " });
    expect(created.status).toBe(201); const word = await created.json();
    expect(word).toMatchObject({ sourceBook: "A1.1 Schritte plus", publicationStatus: "PENDING_REVIEW" });
    const edited = await (await request(`/${word.id}`, "PATCH", { level: "A2" })).json();
    expect(edited.sourceBook).toBe("A1.1 Schritte plus");
    const cleared = await (await request(`/${word.id}`, "PATCH", { sourceBook: null })).json();
    expect(cleared.sourceBook).toBeNull(); expect(cleared.level).toBe("A2");
  });
  it("a different book cannot bypass word duplicate detection", async () => {
    expect((await request("", "POST", { ...card, sourceBook: "A1 Treffpunkt" })).status).toBe(201);
    expect((await request("", "POST", { ...card, sourceBook: "B1+ Brückenkurs" })).status).toBe(409);
    expect(fixture.words.size).toBe(2);
  });
  it("only ADMIN edits a published source; private associations cannot change shared content", async () => {
    await link(); const before = structuredClone(fixture.words.get("published"));
    expect((await request("/published", "PATCH", { sourceBook: "My course" })).status).toBe(403);
    expect((await save(["My course"])).status).toBe(200);
    expect(fixture.words.get("published")).toEqual(before);
    expect((await request("/published", "PATCH", { sourceBook: "Corrected source" }, "c")).status).toBe(200);
    expect((await (await request()).json())[0].sourceBook).toBe("Corrected source");
  });
  it("keeps titles private in mine and never exposes them in library or another dictionary", async () => {
    await link(); await link("b"); expect((await save(["Private school"])).status).toBe(200);
    const mine = await (await request("/mine")).json(); expect(mine[0].personalBooks).toEqual(["Private school"]);
    const other = await (await request("/mine", "GET", undefined, "b")).json(); expect(other[0].personalBooks).toEqual([]);
    const library = await (await request()).json(); expect(library[0].personalBooks).toBeUndefined();
    expect(JSON.stringify(library)).not.toContain("Private school");
    expect(await (await request("/published/personal-books", "GET", undefined, "b")).json()).toMatchObject({ titles: [], revision: null });
  });
  it("rejects stale writes and stale clears, then permits clearing with the current revision", async () => {
    await link(); const first = await (await save(["One"])).json(); expect(first.revision).toEqual(expect.any(String));
    const next = await (await save(["Two"], first.revision)).json();
    expect((await save(["Stale"], first.revision)).status).toBe(409);
    expect((await save([], first.revision)).status).toBe(409);
    expect(await (await request("/published/personal-books")).json()).toEqual(next);
    expect(await (await save([], next.revision)).json()).toEqual({ wordId: "published", titles: [], revision: null });
  });
  it("retains private books across a dictionary unlink without making them readable while unlinked", async () => {
    await link(); const first = await (await save(["Private course"])).json();
    await request("/published/dictionary", "DELETE");
    expect((await request("/published/personal-books")).status).toBe(404);
    await link(); expect(await (await request("/published/personal-books")).json()).toEqual(first);
  });
  it("validates title count, normalized duplicates, lengths, control characters, revision and payload ownership", async () => {
    await link();
    for (const titles of [[...Array(21)].map((_, i) => "Book " + i), ["A1 Book", " a1  book "], [" "], ["x".repeat(121)], ["Book\u0000"], [null], null]) expect((await save(titles)).status).toBe(400);
    expect((await request("/published/personal-books", "PUT", { titles: ["Book"] })).status).toBe(400);
    expect((await request("/published/personal-books", "PUT", { titles: ["Book"], revision: null, userId: userB.id })).status).toBe(400);
    expect((await request("", "POST", { ...card, sourceBook: "x".repeat(121) })).status).toBe(400);
    const normalized = await (await save([" A1   Treffpunkt ", " B1+ Brückenkurs "])).json();
    expect(normalized.titles).toEqual(["A1 Treffpunkt", "B1+ Brückenkurs"]);
  });
});
