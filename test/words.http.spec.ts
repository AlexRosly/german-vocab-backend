import { TRANSLATION_LANGUAGE_CODES } from "../src/languages/language-options";
import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { PersonalTranslationsService } from "../src/words/personal-translations.service";
import { WordsController } from "../src/words/words.controller";
import { WordsService } from "../src/words/words.service";
import { WordAccessService } from "../src/words/word-access.service";
import { WordExamplesController } from "../src/words/word-examples.controller";
import { WordExamplesService } from "../src/words/word-examples.service";
import { admin, makeWordsDatabase, userA, userB } from "./support/words-database";

const card = { german: "Baum", article: "der", grammaticalNumber: "singular", translation: "дерево" };

describe("Dictionary HTTP boundary (real services, mocked persistence)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let fixture: ReturnType<typeof makeWordsDatabase>;

  beforeEach(async () => {
    fixture = makeWordsDatabase();
    fixture.seedWord("published");
    fixture.seedWord("private", { publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id });
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [WordsController, WordExamplesController],
      providers: [PersonalTranslationsService, PrismaService, WordsService, WordAccessService, WordExamplesService],
    })
      .overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!user) throw new UnauthorizedException();
        return { user, sessionId: `session-${user.id}` };
      } })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/words`;
  });

  afterEach(async () => { await app?.close(); });

  function request(path = "", method = "GET", body?: unknown, actor = "a") {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("requires authorization for every words/examples route", async () => {
    for (const [path, method] of [
      ["", "GET"], ["/mine", "GET"], ["/published", "GET"], ["", "POST"],
      ["/published", "PATCH"], ["/published", "DELETE"],
      ["/published/dictionary", "POST"], ["/published/dictionary", "DELETE"],
      ["/published/examples", "GET"], ["/published/examples", "POST"],
      ["/published/examples/example", "PATCH"], ["/published/examples/example", "DELETE"],
    ]) {
      expect((await request(path, method, undefined, "")).status).toBe(401);
    }
    expect((await request("", "GET", undefined, "z")).status).toBe(401);
    expect(fixture.db.word.findMany).not.toHaveBeenCalled();
  });

  it("separates the library and the static /mine route for two authenticated users", async () => {
    expect((await (await request()).json()).map((word: { id: string }) => word.id)).toEqual(["published"]);
    expect(await (await request("/mine")).json()).toEqual([]);
    expect((await request("/published/dictionary", "POST")).status).toBe(200);
    expect((await request("/published/dictionary", "POST")).status).toBe(200);
    expect((await (await request("/mine")).json()).map((word: { id: string }) => word.id)).toEqual(["published"]);
    expect(await (await request("/mine", "GET", undefined, "b")).json()).toEqual([]);
    expect(fixture.words.size).toBe(2);
    expect(fixture.links.size).toBe(1);
  });

  it("creates a pending card visible only to its author before moderation", async () => {
    const response = await request("", "POST", card);
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({ publicationStatus: "PENDING_REVIEW", createdByUserId: "user-a" });
    expect(created.translations).toEqual([expect.objectContaining({ language: "ru", text: "дерево" })]);
    expect((await request(`/${created.id}`)).status).toBe(200);
    expect((await request(`/${created.id}`, "GET", undefined, "b")).status).toBe(404);
    expect((await request(`/${created.id}/dictionary`, "POST", undefined, "b")).status).toBe(404);
    expect((await request(`/${created.id}/examples`, "GET", undefined, "b")).status).toBe(404);
    expect((await request(`/${created.id}/examples`, "POST", { german: "x", translation: "y" }, "b")).status).toBe(404);
  });

  it("rejects publication, ownership and role injection and invalid required fields", async () => {
    for (const body of [
      { ...card, publicationStatus: "PUBLISHED" }, { ...card, userId: "user-b" },
      { ...card, createdByUserId: "user-b" }, { ...card, role: "ADMIN" },
      { ...card, german: "   " }, { ...card, translation: "   " },
      { ...card, german: null }, { ...card, article: null },
    ]) expect((await request("", "POST", body)).status).toBe(400);
    expect(fixture.db.word.create).not.toHaveBeenCalled();
    expect((await request("/private", "PATCH", { publicationStatus: "PUBLISHED" })).status).toBe(400);
    for (const key of ["german", "translation", "article", "grammaticalNumber"]) {
      expect((await request("/private", "PATCH", { [key]: null })).status).toBe(400);
    }
  });

  it("checks edit permissions for authors, other users and administrators", async () => {
    expect((await request("/published", "PATCH", { notes: "unauthorized" })).status).toBe(403);
    expect((await request("/private", "PATCH", { notes: "unauthorized" }, "b")).status).toBe(404);
    expect((await request("/private", "PATCH", { notes: "own change", pluralForm: null })).status).toBe(200);
    expect((await request("/published", "PATCH", { notes: "admin change" }, "c")).status).toBe(200);
    expect(fixture.words.get("private")!.publicationStatus).toBe("PENDING_REVIEW");
    expect(fixture.words.get("published")!.notes).toBe("admin change");
  });

  it("turns both dictionary deletion routes into idempotent personal unlinking", async () => {
    await request("/published/dictionary", "POST");
    await request("/published/dictionary", "POST", undefined, "b");
    expect((await request("/published", "DELETE", { userId: "user-b" })).status).toBe(200);
    expect((await request("/published/dictionary", "DELETE")).status).toBe(200);
    expect(await (await request("/mine")).json()).toEqual([]);
    expect((await (await request("/mine", "GET", undefined, "b")).json()).map((word: { id: string }) => word.id)).toEqual(["published"]);
    expect(fixture.words.has("published")).toBe(true);
    expect(fixture.db.word.delete).not.toHaveBeenCalled();
  });

  it("validates search and prevents selecting another user's dictionary through query parameters", async () => {
    expect((await (await request("?q=TISCH")).json()).map((word: { id: string }) => word.id)).toEqual(["published"]);
    expect(await (await request("?q=absent")).json()).toEqual([]);
    expect((await request("/mine?userId=user-b")).status).toBe(400);
    expect((await request("?publicationStatus=PENDING_REVIEW")).status).toBe(400);
    expect((await request("?q=first&q=second")).status).toBe(400);
    expect((await request(`?q=${"a".repeat(101)}`)).status).toBe(400);
  });

  it("protects example writes and rejects a foreign example ID under an owned word", async () => {
    expect((await request("/published/examples", "POST", { german: "Beispiel", translation: "пример" })).status).toBe(403);
    expect((await request("/private/examples", "POST", { german: "  ", translation: "пример" })).status).toBe(400);
    const created = await (await request("/private/examples", "POST", { german: "Beispiel", translation: "пример" })).json();
    expect((await request(`/private/examples/${created.id}`, "PATCH", { german: null })).status).toBe(400);
    expect((await request(`/private/examples/${created.id}`, "PATCH", { german: "Changed" })).status).toBe(200);
    fixture.examples.set("foreign", { id: "foreign", wordId: "published", german: "Protected", translation: "пример" });
    expect((await request("/private/examples/foreign", "PATCH", { german: "Attack" })).status).toBe(404);
    expect((await request("/private/examples/foreign", "DELETE")).status).toBe(404);
    expect(fixture.examples.get("foreign")!.german).toBe("Protected");
    expect((await request(`/private/examples/${created.id}`, "DELETE")).status).toBe(200);
  });

  it("returns a safe conflict on a repeated create without creating another copy", async () => {
    const first = await (await request("", "POST", card)).json();
    const repeated = await request("", "POST", card);
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toMatchObject({ wordId: first.id });
    expect(fixture.words.size).toBe(3);
    expect(fixture.links.size).toBe(1);
  });
  it("creates German-only words and examples, and selects translations without Russian fallback", async () => {
    const response = await request("", "POST", { german: "Kran", article: "der", grammaticalNumber: "singular", examples: [
      { german: "Der Kran ist hoch." },
      { german: "Ich sehe den Kran.", translations: [{ language: "en", text: "I see the crane." }] },
    ] });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.translation).toBe("");
    expect(created.translations).toEqual([]);
    const examples = await (await request(`/${created.id}/examples`)).json();
    expect(examples).toHaveLength(2);
    expect(examples[0]).toMatchObject({ german: "Der Kran ist hoch.", translation: "", selectedTranslation: { language: "ru", text: null } });
    expect(examples[1].selectedTranslation.text).toBeNull();
    expect(examples[1].translations).toEqual([expect.objectContaining({ language: "en", text: "I see the crane." })]);
  });

  it("rejects malformed nested examples and language patches before any word is written", async () => {
    for (const extra of [
      { examples: [{ german: " " }] }, { examples: [{ german: "Ja", translations: [{ language: "xx", text: "Oui" }] }] },
      { examples: [{ german: "Ja", translations: [{ language: "en", text: " " }] }] },
      { examples: Array.from({ length: 21 }, () => ({ german: "Ja" })) },
      { examples: [{ german: "Ja", wordId: "private" }] },
      { translations: [{ language: "en", text: "tree" }, { language: " EN ", text: "tree" }] },
      { examples: null }, { translations: null },
      { examples: [null] }, { translations: [null] },
      { examples: [{ german: "Ja", translations: [null] }] },
    ]) expect((await request("", "POST", { ...card, ...extra })).status).toBe(400);
    expect(fixture.db.word.create).not.toHaveBeenCalled();
    expect((await request("/private", "PATCH", { examples: [] })).status).toBe(400);
  });

  it("adds and removes one example language without erasing others or permitting foreign writes", async () => {
    const created = await (await request("/private/examples", "POST", { german: "Ja.", translations: [
      { language: "ru", text: "Да." }, { language: "en", text: "Yes." },
    ] })).json();
    const path = `/private/examples/${created.id}`;
    expect((await request(path, "PATCH", { translations: [{ language: "uk", text: "Так." }] }, "b")).status).toBe(404);
    const updated = await (await request(path, "PATCH", { translations: [{ language: "ru", text: null }, { language: "uk", text: "Так." }] })).json();
    expect(updated.translation).toBe("");
    expect(updated.selectedTranslation.text).toBeNull();
    expect(updated.translations.map((entry: { language: string }) => entry.language).sort()).toEqual(["en", "uk"]);
    expect((await request(path, "PATCH", { translations: [{ language: "en" }] })).status).toBe(400);
  });

  it("creates a word and nested example with every supported language in one request", async () => {
    const translations = TRANSLATION_LANGUAGE_CODES.map(language => ({ language, text: `meaning-${language}` }));
    expect(translations.length).toBeGreaterThan(4);
    const response = await request("", "POST", { german: "Mehrsprachigkeit", article: "none", grammaticalNumber: "not_applicable", translations,
      examples: [{ german: "Wir lernen gemeinsam.", translations }] });
    expect(response.status).toBe(201); const word = await response.json();
    expect(word.translations.map((row: any) => row.language).sort()).toEqual([...TRANSLATION_LANGUAGE_CODES].sort());
    const examples = await (await request(`/${word.id}/examples`)).json();
    expect(examples[0].translations).toHaveLength(TRANSLATION_LANGUAGE_CODES.length);
    expect(word.publicationStatus).toBe("PENDING_REVIEW");
  });
  it("updates word translations and creates/updates standalone examples with the full catalog", async () => {
    const translations = TRANSLATION_LANGUAGE_CODES.map(language => ({ language, text: `meaning-${language}` }));
    const updated = await request("/private", "PATCH", { translations }); expect(updated.status).toBe(200);
    expect((await updated.json()).translations).toHaveLength(TRANSLATION_LANGUAGE_CODES.length);
    const created = await request("/private/examples", "POST", { german: "Das ist ein Beispiel.", translations }); expect(created.status).toBe(201);
    const example = await created.json(); expect(example.translations).toHaveLength(TRANSLATION_LANGUAGE_CODES.length);
    const changed = await request(`/private/examples/${example.id}`, "PATCH", { translations: translations.map(row => ({ ...row, text: `updated-${row.language}` })) });
    expect(changed.status).toBe(200); expect((await changed.json()).translations.every((row: any) => row.text === `updated-${row.language}`)).toBe(true);
  });
  it("still rejects oversized, unsupported and duplicate-language translation arrays", async () => {
    const valid = TRANSLATION_LANGUAGE_CODES.map(language => ({ language, text: "meaning" }));
    for (const translations of [[...valid, valid[0]], [{ language: "xx", text: "unknown" }], [{ language: "en", text: "one" }, { language: " EN ", text: "two" }]]) {
      expect((await request("", "POST", { german: "validieren", article: "none", grammaticalNumber: "not_applicable", translations })).status).toBe(400);
      expect((await request("/private/examples", "POST", { german: "Wir prüfen.", translations })).status).toBe(400);
    }
    expect(fixture.db.word.create).not.toHaveBeenCalled(); expect(fixture.db.wordExample.create).not.toHaveBeenCalled();
  });

});
