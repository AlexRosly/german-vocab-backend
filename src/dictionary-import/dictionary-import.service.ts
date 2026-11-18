import { Injectable, PayloadTooLargeException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../prisma.service";
import { dictionaryWords } from "../words/word-access.service";
import { ImportRow, MAX_IMPORT_BYTES, germanVariants, lexemeKey, meaningsOverlap, normalizeText, parseDictionaryCsv } from "./dictionary-csv-reader";

const select = { id: true, german: true, article: true, grammaticalNumber: true, translation: true,
  translations: { select: { language: true, text: true } }, verbForms: { select: { id: true }, take: 1 },
  userWords: { where: { userId: "" }, select: { wordId: true } } } satisfies Prisma.WordSelect;
type Candidate = Prisma.WordGetPayload<{ select: typeof select }>;
type Status = "new" | "existing" | "duplicate" | "choice" | "error";
const key = (w: Candidate) => lexemeKey({ german: w.german, article: w.article, number: w.grammaticalNumber, type: w.verbForms.length ? "verb" : w.article !== "none" ? "noun" : "other" });
function translations(w: Candidate) { const result = [...w.translations]; if (w.translation && !result.some(t => t.language === "ru")) result.push({ language: "ru", text: w.translation }); return result; }

@Injectable()
export class DictionaryImportService {
  constructor(private readonly prisma: PrismaService) {}
  async preview(user: AuthUser, buffer: Buffer) {
    const rows = parseDictionaryCsv(buffer), valid = rows.filter(r => !r.errors.length);
    // ADMIN imports obey the same public/own-draft scope as ordinary users.
    const candidates = await this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const result = new Map<string, Candidate>();
      const terms: Prisma.WordWhereInput[] = [...new Set(valid.flatMap(germanVariants))].map(german => ({ german: { equals: german, mode: "insensitive" } }));
      const ids = [...new Set(valid.map(r => r.wordId).filter(Boolean))];
      if (ids.length) terms.push({ id: { in: ids } });
      for (let i = 0; i < terms.length; i += 100) {
        const page = await tx.word.findMany({ where: { AND: [dictionaryWords(user.id), { OR: terms.slice(i, i + 100) }] }, select: { ...select, userWords: { where: { userId: user.id }, select: { wordId: true } } }, orderBy: { id: "asc" }, take: 20001 });
        for (const w of page) result.set(w.id, w);
        if (page.length > 20000 || result.size > 20000) throw new PayloadTooLargeException("dictionary_import_too_many_candidates");
      }
      return [...result.values()];
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 60000 });
    const byId = new Map(candidates.map(w => [w.id, w])), byWord = new Map<string, Candidate[]>(), byFile = new Map<string, ImportRow[]>();
    for (const word of candidates) { const k = key(word); byWord.set(k, [...(byWord.get(k) ?? []), word]); }
    for (const row of valid) { const k = lexemeKey(row); byFile.set(k, [...(byFile.get(k) ?? []), row]); }
    const report = rows.map(row => {
      let status: Status = row.errors.length ? "error" : "new", reason = row.errors.length ? "invalid_fields" : "no_match";
      const same = byWord.get(lexemeKey(row)) ?? [], idMatch = row.wordId ? byId.get(row.wordId) : null;
      const fileRows = byFile.get(lexemeKey(row)) ?? [];
      const duplicate = fileRows.find(r => r.row < row.row && (row.wordId && r.wordId ? row.wordId === r.wordId : meaningsOverlap(row.translations, r.translations) || (!row.translations.length && !r.translations.length)));
      if (!row.errors.length) {
        if (row.wordId) { status = idMatch && key(idMatch) === lexemeKey(row) ? "existing" : "choice"; reason = status === "existing" ? "known_id" : "id_unavailable_or_mismatch"; }
        else if (same.length) { status = same.length === 1 && meaningsOverlap(row.translations, translations(same[0])) ? "existing" : "choice"; reason = status === "existing" ? "same_word_and_meaning" : "check_meaning"; }
        if (duplicate) { status = "duplicate"; reason = "repeated_in_file"; }
        else if (reason !== "known_id" && fileRows.some(r => r.row !== row.row && !meaningsOverlap(row.translations, r.translations) && (row.translations.length || r.translations.length))) { status = "choice"; reason = "different_meanings_in_file"; }
      }
      // Only a bounded public/own subset is returned; no author IDs, private notes or other dictionaries.
      const ordered = idMatch && key(idMatch) === lexemeKey(row) ? [idMatch, ...same.filter(w => w.id !== idMatch.id)] : same;
      const options = ordered.slice(0, 5).map(w => ({ id: w.id, german: w.german, article: w.article, inDictionary: !!w.userWords.length, translations: translations(w).slice(0, 3).map(t => ({ language: t.language, text: t.text.slice(0, 160) })) }));
      return { row: row.row, german: row.german, article: row.article, status, reason, fields: row.errors,
        duplicateOf: duplicate?.row ?? null, relatedRows: fileRows.filter(r => r.row !== row.row).slice(0, 5).map(r => r.row), candidates: row.errors.length ? [] : options,
        moreCandidates: same.length > 5, exampleCount: row.exampleCount, verbFormCount: row.verbFormCount,
        sourceBook: normalizeText(row.values.source_book || "").slice(0, 120), lessonNumber: (row.values.lesson_number || "").slice(0, 10) };
    });
    const counts = { new: 0, existing: 0, duplicate: 0, choice: 0, error: 0 }; for (const row of report) counts[row.status]++;
    const result = { version: 1, readOnly: true, total: report.length, counts, rows: report };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_IMPORT_BYTES) throw new PayloadTooLargeException("dictionary_import_too_many_candidates");
    return result;
  }
}
