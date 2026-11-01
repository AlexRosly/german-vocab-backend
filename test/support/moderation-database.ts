import { makeWordsDatabase } from "./words-database";

// Extend the existing dictionary test store with moderation's detail projection.
// This does not simulate PostgreSQL contention or transaction isolation.
export function makeModerationDatabase() {
  const fixture = makeWordsDatabase();
  const originalUpdate = fixture.db.word.update.getMockImplementation()!;
  type Args = Parameters<typeof originalUpdate>[0];

  function detail(row: Record<string, any> | null, args: Args) {
    if (row && args.include?.examples) {
      row.examples = [...fixture.examples.values()]
        .filter((example) => example.wordId === row.id)
        .map((example) => ({ ...structuredClone(example), translations: [...fixture.exampleTranslations.values()].filter((entry) => entry.exampleId === example.id) }));
    }
    return row;
  }

  fixture.db.word.update.mockImplementation(async (args) => detail(await originalUpdate(args), args));
  const word = Object.assign(fixture.db.word, {
    findUnique: jest.fn(async (args: Args) => detail(await fixture.db.word.findFirst(args), args)),
  });
  const db = Object.assign(fixture.db, { word });
  return { ...fixture, db };
}
