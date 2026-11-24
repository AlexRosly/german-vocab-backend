import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { TRANSLATION_LANGUAGE_CODES } from "../languages/language-options";
import { personalExamplesReady } from "../words/personal-example-translations.service";
export type PersonalExampleInput = { exampleId?: string; german: string; language: string; text: string };
export function parsePersonalExampleTranslations(value: string): PersonalExampleInput[] {
  if (!value) return [];
  const rows: unknown = JSON.parse(value);
  if (!Array.isArray(rows) || rows.length > 20 * TRANSLATION_LANGUAGE_CODES.length) throw new BadRequestException("dictionary_import_personal_examples_invalid");
  return rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(k => !["exampleId", "german", "language", "text"].includes(k)) ||
      (row.exampleId !== undefined && (typeof row.exampleId !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(row.exampleId))) ||
      typeof row.german !== "string" || !row.german.trim() || [...row.german].length > 1000 ||
      typeof row.text !== "string" || !row.text.trim() || [...row.text].length > 1000 || !TRANSLATION_LANGUAGE_CODES.includes(row.language)) throw new BadRequestException("dictionary_import_personal_examples_invalid");
    return { ...(row.exampleId ? { exampleId: row.exampleId } : {}), german: row.german.normalize("NFC").trim(), language: row.language, text: row.text.normalize("NFC").replace(/\r\n?/g, "\n").trim() };
  });
}
export async function importPersonalExampleTranslations(tx: Prisma.TransactionClient, userId: string, wordId: string, incoming: PersonalExampleInput[], write: boolean): Promise<string[]> {
  if (!incoming.length) return [];
  if (!await personalExamplesReady(tx)) throw new ServiceUnavailableException("Личные переводы примеров пока недоступны");
  const examples = await tx.wordExample.findMany({ where: { wordId }, select: { id: true, german: true } });
  const current = await tx.personalExampleTranslation.findMany({ where: { userId, exampleId: { in: examples.map(e => e.id) } } });
  const existing = new Map(current.map(row => [JSON.stringify([row.exampleId, row.language]), row]));
  const seen = new Map<string, string>(), warnings = new Set<string>();
  for (const row of incoming) {
    // IDs from files never select another card. Text is checked as well, preventing stale example reuse.
    const exact = examples.find(e => e.id === row.exampleId && e.german.normalize("NFC").trim() === row.german);
    const candidates = examples.filter(e => e.german.normalize("NFC").trim() === row.german);
    const target = exact ?? (candidates.length === 1 ? candidates[0] : null);
    if (!target) { warnings.add("personal_examples_unmatched"); continue; }
    const key = JSON.stringify([target.id, row.language]), previous = existing.get(key), staged = seen.get(key);
    if (previous ? previous.text !== row.text || previous.sourceGerman !== target.german : staged !== undefined && staged !== row.text) { warnings.add("personal_examples_conflict"); continue; }
    if (write && !previous && staged === undefined) await tx.personalExampleTranslation.create({ data: {
      userId, exampleId: target.id, language: row.language, text: row.text, sourceGerman: target.german, revision: randomUUID(),
    } });
    seen.set(key, row.text);
  }
  return [...warnings];
}
