export type BookSource = { sourceBook: string; lessonNumbers: number[] };
export type BookSourceWord = { sourceBook?: string | null; lessonNumber?: number | null; bookSources?: readonly { sourceBook: string; lessonNumbers: readonly number[] }[] };

// Legacy primary source stays available; imported extra provenance is additive.
export function presentBookSources(word: BookSourceWord): BookSource[] {
  const sources = new Map<string, Set<number>>();
  for (const row of [...(word.bookSources ?? []), ...(word.sourceBook ? [{ sourceBook: word.sourceBook, lessonNumbers: word.lessonNumber == null ? [] : [word.lessonNumber] }] : [])]) {
    const title = row.sourceBook.normalize("NFC").trim().replace(/\s+/gu, " ");
    if (!title) continue;
    const lessons = sources.get(title) ?? new Set<number>();
    for (const n of row.lessonNumbers) if (Number.isInteger(n) && n >= 1 && n <= 10000) lessons.add(n);
    sources.set(title, lessons);
  }
  return [...sources].map(([sourceBook, values]) => ({ sourceBook, lessonNumbers: [...values].sort((a, b) => a - b) })).sort((a, b) => a.sourceBook.localeCompare(b.sourceBook, "de"));
}
