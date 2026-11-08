-- Additive only: source books are assigned separately after reviewing exact word IDs.
BEGIN;
ALTER TABLE "words" ADD COLUMN "sourceBook" VARCHAR(120);
CREATE TABLE "personal_word_books" (
  "userId" TEXT NOT NULL,
  "wordId" TEXT NOT NULL,
  "titles" TEXT[],
  "revision" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_word_books_pkey" PRIMARY KEY ("userId", "wordId"),
  CONSTRAINT "personal_word_books_titles_count" CHECK ("titles" IS NOT NULL AND cardinality("titles") BETWEEN 1 AND 20),
  CONSTRAINT "personal_word_books_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personal_word_books_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "personal_word_books_wordId_idx" ON "personal_word_books"("wordId");
COMMIT;
