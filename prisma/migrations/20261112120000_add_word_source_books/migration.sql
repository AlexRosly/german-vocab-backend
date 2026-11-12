BEGIN;
-- Shared, additive book/lesson provenance. Private book titles are not copied.
CREATE TABLE "word_source_books" (
    "wordId" TEXT NOT NULL,
    "sourceBook" VARCHAR(120) NOT NULL,
    "lessonNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "word_source_books_pkey" PRIMARY KEY ("wordId", "sourceBook"),
    CONSTRAINT "word_source_books_title_check" CHECK (char_length(btrim("sourceBook")) BETWEEN 1 AND 120 AND "sourceBook" = btrim("sourceBook")),
    CONSTRAINT "word_source_books_lessons_check" CHECK (array_position("lessonNumbers", NULL) IS NULL AND 0 < ALL("lessonNumbers")),
    CONSTRAINT "word_source_books_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "word_source_books_sourceBook_idx" ON "word_source_books"("sourceBook");
INSERT INTO "word_source_books" ("wordId", "sourceBook", "lessonNumbers", "createdAt", "updatedAt")
SELECT "id", btrim("sourceBook"),
       CASE WHEN "lessonNumber" IS NULL THEN ARRAY[]::INTEGER[] ELSE ARRAY["lessonNumber"] END,
       "createdAt", "updatedAt"
FROM "words"
WHERE "sourceBook" IS NOT NULL AND char_length(btrim("sourceBook")) > 0;

COMMIT;
