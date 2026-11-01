-- Add a separate private store. Do not copy or modify shared Word.notes.
CREATE TABLE "personal_word_notes" (
  "userId" TEXT NOT NULL,
  "wordId" TEXT NOT NULL,
  "text" VARCHAR(2000) NOT NULL,
  "revision" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_word_notes_pkey" PRIMARY KEY ("userId", "wordId")
);
CREATE INDEX "personal_word_notes_wordId_idx" ON "personal_word_notes"("wordId");
ALTER TABLE "personal_word_notes" ADD CONSTRAINT "personal_word_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personal_word_notes" ADD CONSTRAINT "personal_word_notes_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
