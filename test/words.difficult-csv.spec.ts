import { csvHeader, csvLine, EXPORT_COLUMNS, templateCsv } from "../src/dictionary-export/dictionary-csv";
import { parseDictionaryCsv } from "../src/dictionary-import/dictionary-csv-reader";
import { savedRow } from "../src/dictionary-import/import-materials";
import { parseDictionaryXlsx } from "../src/dictionary-import/dictionary-xlsx-reader";
import { xlsxFixture } from "./support/xlsx-fixture";

const row = { german: "Haus", word_type: "noun", article: "das", grammatical_number: "singular", translation_en: "house" };
const file = (extra: Record<string, string> = {}) => Buffer.from(csvHeader(EXPORT_COLUMNS) + csvLine(EXPORT_COLUMNS, { ...row, ...extra }));
describe("Personal difficult flag in dictionary files", () => {
  it("reads the same private flag from a typed Excel boolean", async () => {
    const headers = ["german", "word_type", "article", "grammatical_number", "is_difficult"];
    const [parsed] = await parseDictionaryXlsx(xlsxFixture([headers, ["Haus", "noun", "das", "singular", true]]));
    expect(parsed.errors).toEqual([]);
    expect(savedRow(parsed).personal.difficult).toBe(true);
  });
  it("imports explicit booleans and leaves older files unspecified rather than clearing personal state", () => {
    for (const value of ["true", "false"]) {
      const [parsed] = parseDictionaryCsv(file({ is_difficult: value }));
      expect(parsed.errors).toEqual([]);
      expect(savedRow(parsed).personal.difficult).toBe(value === "true");
    }
    expect(savedRow(parseDictionaryCsv(file())[0]).personal.difficult).toBeNull();
    const columns = ["german", "word_type", "article", "grammatical_number"];
    const legacy = Buffer.from(csvHeader(columns) + csvLine(columns, row));
    expect(savedRow(parseDictionaryCsv(legacy)[0]).personal.difficult).toBeNull();
    expect(templateCsv(true).csv).not.toContain('"is_difficult"');
  });
  it("rejects malformed personal flags instead of coercing them", () => {
    for (const value of ["yes", "1", "True", "null"]) {
      expect(parseDictionaryCsv(file({ is_difficult: value }))[0].errors).toContain("invalid_materials");
    }
  });
});
