-- Additive private organization only; shared words, examples and learning history stay unchanged.
CREATE TABLE "personal_word_tags" (
  "userId" TEXT NOT NULL, "wordId" TEXT NOT NULL, "titles" TEXT[] NOT NULL,
  "revision" VARCHAR(64) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_word_tags_pkey" PRIMARY KEY ("userId","wordId"),
  CONSTRAINT "personal_word_tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personal_word_tags_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "personal_word_tags_wordId_idx" ON "personal_word_tags"("wordId");
CREATE TABLE "personal_dictionary_settings" (
  "userId" TEXT NOT NULL, "lessonNames" JSONB NOT NULL DEFAULT '[]'::jsonb, "neutralColor" VARCHAR(7),
  "revision" VARCHAR(64) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_dictionary_settings_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "personal_dictionary_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
