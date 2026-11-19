import { BadRequestException, HttpException, PayloadTooLargeException, ServiceUnavailableException } from "@nestjs/common";
import { posix } from "node:path";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";
import { parser, type QualifiedTag } from "sax";
import { EXPORT_COLUMNS } from "../dictionary-export/dictionary-csv";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseDictionaryCsv, type ImportRow } from "./dictionary-csv-reader";

// Keep the production reader compatible with Node versions without zlib.crc32.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer, previous = 0): number {
  let value = previous ^ 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
const MAX_EXPANDED = 64 * 1024 * 1024, MAX_PART = 32 * 1024 * 1024;
const invalid = () => new BadRequestException("dictionary_import_invalid_xlsx");
const limit = () => new PayloadTooLargeException("dictionary_import_xlsx_limits");
let active = 0;
type Tag = { name: string; uri: string; attrs: Record<string, string> };
type Budget = { deadline: number; nodes: number };
const checkpoint = (budget: Budget) => { if (Date.now() > budget.deadline) throw limit(); };

async function archive(buffer: Buffer, budget: Budget): Promise<Map<string, Buffer>> {
  const zip = await new Promise<ZipFile>((resolve, reject) => fromBuffer(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (e, z) => e ? reject(e) : resolve(z!)));
  const parts = new Map<string, Buffer>(), seen = new Set<string>();
  let expanded = 0, failure: Error | null = null;
  zip.on("error", e => { failure = e; });
  try {
    for (;;) {
      checkpoint(budget);
      const entry = await new Promise<Entry | null>((resolve, reject) => {
        const done = (e: Entry | null) => { cleanup(); resolve(e); };
        const fail = (e: Error) => { cleanup(); reject(e); };
        const end = () => done(null);
        const cleanup = () => { zip.off("entry", done); zip.off("error", fail); zip.off("end", end); };
        zip.once("entry", done); zip.once("error", fail); zip.once("end", end); zip.readEntry();
      });
      if (!entry) break;
      const name = entry.fileName;
      if (seen.has(name) || seen.size >= 512 || name.length > 240 || name.startsWith("/") || name.includes("\\") || name.split("/").some(p => p === ".." || p === ".")) throw invalid();
      seen.add(name); expanded += entry.uncompressedSize;
      if (expanded > MAX_EXPANDED || entry.uncompressedSize > MAX_PART) throw limit();
      if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod) || /(?:vbaProject|externalLinks|embeddings|activeX|connections\.xml)/i.test(name)) throw invalid();
      if (!/^(?:\[Content_Types\]\.xml|_rels\/\.rels|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(name)) continue;
      const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (e, s) => e ? reject(e) : resolve(s!)));
      const chunks: Buffer[] = []; let length = 0, checksum = 0;
      try {
        for await (const part of stream as AsyncIterable<Buffer>) {
          checkpoint(budget); length += part.length;
          if (length > MAX_PART || length > entry.uncompressedSize) throw limit();
          checksum = crc32(part, checksum); chunks.push(part);
        }
      } finally { (stream as NodeJS.ReadableStream & { destroy(): void }).destroy(); }
      if (length !== entry.uncompressedSize || checksum !== entry.crc32) throw invalid();
      parts.set(name, Buffer.concat(chunks));
      if (failure) throw failure;
    }
  } finally { zip.close(); }
  return parts;
}

async function xml(bytes: Buffer | undefined, budget: Budget, open: (tag: Tag, stack: string[]) => void, text: (value: string, stack: string[]) => void = () => {}, close: (name: string, stack: string[]) => void = () => {}) {
  if (!bytes) throw invalid();
  let content: string; try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw invalid(); }
  const p = parser(true, { xmlns: true, position: false }), stack: string[] = [];
  p.ondoctype = () => { throw invalid(); };
  p.onerror = () => { throw invalid(); };
  p.onopentag = raw => {
    if (++budget.nodes > 2_000_000 || stack.length > 32) throw limit();
    const t = raw as QualifiedTag, attrs: Record<string, string> = Object.create(null);
    if (Object.keys(t.attributes).length > 96) throw limit();
    for (const a of Object.values(t.attributes)) { if (a.value.length > 65536) throw limit(); attrs[a.name] = a.value; }
    stack.push(t.local); open({ name: t.local, uri: t.uri, attrs }, stack);
  };
  p.ontext = value => text(value, stack); p.oncdata = p.ontext;
  p.onclosetag = () => { close(stack[stack.length - 1], stack); stack.pop(); };
  for (let i = 0; i < content.length; i += 32768) { checkpoint(budget); p.write(content.slice(i, i + 32768)); await yieldLoop(); }
  p.close();
}
const unescapeExcel = (v: string) => v.replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
const cellRef = (ref: string) => {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref);
  if (!match || Number(match[2]) > 1048576) throw invalid();
  const col = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  if (col > EXPORT_COLUMNS.length) throw limit();
  return { col: col - 1, row: Number(match[2]) };
};

export async function parseDictionaryXlsx(buffer: Buffer): Promise<ImportRow[]> {
  if (buffer.length > MAX_IMPORT_BYTES) throw limit();
  if (active >= 2) throw new ServiceUnavailableException("dictionary_import_xlsx_busy");
  active++;
  try {
    const budget: Budget = { deadline: Date.now() + 15000, nodes: 0 }, parts = await archive(buffer, budget);
    const relationships = new Map<string, { type: string; target: string }>();
    await xml(parts.get("[Content_Types].xml"), budget, ({ attrs }) => { if (/macroEnabled|vbaProject/i.test(attrs.ContentType ?? "")) throw invalid(); });
    let rootTarget = "";
    await xml(parts.get("_rels/.rels"), budget, ({ name, attrs }) => {
      if (name === "Relationship" && /\/officeDocument$/.test(attrs.Type ?? "")) {
        if (rootTarget || attrs.TargetMode === "External") throw invalid(); rootTarget = attrs.Target;
      }
    });
    if (rootTarget?.replace(/^\//, "") !== "xl/workbook.xml") throw invalid();
    await xml(parts.get("xl/_rels/workbook.xml.rels"), budget, ({ name, attrs }) => {
      if (name !== "Relationship") return;
      if (!attrs.Id || relationships.has(attrs.Id) || attrs.TargetMode === "External" || !attrs.Target || /[?#\\]/.test(attrs.Target)) throw invalid();
      const target = posix.normalize(attrs.Target.startsWith("/") ? attrs.Target.slice(1) : "xl/" + attrs.Target);
      if (!target.startsWith("xl/")) throw invalid(); relationships.set(attrs.Id, { type: attrs.Type, target });
    });
    const sheets: { target: string; hidden: boolean }[] = [];
    let workbook = false;
    await xml(parts.get("xl/workbook.xml"), budget, ({ name, uri, attrs }, stack) => {
      if (stack.length === 1) workbook = name === "workbook" && /(?:spreadsheetml\/2006\/main|ooxml\/spreadsheetml\/main)$/.test(uri);
      if (name !== "sheet" || stack.join("/") !== "workbook/sheets/sheet") return;
      const id = Object.keys(attrs).find(k => k.endsWith(":id")), rel = id && relationships.get(attrs[id]);
      if (!rel || !/\/worksheet$/.test(rel.type) || !/^xl\/worksheets\/[^/]+\.xml$/.test(rel.target) || sheets.some(s => s.target === rel.target)) throw invalid();
      if (sheets.length >= 16) throw limit(); sheets.push({ target: rel.target, hidden: !!attrs.state && attrs.state !== "visible" });
    });
    if (!workbook || !sheets.length) throw invalid();
    const shared: string[] = []; let sharedValue = "", sharedLength = 0;
    const sharedRel = [...relationships.values()].filter(r => /\/sharedStrings$/.test(r.type));
    if (sharedRel.length > 1) throw invalid();
    if (sharedRel.length) await xml(parts.get(sharedRel[0].target), budget, ({ name }, stack) => { if (name === "si" && stack.length === 2) sharedValue = ""; }, (value, stack) => {
      if (stack[0] === "sst" && stack[1] === "si" && stack.at(-1) === "t" && !stack.includes("rPh")) { sharedValue += value; if (sharedValue.length > 65536) throw limit(); }
    }, (name, stack) => {
      if (name === "si" && stack.length === 2) { sharedLength += sharedValue.length; if (shared.length >= 200000 || sharedLength > MAX_IMPORT_BYTES) throw limit(); shared.push(unescapeExcel(sharedValue)); }
    });
    let selected: string[][] | undefined;
    for (const sheet of sheets) {
      const rows: string[][] = []; let row: string[] | undefined, rowNo = 0, lastRow = 0, lastCol = -1, cells = 0;
      let cell: { col: number; type: string; text: string; value: string; hasValue: boolean } | undefined;
      await xml(parts.get(sheet.target), budget, ({ name, attrs }, stack) => {
        if (stack.length === 1 && name !== "worksheet") throw invalid();
        if (name === "f") throw new BadRequestException("dictionary_import_xlsx_formulas");
        if (name === "mergeCell") throw new BadRequestException("dictionary_import_xlsx_merged");
        if (stack.join("/") === "worksheet/sheetData/row") {
          rowNo = attrs.r ? Number(attrs.r) : lastRow + 1;
          if (!Number.isInteger(rowNo) || rowNo <= lastRow || rowNo > 1048576) throw invalid();
          lastRow = rowNo; row = []; lastCol = -1;
        }
        if (stack.join("/") === "worksheet/sheetData/row/c") {
          if (++cells > 600000 || !row || cell) throw limit();
          const ref = attrs.r ? cellRef(attrs.r) : { row: rowNo, col: lastCol + 1 };
          if (ref.row !== rowNo || ref.col <= lastCol || ref.col >= EXPORT_COLUMNS.length) throw invalid();
          lastCol = ref.col; cell = { col: ref.col, type: attrs.t ?? "n", text: "", value: "", hasValue: false };
        }
        if (name === "v" && cell) { if (cell.hasValue) throw invalid(); cell.hasValue = true; }
      }, (value, stack) => {
        if (!cell) return;
        if (stack.at(-1) === "v") cell.value += value;
        if (cell.type === "inlineStr" && stack.includes("is") && stack.at(-1) === "t" && !stack.includes("rPh")) cell.text += value;
        if (cell.text.length + cell.value.length > 65536) throw limit();
      }, (name, stack) => {
        if (name === "c" && stack.join("/") === "worksheet/sheetData/row/c" && cell && row) {
          const c = cell; let value = c.value;
          if (c.type === "s") { if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) >= shared.length) throw invalid(); value = shared[Number(value)]; }
          else if (c.type === "inlineStr") value = unescapeExcel(c.text);
          else if (c.type === "b") { if (!["0", "1"].includes(value)) throw invalid(); value = value === "1" ? "true" : "false"; }
          else if (c.type === "n") { if (value && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) throw invalid(); }
          else if (c.type === "str") value = unescapeExcel(value);
          else throw new BadRequestException("dictionary_import_xlsx_cell_type");
          row[c.col] = value; cell = undefined;
        }
        if (name === "row" && stack.join("/") === "worksheet/sheetData/row" && row) {
          if (row.some(v => v !== undefined && v !== "")) { if (rows.length > MAX_IMPORT_ROWS) throw limit(); rows.push(row); }
          row = undefined;
        }
      });
      if (rows.length) {
        if (selected || sheet.hidden) throw new BadRequestException("dictionary_import_xlsx_one_sheet");
        selected = rows;
      }
    }
    if (!selected?.length) throw new BadRequestException("dictionary_import_empty");
    const width = selected[0].length;
    if (selected.some(row => row.length > width)) throw invalid();
    let length = 0;
    const csv = selected.map(row => {
      const line = Array.from({ length: width }, (_, i) => '"' + (row[i] ?? "").replace(/"/g, '""') + '"').join(";") + "\r\n";
      length += Buffer.byteLength(line); if (length > MAX_IMPORT_BYTES) throw limit(); return line;
    }).join("");
    try { return parseDictionaryCsv(Buffer.from(csv)); }
    catch (error) { if (error instanceof BadRequestException && error.message === "dictionary_import_invalid_csv") throw invalid(); throw error; }
  } catch (error) { if (error instanceof HttpException) throw error; throw invalid(); }
  finally { active--; }
}
