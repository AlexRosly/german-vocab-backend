import { importPersonalExampleTranslations, parsePersonalExampleTranslations } from "../src/dictionary-import/personal-example-import";
import { EXPORT_COLUMNS, csvHeader, csvLine } from "../src/dictionary-export/dictionary-csv";
import { parseDictionaryCsv } from "../src/dictionary-import/dictionary-csv-reader";
import { savedRow } from "../src/dictionary-import/import-materials";

describe("Private example CSV materials: validation and safe matching", () => {
  const incoming = { exampleId: "old-id", german: "Das Haus ist groß.", language: "ru", text: "Мой дом" };
  it("retains private example materials through the CSV parser and durable import plan", () => {
    const csv = csvHeader(EXPORT_COLUMNS) + csvLine(EXPORT_COLUMNS, { german: "Haus", word_type: "noun", article: "das", grammatical_number: "singular", plural_form: "Häuser", translation_ru: "дом", personal_example_translations_json: JSON.stringify([incoming]) });
    const row = parseDictionaryCsv(Buffer.from(csv))[0]; expect(row.errors).toEqual([]);
    expect(savedRow(row).personal.exampleTranslations).toEqual([incoming]);
  });
  it("rejects unsupported languages, ownership injection, oversized text and empty target sentences", () => {
    for (const data of [{}, [{ ...incoming, userId: "other" }], [{ ...incoming, language: "xx" }], [{ ...incoming, german: " " }], [{ ...incoming, text: "x".repeat(1001) }]]) expect(() => parsePersonalExampleTranslations(JSON.stringify(data))).toThrow();
  });
  it("matches only examples of the selected word and does not overwrite private conflicts", async () => {
    const create = jest.fn(), db: any = { $queryRaw: async () => [{ ready: true }], wordExample: { findMany: jest.fn().mockResolvedValue([{ id: "current-id", german: incoming.german }]) }, personalExampleTranslation: { findMany: async () => [{ exampleId: "current-id", language: "ru", text: "Existing private text", sourceGerman: incoming.german }], create } };
    expect(await importPersonalExampleTranslations(db, "a", "selected-word", [incoming], true)).toEqual(["personal_examples_conflict"]);
    expect(db.wordExample.findMany).toHaveBeenCalledWith({ where: { wordId: "selected-word" }, select: { id: true, german: true } });
    expect(create).not.toHaveBeenCalled();
    expect(await importPersonalExampleTranslations(db, "a", "selected-word", [{ ...incoming, german: "Wrong sentence" }], true)).toEqual(["personal_examples_unmatched"]);
  });
});
