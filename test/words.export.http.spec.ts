import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { DictionaryExportController, DictionaryExportThrottle } from "../src/dictionary-export/dictionary-export.controller";
import { DictionaryExportService } from "../src/dictionary-export/dictionary-export.service";
import { csvCell, EXPORT_COLUMNS, MAX_EXPORT_BYTES, templateCsv, TEMPLATE_COLUMNS, wordRow } from "../src/dictionary-export/dictionary-csv";
import { userA, userB, admin } from "./support/words-database";

// Independent RFC-style CSV reader: semicolon dialect, doubled quotes and embedded newlines.
function parse(text: string): string[][] {
  text = text.replace(/^\uFEFF/, ""); const result: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ";") { row.push(cell); cell = ""; }
    else if (!quoted && c === "\r" && text[i + 1] === "\n") { row.push(cell); result.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  if (quoted || row.length || cell) throw Error("Invalid CSV end"); return result;
}
function sample(id = "word"): any { return { id, german: "gehen", article: "none", grammaticalNumber: "not_applicable", pluralForm: null, level: null, sourceBook: "B1+ Brückenkurs", lessonNumber: 1, notes: "Note; \"quoted\"\nnext line", translation: "идти", publicationStatus: "PUBLISHED", createdByUserId: userB.id,
  translations: [{ language: "en", text: "go" }, { language: "ru", text: "идти" }],
  verbForms: [{ praeteritum: "ging", participle2: "gegangen", auxiliary: "SEIN", reflexive: false, usage: null }, { praeteritum: "ging", participle2: "gegangen", auxiliary: "HABEN", reflexive: true, usage: "another variant" }],
  examples: [{ id: "e1", german: "Ich gehe.", translation: "Я иду.", translations: [] }, { id: "e2", german: "Wir gehen.", translation: "Мы идём.", translations: [] }],
  bookSources: [{ sourceBook: "A1 Treffpunkt", lessonNumbers: [1, 2] }],
  userWords: [{ userId: userA.id, isFavorite: true, isArchived: true }, { userId: userB.id, isFavorite: false, isArchived: false }],
  personalNotes: [{ userId: userA.id, text: "ONLY_A" }, { userId: userB.id, text: "PRIVATE_B_NOTE" }],
  personalTranslations: [{ userId: userA.id, language: "uk", text: "йти" }, { userId: userB.id, language: "de", text: "PRIVATE_B_TRANSLATION" }],
  personalBooks: [{ userId: userA.id, titles: ["My book"] }, { userId: userB.id, titles: ["PRIVATE_B_BOOK"] }], passwordHash: "AUTH_HASH_MUST_NOT_LEAK" }; }
type AnyRow = Record<string, any>;
function matches(word: AnyRow, where: AnyRow): boolean {
  return Object.entries(where ?? {}).every(([field, value]) => field === "AND" ? value.every((w: AnyRow) => matches(word, w)) : field === "OR" ? value.some((w: AnyRow) => matches(word, w)) : field === "userWords" ? word.userWords.some((r: AnyRow) => matches(r, value.some)) : word[field] === value);
}
function project(row: AnyRow, select: AnyRow): AnyRow {
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [key, value === true ? row[key] : row[key].filter((r: AnyRow) => matches(r, value.where)).map((r: AnyRow) => project(r, value.select))]));
}
describe("Private dictionary CSV HTTP (real services, mocked database)", () => {
  let app: INestApplication, base: string, rows: AnyRow[], db: any;
  beforeEach(async () => {
    rows = [sample()];
    db = { $queryRaw: jest.fn().mockResolvedValue([{ ready:false }]), $executeRawUnsafe: jest.fn().mockResolvedValue(0), $transaction: jest.fn(),
      word: { count: jest.fn(async ({ where }) => rows.filter(w => matches(w, where)).length), findMany: jest.fn(async ({ where, select, cursor, take }) => rows.filter(w => matches(w, where)).sort((a, b) => a.id.localeCompare(b.id)).filter(w => !cursor || w.id > cursor.id).slice(0, take).map(w => project(w, select))) },
      wordExample: { count: jest.fn(async ({ where }) => rows.filter(w => matches(w, where.word)).reduce((n, w) => n + w.examples.length, 0)) } };
    db.$transaction.mockImplementation((work: (tx: unknown) => unknown) => work(db));
    const module = await Test.createTestingModule({ imports: [AuthModule], controllers: [DictionaryExportController], providers: [DictionaryExportService, DictionaryExportThrottle, PrismaService] })
      .overrideProvider(PrismaService).useValue(db).overrideProvider(AuthService).useValue({ authenticate: async (token: string) => { const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null; if (!user) throw new UnauthorizedException(); return { user, sessionId: "test" }; } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1"); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/dictionary-export`;
  });
  afterEach(async () => app?.close());
  const request = (route = "/csv", actor = "a") => fetch(base + route, { headers: actor ? { authorization: `Bearer ${actor.repeat(43)}` } : {} });
  it("requires auth for data and templates and refuses userId/query overrides", async () => {
    for (const route of ["/config", "/csv", "/template"]) expect((await request(route, "")).status).toBe(401);
    expect((await request("/csv?userId=" + userB.id)).status).toBe(400); expect((await request("/template?variant=wrong")).status).toBe(400); expect(db.word.findMany).not.toHaveBeenCalled();
  });
  it("exports all caller fields and variants with BOM, quoting and private no-store headers", async () => {
    const response = await request(); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toMatch(/^text\/csv/); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("x-wortkarten-word-count")).toBe("1"); expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="wortkarten-dictionary-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await response.arrayBuffer()); expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]); const text = new TextDecoder().decode(bytes); const [headers, data] = parse(text), record = Object.fromEntries(headers.map((h, i) => [h, data[i]]));
    expect(headers).toEqual(EXPORT_COLUMNS); expect(record).toMatchObject({ word_id: "word", word_type: "verb", level: "", praeteritum: "ging", participle_ii: "gegangen", auxiliary: "sein", is_archived: "true", is_favorite: "true", personal_note: "ONLY_A", personal_translation_uk: "йти", translation_de: "", shared_note: rows[0].notes });
    expect(JSON.parse(record.extra_verb_forms_json)).toHaveLength(1); expect(JSON.parse(record.extra_examples_json)[0].german).toBe("Wir gehen."); expect(JSON.parse(record.source_books_json)[0].lessonNumbers).toEqual([1, 2]); expect(JSON.parse(record.personal_books_json)).toEqual(["My book"]); expect(text).not.toMatch(/PRIVATE_B|AUTH_HASH|passwordHash|accessToken|createdByUserId/);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY"); expect(db.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: "RepeatableRead" });
  });
  it("never exports unlinked words, foreign unpublished words or another member's materials even for ADMIN", async () => {
    const unlinked = sample("unlinked"); unlinked.userWords = []; const privateB = sample("private-b"); privateB.publicationStatus = "REJECTED"; const own = sample("own"); own.publicationStatus = "PENDING_REVIEW"; own.createdByUserId = userA.id; rows.push(unlinked, privateB, own);
    const values = parse(await (await request()).text()); expect(values).toHaveLength(3); expect(values.flat()).not.toContain("private-b");
    const adminResponse = await request("/csv", "c"); expect(parse(await adminResponse.text())).toHaveLength(1);
    expect(db.word.findMany.mock.calls.at(-1)[0].where.AND[1]).toEqual({ userWords: { some: { userId: admin.id } } });
  });
  it("downloads a genuinely empty template and a separate noun/verb/expression example", async () => {
    expect(parse(await (await request("/template")).text())).toEqual([TEMPLATE_COLUMNS]);
    const parsed = parse(await (await request("/template?variant=example")).text()); expect(parsed).toHaveLength(4); expect(parsed[1][0]).toBe("Haus"); expect(parsed[2][TEMPLATE_COLUMNS.indexOf("auxiliary")]).toBe("sein"); expect(parsed[3][1]).toBe("other"); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("prevents formula/control-prefix injection while preserving reversible source text", () => {
    for (const text of ["=1+2", "+CMD", "-2", "@SUM(1)", "  ＝1", "\t=1", "\nword", "'original"]) {
      const value = parse(csvCell(text) + "\r\n")[0][0]; expect(value.startsWith("\t")).toBe(true); expect(value.slice(1)).toBe(text);
    }
    expect(parse(csvCell('schön; "groß"\nnext') + "\r\n")[0][0]).toBe('schön; "groß"\nnext'); expect(templateCsv(true).wordCount).toBe(3);
  });
  it("pages across 200 records without duplicates, includes archived entries and has deterministic order", async () => {
    rows = Array.from({ length: 201 }, (_, i) => sample("word-" + String(i).padStart(3, "0"))); const data = parse(await (await request()).text()); expect(data).toHaveLength(202); expect(new Set(data.slice(1).map(r => r[1])).size).toBe(201); expect(db.word.findMany).toHaveBeenCalledTimes(2);
  });
  it("refuses oversized exports without sending a truncated successful file", async () => {
    db.word.count.mockResolvedValueOnce(10001); expect((await request()).status).toBe(413); expect(db.word.findMany).not.toHaveBeenCalled();
    db.wordExample.count.mockResolvedValueOnce(10001); expect((await request()).status).toBe(413);
    rows[0].notes = "x".repeat(MAX_EXPORT_BYTES); expect((await request()).status).toBe(413);
  });
  it("limits heavy downloads per authenticated account, not shared IP, while templates remain available", async () => {
    for (let i = 0; i < 3; i++) expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(429); expect((await request("/csv", "b")).status).toBe(200); expect((await request("/template")).status).toBe(200);
  });
});
