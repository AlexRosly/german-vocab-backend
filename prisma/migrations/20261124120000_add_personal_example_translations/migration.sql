-- Private translations only. Existing words, examples, translations and learning data are not rewritten.
CREATE TABLE "personal_example_translations" (
  "userId" TEXT NOT NULL,
  "exampleId" TEXT NOT NULL,
  "language" VARCHAR(16) NOT NULL,
  "text" VARCHAR(1000) NOT NULL,
  "sourceGerman" VARCHAR(1000) NOT NULL,
  "revision" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_example_translations_pkey" PRIMARY KEY ("userId", "exampleId", "language"),
  CONSTRAINT "personal_example_translations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personal_example_translations_exampleId_fkey" FOREIGN KEY ("exampleId") REFERENCES "word_examples"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "personal_example_translations_exampleId_idx" ON "personal_example_translations"("exampleId");
