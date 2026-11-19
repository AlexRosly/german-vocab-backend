import { xlsxFixture } from "./support/xlsx-fixture";
import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { DictionaryExportThrottle } from "../src/dictionary-export/dictionary-export.controller";
import { csvHeader, csvLine, EXPORT_COLUMNS, TEMPLATE_COLUMNS, templateCsv } from "../src/dictionary-export/dictionary-csv";
import { DictionaryImportController } from "../src/dictionary-import/dictionary-import.controller";
import { DictionaryImportService } from "../src/dictionary-import/dictionary-import.service";
import { MAX_IMPORT_BYTES, parseDictionaryCsv } from "../src/dictionary-import/dictionary-csv-reader";
import { userA, userB, admin } from "./support/words-database";
const baseRow = { german: "Haus", word_type: "noun", article: "das", grammatical_number: "singular", translation_en: "house" };
const csv = (rows: any[], columns = [...new Set([...TEMPLATE_COLUMNS, ...rows.flatMap(r => Object.keys(r))])]) => csvHeader(columns) + rows.map(r => csvLine(columns, r)).join("");
const card = (id: string, german = "Haus", data: any = {}) => ({ id, german, article: "das", grammaticalNumber: "singular", translation: "", translations: [{ language: "en", text: "house" }], verbForms: [], userWords: [], publicationStatus: "PUBLISHED", createdByUserId: userB.id, ...data });
function matches(word: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: any) => key === "AND" ? value.every((w: any) => matches(word, w)) : key === "OR" ? value.some((w: any) => matches(word, w)) : typeof value === "object" ? value.in ? value.in.includes(word[key]) : word[key].toLocaleLowerCase("de") === value.equals.toLocaleLowerCase("de") : word[key] === value);
}
describe("Read-only dictionary CSV preview HTTP", () => {
  let app: INestApplication, url: string, db: any, words: any[];
  beforeEach(async () => {
    words = [card("house")];
    db = { $queryRaw: jest.fn().mockResolvedValue([{ ready:false }]), $executeRawUnsafe: jest.fn(), $transaction: jest.fn(), word: { findMany: jest.fn(async ({ where, select, take }: any) => words.filter(w => matches(w, where)).slice(0, take).map(w => Object.fromEntries(Object.keys(select).map(k => [k, k === "userWords" ? w[k].filter((u: any) => u.userId === select.userWords.where.userId).map((u: any) => ({ wordId: u.wordId })) : w[k]])))) } };
    db.$transaction.mockImplementation((work: any) => work(db));
    const module = await Test.createTestingModule({ imports: [AuthModule], controllers: [DictionaryImportController], providers: [DictionaryImportService, DictionaryExportThrottle, PrismaService] })
      .overrideProvider(PrismaService).useValue(db).overrideProvider(AuthService).useValue({ authenticate: async (token: string) => { const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null; if (!user) throw new UnauthorizedException(); return { user, sessionId: "test" }; } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1"); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.listen(0, "127.0.0.1"); url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/dictionary-import`;
  });
  afterEach(async () => app?.close());
  function request(content: string | Uint8Array, actor = "a", name = "file.csv", route = "/preview", field?: string) { const form = new FormData(); form.append("file", new Blob([content as BlobPart]), name); if (field) form.append(field, "ADMIN"); return fetch(url + route, { method: "POST", headers: actor ? { authorization: "Bearer " + actor.repeat(43) } : {}, body: form }); }
  it("authenticates capabilities/uploads, rejects owner/status overrides and does not call persistence", async () => {
    expect((await fetch(url + "/config")).status).toBe(401); expect((await request(csv([baseRow]), "")).status).toBe(401);
    const config = await fetch(url + "/config", { headers: { authorization: "Bearer " + "a".repeat(43) } }); expect(config.headers.get("cache-control")).toBe("private, no-store"); expect(await config.json()).toMatchObject({ readOnly: true, formats: ["csv", "xlsx"] });
    expect((await request(csv([baseRow]), "a", "file.csv", "/preview?userId=other")).status).toBe(400);
    expect((await request(csv([baseRow]), "b", "file.csv", "/preview", "publicationStatus")).status).toBe(400);
    expect((await request(csv([{ ...baseRow, role: "ADMIN" }]), "c")).status).toBe(400); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("classifies new, existing, in-file duplicate, ambiguous and invalid verb rows without writing", async () => {
    words[0].german="das Haus"; // Existing manual cards may already include the article.
    words.push(card("bank1", "Bank", { article: "die", translations: [{ language: "en", text: "bank" }] }), card("bank2", "Bank", { article: "die", translations: [{ language: "en", text: "bench" }] }));
    const response = await request(csv([baseRow, { ...baseRow, german: "Wald", translation_en: "forest" }, { ...baseRow, german: "das   Haus", source_book: "Another book", lesson_number: "2", personal_note: "Different note" }, { ...baseRow, german: "Bank", article: "die", translation_en: "bank" }, { german: "gehen", word_type: "verb", article: "none", grammatical_number: "not_applicable" }]));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); const data = await response.json(); expect(data).toMatchObject({ readOnly: true, total: 5, counts: { new: 1, existing: 1, duplicate: 1, choice: 1, error: 1 } }); expect(data.rows[2].duplicateOf).toBe(1); expect(data.rows[3].candidates).toHaveLength(2); expect(data.rows[4].fields).toContain("verb_forms_required");
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY"); expect(db.$transaction.mock.calls[0][1].isolationLevel).toBe("RepeatableRead");
  });
  it("keeps umlauts, grammatical articles and different meanings distinct; does not infer verbs from none", async () => {
    words = [card("schon", "schon", { article: "none", grammaticalNumber: "not_applicable", translations: [] }), card("leiter", "Leiter", { article: "der" })];
    const other = { german: "schön", word_type: "other", article: "none", grammatical_number: "not_applicable" };
    const data = await (await request(csv([other, { ...baseRow, german: "Leiter", article: "die" }, { ...baseRow, german: "Bank", article: "die", translation_en: "bank" }, { ...baseRow, german: "Bank", article: "die", translation_en: "bench" }]))).json();
    expect(data.rows.map((r: any) => r.status)).toEqual(["new", "new", "choice", "choice"]);
  });
  it("never exposes other users' drafts or materials, even for ADMIN; checks ID against lexical identity", async () => {
    words.push(card("private-b", "Geheim", { publicationStatus: "PENDING_REVIEW", createdByUserId: userB.id }), card("own-a", "Eigen", { publicationStatus: "REJECTED", createdByUserId: userA.id }));
    words[0].userWords = [{ userId: userA.id, wordId: "house" }, { userId: userB.id, wordId: "house" }];
    const input = csv([{ ...baseRow, word_id: "house" }, { ...baseRow, german: "Geheim", word_id: "private-b" }, { ...baseRow, german: "Eigen", word_id: "own-a" }, { ...baseRow, german: "Falsch", word_id: "house" }]);
    const data = await (await request(input)).json(); expect(data.rows.map((r: any) => r.status)).toEqual(["existing", "choice", "existing", "choice"]); expect(data.rows[1].candidates).toEqual([]); expect(data.rows[0].candidates[0].inDictionary).toBe(true); expect(JSON.stringify(data)).not.toMatch(/createdByUserId|userId|password|REJECTED/);
    const adminData = await (await request(input, "c")).json(); expect(adminData.rows[2].status).toBe("choice"); expect(adminData.rows[1].candidates).toEqual([]);
  });
  it("recognizes separate exported meanings by their own IDs instead of treating homonyms as duplicates", async () => {
    words = [card("bank1", "Bank", { article: "die", translations: [{ language: "en", text: "bank" }] }), card("bank2", "Bank", { article: "die", translations: [{ language: "en", text: "bench" }] })];
    const data = await (await request(csv([{ ...baseRow, german: "Bank", article: "die", word_id: "bank1", translation_en: "bank" }, { ...baseRow, german: "Bank", article: "die", word_id: "bank2", translation_en: "bank" }]))).json(); expect(data.rows.map((r: any) => r.status)).toEqual(["existing", "existing"]);
    words.push(...Array.from({ length: 6 }, (_, i) => card("extra" + i, "Bank", { article: "die", translations: [{ language: "en", text: "meaning " + i }] })));
    const many = await (await request(csv([{ ...baseRow, german: "Bank", article: "die", word_id: "extra5" }]))).json(); expect(many.rows[0].candidates).toHaveLength(5); expect(many.rows[0].moreCandidates).toBe(true); expect(many.rows[0].candidates[0].id).toBe("extra5");
  });
  it("accepts templates and full v1 exports with quoted multiline fields, all 11 translations and reversible formula escapes", () => {
    expect(parseDictionaryCsv(Buffer.from(templateCsv(true).csv)).map(r => r.errors)).toEqual([[], [], []]);
    const expression = parseDictionaryCsv(Buffer.from(csv([{ german: "der Reihe nach", word_type: "other", article: "none", grammatical_number: "not_applicable" }])))[0]; expect(expression.errors).toEqual([]); expect(expression.german).toBe("der Reihe nach");
    const values = { ...baseRow, format_version: "1", personal_note: "\t=literal;\"quoted\"\nnext", shared_note: "-text", extra_examples_json: JSON.stringify([{ id: "e1", german: "Das ist ein Haus.", translations: [{ language: "uk", text: "Це будинок." }] }]), extra_verb_forms_json: "[]", source_books_json: JSON.stringify([{ sourceBook: "A1 Treffpunkt", lessonNumbers: [1, 2] }]), personal_books_json: '["My book"]' };
    const row = parseDictionaryCsv(Buffer.from(csv([values], EXPORT_COLUMNS)))[0]; expect(row.errors).toEqual([]); expect(row.values.personal_note).toBe(values.personal_note); expect(row.values.shared_note).toBe("-text"); expect(row.exampleCount).toBe(1);
    const raw = csvHeader(TEMPLATE_COLUMNS) + TEMPLATE_COLUMNS.map(c => '"' + (c === "personal_note" ? "\t=literal" : String((baseRow as any)[c] ?? "")).replace(/"/g, '""') + '"').join(";") + "\r\n";
    expect(parseDictionaryCsv(Buffer.from(raw))[0].values.personal_note).toBe("\t=literal");
    expect(parseDictionaryCsv(Buffer.from(csv([{ ...baseRow, german: "Ha\u0308user" }])))[0].german).toBe("Häuser");
  });
  it("reports invalid extra JSON, booleans, grammar, books, levels and incomplete forms per row", () => {
    const rows = [{ ...baseRow, extra_examples_json: '{"bad":1}' }, { ...baseRow, is_favorite: "yes" }, { ...baseRow, article: "der", german: "das Haus" }, { ...baseRow, source_books_json: '[{"sourceBook":"Book","lessonNumbers":[0]}]' }, { ...baseRow, level: "B1+" }, { ...baseRow, extra_verb_forms_json: "[{}]" }, { ...baseRow, personal_books_json: JSON.stringify(["\u0000"]) }];
    expect(parseDictionaryCsv(Buffer.from(csv(rows))).every(r => r.errors.length > 0)).toBe(true);
  });
  it("rejects bad encoding, unknown/duplicate headers, malformed quoting, XLSX and limits without silent truncation", async () => {
    let attempt=0; for (const content of ['german;word_type;article;grammatical_number;german\nHaus;noun;das;singular;Haus\n', csv([baseRow]) + '"unclosed', 'garbage', new Uint8Array([0xff, 0xfe])]) expect((await request(content, attempt++ < 3 ? "a" : "b")).status).toBe(400);
  });
  it("enforces file format, size and record limits", async () => {
    expect((await request(csv([baseRow]), "a", "words.xlsx")).status).toBe(400);
    expect((await request(new Uint8Array(MAX_IMPORT_BYTES + 1), "b")).status).toBe(413);
    expect(() => parseDictionaryCsv(Buffer.from(csvHeader(TEMPLATE_COLUMNS) + csvLine(TEMPLATE_COLUMNS, baseRow).repeat(10001)))).toThrow("dictionary_import_too_many_rows");
    expect(() => parseDictionaryCsv(Buffer.from(templateCsv().csv))).toThrow("dictionary_import_empty");
    expect(() => parseDictionaryCsv(Buffer.from('"german";"word_type";"article";"grammatical_number"\r\n"' + 'x'.repeat(300000) + '";"other";"none";"not_applicable"\r\n'))).toThrow("dictionary_import_invalid_csv");
  });
  it("limits previews per account and keeps retry results stable", async () => {
    const first = await (await request(csv([baseRow]))).json(); const second = await (await request(csv([baseRow]))).json(); expect(second).toEqual(first);
    expect((await request(csv([baseRow]))).status).toBe(200); expect((await request(csv([baseRow]))).status).toBe(429); expect((await request(csv([baseRow]), "b")).status).toBe(200);
  });
  it("previews Excel through the same duplicate and access checks and rejects extension mismatch", async () => {
    const bytes=xlsxFixture([["german","word_type","article","grammatical_number","translation_en"],["Haus","noun","das","singular","house"],["Haus","noun","das","singular","house"]]);
    const response=await request(bytes,"a","words.xlsx");expect(response.status).toBe(200);expect(await response.json()).toMatchObject({readOnly:true,total:2,counts:{existing:1,duplicate:1,new:0,error:0,choice:0}});
    expect((await request(csv([baseRow]),"a","wrong.xlsx")).status).toBe(400);expect((await request(bytes,"a","wrong.csv")).status).toBe(400);
  });

});
