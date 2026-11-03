-- Private translations are separate from shared card content and publication.
CREATE TABLE "personal_word_translations" (
  "userId" TEXT NOT NULL,
  "wordId" TEXT NOT NULL,
  "language" VARCHAR(16) NOT NULL,
  "text" VARCHAR(1000) NOT NULL,
  "revision" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_word_translations_pkey" PRIMARY KEY ("userId", "wordId", "language")
);
CREATE INDEX "personal_word_translations_wordId_idx" ON "personal_word_translations"("wordId");
ALTER TABLE "personal_word_translations" ADD CONSTRAINT "personal_word_translations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personal_word_translations" ADD CONSTRAINT "personal_word_translations_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
