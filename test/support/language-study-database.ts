import { makeStudyDatabase } from "./study-database";

export function makeLanguageStudyDatabase() {
  const fixture = makeStudyDatabase();
  function decorate(value: any): any {
    if (value === null || typeof value !== "object" || value instanceof Date) return value;
    if (Array.isArray(value)) { value.forEach(decorate); return value; }
    Object.values(value).forEach(decorate);
    if (Array.isArray(value.translations)) {
      value.translations.push(
        { id: `en-${value.id}`, wordId: value.id, language: "en", text: "tree" },
        { id: `de-${value.id}`, wordId: value.id, language: "de", text: "Baum" },
      );
    }
    return value;
  }
  const findWords = fixture.db.word.findMany.getMockImplementation()!;
  const findProgress = fixture.db.wordProgress.findMany.getMockImplementation()!;
  const findSessions = fixture.db.studySession.findMany.getMockImplementation()!;
  const findSession = fixture.db.studySession.findFirst.getMockImplementation()!;
  fixture.db.word.findMany.mockImplementation(async (args) => decorate(await findWords(args)));
  fixture.db.wordProgress.findMany.mockImplementation(async (args) => decorate(await findProgress(args)));
  fixture.db.studySession.findMany.mockImplementation(async (args) => decorate(await findSessions(args)));
  fixture.db.studySession.findFirst.mockImplementation(async (args) => decorate(await findSession(args)));
  return fixture;
}
