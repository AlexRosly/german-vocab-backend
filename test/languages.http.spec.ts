import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { makeLanguageUsers } from "./support/language-users";
import { makeModerationDatabase } from "./support/moderation-database";
import { admin, userA, userB } from "./support/words-database";

describe("Language preferences and translations HTTP (mocked persistence)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let fixture: ReturnType<typeof makeModerationDatabase>;
  let store: ReturnType<typeof makeLanguageUsers>;

  beforeEach(async () => {
    fixture = makeModerationDatabase(); store = makeLanguageUsers();
    fixture.seedWord("shared");
    fixture.seedWord("own", { german: "Baum", translation: "дерево", publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id });
    fixture.translations.set("ru-shared", { id: "ru-shared", wordId: "shared", language: "ru", text: "стол из WordTranslation" });
    fixture.translations.set("en-shared", { id: "en-shared", wordId: "shared", language: "en", text: "table" });
    fixture.translations.set("de-shared", { id: "de-shared", wordId: "shared", language: "de", text: "Tisch" });
    fixture.translations.set("ru-own", { id: "ru-own", wordId: "own", language: "ru", text: "дерево" });
    Object.assign(fixture.db, { user: store.model });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const id = token === "a".repeat(43) ? userA.id : token === "b".repeat(43) ? userB.id : token === "c".repeat(43) ? admin.id : null;
        const user = id ? store.users.get(id) : undefined;
        if (!user) throw new UnauthorizedException();
        return { user: { ...user }, sessionId: `session-${user.id}` };
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  afterEach(async () => { await app?.close(); });

  function request(path: string, method = "GET", body?: unknown, actor = "a") {
    return fetch(`${baseUrl}${path}`, { method,
      headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("lists supported languages before authentication", async () => {
    const response = await request("/languages", "GET", undefined, "");
    expect(response.status).toBe(200);
    const catalog = await response.json();
    expect(catalog.interfaceLanguages.map((item: { code: string }) => item.code)).toEqual(["ru", "de", "en", "uk"]);
    expect(catalog.translationLanguages.map((item: { code: string }) => item.code)).toEqual(["ru", "de", "en", "uk", "pl", "tr", "ar", "fr", "es", "it", "pt"]);
    expect(store.model.findUnique).not.toHaveBeenCalled();
  });

  it("protects preferences and translation reads/writes", async () => {
    for (const [path, method] of [["/users/me/preferences", "GET"], ["/users/me/preferences", "PATCH"], ["/words/shared/translations/en", "GET"], ["/words/shared/translations/en", "PUT"]]) {
      expect((await request(path, method, undefined, "")).status).toBe(401);
      expect((await request(path, method, undefined, "z")).status).toBe(401);
    }
    expect(store.model.update).not.toHaveBeenCalled();
    expect(fixture.db.wordTranslation.upsert).not.toHaveBeenCalled();
  });

  it("stores interface and translation languages independently for one user", async () => {
    expect(await (await request("/users/me/preferences", "PATCH", { interfaceLanguage: "DE" })).json()).toEqual({ interfaceLanguage: "de", translationLanguage: "ru", timeZone: "UTC", dailyGoal: 10 });
    expect(await (await request("/users/me/preferences", "PATCH", { translationLanguage: " EN " })).json()).toEqual({ interfaceLanguage: "de", translationLanguage: "en", timeZone: "UTC", dailyGoal: 10 });
    expect(await (await request("/users/me/preferences")).json()).toEqual({ interfaceLanguage: "de", translationLanguage: "en", timeZone: "UTC", dailyGoal: 10 });
    expect(await (await request("/users/me/preferences", "GET", undefined, "b")).json()).toEqual({ interfaceLanguage: "ru", translationLanguage: "ru", timeZone: "UTC", dailyGoal: 10 });
    expect(await (await request("/auth/me")).json()).toMatchObject({ id: userA.id, interfaceLanguage: "de", translationLanguage: "en", role: "USER" });
  });

  it("rejects userId/role injection and invalid or empty preference updates", async () => {
    for (const payload of [undefined, null, {}, { interfaceLanguage: null }, { translationLanguage: null },
      { interfaceLanguage: "fr" }, { translationLanguage: "en-US" }, { translationLanguage: ["en"] },
      { translationLanguage: "en", userId: userB.id }, { translationLanguage: "en", role: "ADMIN" },
      { translationLanguage: "en", email: "other@example.com" }]) {
      expect((await request("/users/me/preferences", "PATCH", payload)).status).toBe(400);
    }
    expect(store.model.update).not.toHaveBeenCalled();
    expect(store.users.get(userA.id)!.role).toBe("USER");
  });

  it("takes the preferences owner from auth rather than query parameters", async () => {
    await request("/users/me/preferences?userId=user-b", "PATCH", { translationLanguage: "en" });
    expect(store.users.get(userA.id)!.translationLanguage).toBe("en");
    expect(store.users.get(userB.id)!.translationLanguage).toBe("ru");
    expect(await (await request("/users/me/preferences?userId=user-b")).json()).toEqual({ interfaceLanguage: "ru", translationLanguage: "en", timeZone: "UTC", dailyGoal: 10 });
  });

  it("reads the chosen translation from WordTranslation while preserving the legacy field", async () => {
    const russian = await (await request("/words/shared")).json();
    expect(russian).toMatchObject({ translation: "стол", selectedTranslation: { language: "ru", text: "стол из WordTranslation" } });
    await request("/users/me/preferences", "PATCH", { interfaceLanguage: "uk", translationLanguage: "en" });
    const english = await (await request("/words/shared")).json();
    expect(english).toMatchObject({ translation: "стол", selectedTranslation: { language: "en", text: "table" } });
    expect(fixture.words.get("shared")!.translation).toBe("стол");
  });

  it("uses the selected language on library, dictionary and dictionary-add responses", async () => {
    await request("/users/me/preferences", "PATCH", { translationLanguage: "en" });
    expect((await (await request("/words")).json())[0].selectedTranslation).toEqual({ language: "en", text: "table" });
    const added = await (await request("/words/shared/dictionary", "POST")).json();
    expect(added.selectedTranslation).toEqual({ language: "en", text: "table" });
    expect((await (await request("/words/mine")).json())[0].selectedTranslation).toEqual({ language: "en", text: "table" });
    const other = await (await request("/words/shared", "GET", undefined, "b")).json();
    expect(other.selectedTranslation.language).toBe("ru");
  });

  it("marks missing translations with null rather than substituting Russian", async () => {
    await request("/users/me/preferences", "PATCH", { translationLanguage: "uk" });
    expect((await (await request("/words/shared")).json()).selectedTranslation).toEqual({ language: "uk", text: null });
    expect(await (await request("/words/shared/translations/uk")).json()).toEqual({ wordId: "shared", language: "uk", text: null });
    expect(await (await request("/words/shared/translations/EN")).json()).toEqual({ wordId: "shared", language: "en", text: "table" });
  });

  it("lets an author upsert a language without changing Russian or another translation", async () => {
    expect((await request("/words/own/translations/EN", "PUT", { text: " tree " })).status).toBe(200);
    expect((await request("/words/own/translations/en", "PUT", { text: "a tree" })).status).toBe(200);
    expect((await request("/words/own/translations/uk", "PUT", { text: "дерево" })).status).toBe(200);
    expect(await (await request("/words/own/translations/en")).json()).toEqual({ wordId: "own", language: "en", text: "a tree" });
    expect(fixture.words.get("own")!.translation).toBe("дерево");
    expect(fixture.translations.get("ru-own")!.text).toBe("дерево");
    expect([...fixture.translations.values()].filter((row) => row.wordId === "own" && row.language === "en")).toHaveLength(1);
  });

  it("updates Russian in both models without altering English", async () => {
    await request("/words/own/translations/en", "PUT", { text: "tree" });
    const response = await request("/words/own/translations/ru", "PUT", { text: "дерево, растение" });
    expect(response.status).toBe(200);
    expect(fixture.words.get("own")!.translation).toBe("дерево, растение");
    expect(fixture.translations.get("ru-own")!.text).toBe("дерево, растение");
    expect((await (await request("/words/own/translations/en")).json()).text).toBe("tree");
  });

  it("applies the existing privacy and published-word edit permissions", async () => {
    expect((await request("/words/own/translations/ru", "GET", undefined, "b")).status).toBe(404);
    expect((await request("/words/own/translations/en", "PUT", { text: "attack" }, "b")).status).toBe(404);
    expect((await request("/words/shared/translations/en", "PUT", { text: "attack" })).status).toBe(403);
    expect((await request("/words/shared/translations/en", "PUT", { text: "a table" }, "c")).status).toBe(200);
    expect((await request("/words/missing/translations/en")).status).toBe(404);
  });

  it("resubmits an author's rejected card and invalidates an older moderation review", async () => {
    fixture.words.get("own")!.publicationStatus = "REJECTED";
    await request("/words/own/translations/en", "PUT", { text: "tree" });
    expect(fixture.words.get("own")!.publicationStatus).toBe("PENDING_REVIEW");
    const reviewed = await (await request("/moderation/words/own", "GET", undefined, "c")).json();
    await request("/words/own/translations/en", "PUT", { text: "a tree" });
    expect((await request("/moderation/words/own/status", "PATCH", { publicationStatus: "PUBLISHED", expectedRevision: reviewed.revision }, "c")).status).toBe(409);
  });

  it("validates the language, text and extra fields before saving", async () => {
    expect((await request("/words/own/translations/xx", "PUT", { text: "arbre" })).status).toBe(400);
    for (const payload of [undefined, null, {}, { text: null }, { text: "   " }, { text: 123 }, { text: "a".repeat(1001) },
      { text: "tree", userId: userB.id }, { text: "tree", role: "ADMIN" }, { text: "tree", publicationStatus: "PUBLISHED" }, { text: "tree", language: "ru" }]) {
      expect((await request("/words/own/translations/en", "PUT", payload)).status).toBe(400);
    }
    expect(fixture.db.wordTranslation.upsert).not.toHaveBeenCalled();
  });

  it("preserves the Russian creation contract when another translation language is selected", async () => {
    await request("/users/me/preferences", "PATCH", { translationLanguage: "en" });
    const response = await request("/words", "POST", { german: "Arbeit", article: "die", grammaticalNumber: "singular", translation: "работа" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ translation: "работа", selectedTranslation: { language: "en", text: null } });
  });

  it("does not cache preference or personalized word reads", async () => {
    for (const path of ["/users/me/preferences", "/words", "/words/mine", "/words/shared", "/words/shared/translations/en"]) {
      expect((await request(path)).headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("persists study settings independently and isolates USER and ADMIN preferences", async () => {
    const response = await request("/users/me/preferences", "PATCH", { timeZone: "Europe/Berlin", dailyGoal: 25 });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ interfaceLanguage: "ru", translationLanguage: "ru", timeZone: "Europe/Berlin", dailyGoal: 25 });
    await request("/users/me/preferences", "PATCH", { translationLanguage: "en" });
    expect(await (await request("/users/me/preferences")).json()).toMatchObject({ timeZone: "Europe/Berlin", dailyGoal: 25, translationLanguage: "en" });
    for (const actor of ["b", "c"]) expect(await (await request("/users/me/preferences", "GET", undefined, actor)).json()).toMatchObject({ timeZone: "UTC", dailyGoal: 10 });
    expect(fixture.db.word.update).not.toHaveBeenCalled();
  });
  it("rejects invalid goals, zones and injected identity without a partial save", async () => {
    for (const payload of [{ dailyGoal: 0 }, { dailyGoal: 501 }, { dailyGoal: 1.5 }, { dailyGoal: "20" }, { dailyGoal: null },
      { timeZone: null }, { timeZone: "" }, { timeZone: "+02:00" }, { timeZone: "Mars/Test", dailyGoal: 20 },
      { timeZone: "Europe/Berlin", userId: userB.id }, { dailyGoal: 20, role: "ADMIN" }]) {
      expect((await request("/users/me/preferences", "PATCH", payload)).status).toBe(400);
    }
    expect(store.model.update).not.toHaveBeenCalled();
    expect(await (await request("/users/me/preferences")).json()).toMatchObject({ timeZone: "UTC", dailyGoal: 10 });
  });
  it("accepts boundary goals and timezone aliases without changing languages", async () => {
    for (const dailyGoal of [1, 500]) {
      expect(await (await request("/users/me/preferences", "PATCH", { timeZone: "europe/berlin", dailyGoal })).json()).toMatchObject({ timeZone: "Europe/Berlin", dailyGoal, interfaceLanguage: "ru", translationLanguage: "ru" });
    }
  });
  it("accepts expanded content languages without adding interface locales", async () => {
    for (const language of ["pl", "tr", "ar", "fr", "es", "it", "pt"]) {
      expect((await request("/users/me/preferences", "PATCH", { translationLanguage: language })).status).toBe(200);
      expect((await request("/users/me/preferences", "PATCH", { interfaceLanguage: language })).status).toBe(400);
    }
    expect((await (await request("/users/me/preferences")).json()).interfaceLanguage).toBe("ru");
  });

});
