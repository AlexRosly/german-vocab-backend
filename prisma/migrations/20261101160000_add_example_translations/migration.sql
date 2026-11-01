-- Additive migration. Keep legacy Russian fields and every existing example.
CREATE TABLE "word_example_translations" (
    "id" TEXT NOT NULL,
    "exampleId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "word_example_translations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "word_example_translations_exampleId_language_key" ON "word_example_translations"("exampleId", "language");
CREATE INDEX "word_example_translations_language_idx" ON "word_example_translations"("language");
ALTER TABLE "word_example_translations" ADD CONSTRAINT "word_example_translations_exampleId_fkey" FOREIGN KEY ("exampleId") REFERENCES "word_examples"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "word_example_translations" ("id", "exampleId", "language", "text", "createdAt", "updatedAt")
SELECT 'legacy-ru-' || "id", "id", 'ru', "translation", "createdAt", "updatedAt"
FROM "word_examples" WHERE btrim("translation") <> '';
