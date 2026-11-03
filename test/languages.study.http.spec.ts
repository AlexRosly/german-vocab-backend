import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { makeLanguageStudyDatabase } from "./support/language-study-database";
import { makeLanguageUsers } from "./support/language-users";
import { userA, userB } from "./support/words-database";

describe("Selected translations in personal study HTTP", () => {
  let app: INestApplication;
  let baseUrl: string;
  let fixture: ReturnType<typeof makeLanguageStudyDatabase>;
  let store: ReturnType<typeof makeLanguageUsers>;

  beforeEach(async () => {
    fixture = makeLanguageStudyDatabase(); store = makeLanguageUsers();
    store.users.get(userA.id)!.translationLanguage = "en";
    store.users.get(userB.id)!.translationLanguage = "de";
    fixture.seedWord("shared", { german: "Baum", translation: "дерево" });
    fixture.link(userA.id, "shared"); fixture.link(userB.id, "shared");
    Object.assign(fixture.db, { user: store.model });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const id = token === "a".repeat(43) ? userA.id : token === "b".repeat(43) ? userB.id : null;
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

  function request(path: string, method = "GET", payload?: unknown, actor = "a", key?: string) {
    return fetch(`${baseUrl}${path}`, { method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.repeat(43)}`, ...(key ? { "Idempotency-Key": key } : {}) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }
  const session = { totalWords: 1, words: [{ wordId: "shared", answer: "KNOWN" }] };

  it("selects the user's language on new words, saved sessions, history, progress and due words", async () => {
    const fresh = await (await request("/study/new")).json();
    expect(fresh.words[0]).toMatchObject({ translation: "дерево", selectedTranslation: { language: "en", text: "tree" } });
    const saved = await (await request("/study/sessions", "POST", session, "a", "request-0001")).json();
    expect(saved.words[0].word.selectedTranslation).toEqual({ language: "en", text: "tree" });
    expect((await (await request("/study/sessions")).json())[0].words[0].word.selectedTranslation).toEqual({ language: "en", text: "tree" });
    expect((await (await request("/study/progress")).json()).words[0].word.selectedTranslation).toEqual({ language: "en", text: "tree" });
    fixture.progressFor(userA.id, "shared")!.nextReviewAt = new Date(0);
    const due = await (await request("/study/due")).json();
    expect(due.words[0].selectedTranslation).toEqual({ language: "en", text: "tree" });
    expect(due.words[0].progress.knownCount).toBe(1);
  });

  it("shows different translations to two users without sharing their progress", async () => {
    await request("/study/sessions", "POST", session);
    const freshB = await (await request("/study/new", "GET", undefined, "b")).json();
    expect(freshB.words[0].selectedTranslation).toEqual({ language: "de", text: "Baum" });
    const savedB = await (await request("/study/sessions", "POST", session, "b")).json();
    expect(savedB.words[0].word.selectedTranslation).toEqual({ language: "de", text: "Baum" });
    expect(fixture.progressFor(userA.id, "shared")!.knownCount).toBe(1);
    expect(fixture.progressFor(userB.id, "shared")!.knownCount).toBe(1);
  });

  it("changes presentation after a preference update without changing progress or idempotent session data", async () => {
    const saved = await (await request("/study/sessions", "POST", session, "a", "request-0001")).json();
    const before = structuredClone(fixture.progressFor(userA.id, "shared"));
    expect((await request("/users/me/preferences", "PATCH", { interfaceLanguage: "de", translationLanguage: "uk" })).status).toBe(200);
    const history = await (await request("/study/sessions")).json();
    expect(history[0].words[0].word.selectedTranslation).toEqual({ language: "uk", text: null });
    const replay = await (await request("/study/sessions", "POST", session, "a", "request-0001")).json();
    expect(replay.id).toBe(saved.id);
    expect(replay.words[0].word.selectedTranslation).toEqual({ language: "uk", text: null });
    expect(fixture.progressFor(userA.id, "shared")).toEqual(before);
    expect(fixture.sessions.size).toBe(1);
  });
  it("uses only the caller's selected personal translation in training/history without changing progress or stored answers", async () => {
    fixture.privateTranslations.set("a-en", { userId: userA.id, wordId: "shared", language: "en", text: "MY_PRIVATE_TREE", revision: "r" });
    fixture.privateTranslations.set("b-en", { userId: userB.id, wordId: "shared", language: "en", text: "B_PRIVATE_TREE", revision: "r" });
    expect((await (await request("/study/new")).json()).words[0].selectedTranslation).toEqual({ language: "en", text: "MY_PRIVATE_TREE", source: "personal" });
    const saved = await (await request("/study/sessions", "POST", session, "a", "personal-0001")).json();
    expect(saved.words[0].word.selectedTranslation.text).toBe("MY_PRIVATE_TREE");
    const before = structuredClone(fixture.progressFor(userA.id, "shared"));
    expect((await (await request(`/study/history/${saved.id}`)).json()).words[0].word.selectedTranslation.text).toBe("MY_PRIVATE_TREE");
    expect((await (await request("/study/progress")).json()).words[0].word.selectedTranslation.text).toBe("MY_PRIVATE_TREE");
    fixture.progressFor(userA.id, "shared")!.nextReviewAt = new Date(0);
    expect((await (await request("/study/due")).json()).words[0].selectedTranslation.text).toBe("MY_PRIVATE_TREE");
    expect(JSON.stringify(await (await request("/study/new", "GET", undefined, "b")).json())).not.toContain("MY_PRIVATE_TREE");
    await request("/users/me/preferences", "PATCH", { translationLanguage: "pl" });
    expect((await (await request(`/study/history/${saved.id}`)).json()).words[0].word.selectedTranslation).toEqual({ language: "pl", text: null });
    expect(fixture.sessions.size).toBe(1); expect(fixture.progressFor(userA.id, "shared")!.knownCount).toBe(before!.knownCount);
  });

});
