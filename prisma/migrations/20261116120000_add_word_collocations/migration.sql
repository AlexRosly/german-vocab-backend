CREATE TABLE "word_collocations" (
  "id" TEXT NOT NULL,
  "nounWordId" TEXT NOT NULL,
  "verbWordId" TEXT NOT NULL,
  "german" VARCHAR(500) NOT NULL,
  "phraseKey" VARCHAR(500) NOT NULL,
  "grammarNote" VARCHAR(300),
  "revision" VARCHAR(64) NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "word_collocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "word_collocations_different_words" CHECK ("nounWordId" <> "verbWordId"),
  CONSTRAINT "word_collocations_nonempty" CHECK (length(btrim("german"))>0 AND length(btrim("phraseKey"))>0)
);
CREATE UNIQUE INDEX "word_collocations_nounWordId_verbWordId_phraseKey_key" ON "word_collocations"("nounWordId","verbWordId","phraseKey");
CREATE INDEX "word_collocations_verbWordId_idx" ON "word_collocations"("verbWordId");
ALTER TABLE "word_collocations" ADD CONSTRAINT "word_collocations_nounWordId_fkey" FOREIGN KEY ("nounWordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "word_collocations" ADD CONSTRAINT "word_collocations_verbWordId_fkey" FOREIGN KEY ("verbWordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "word_collocation_translations" (
  "id" TEXT NOT NULL,
  "collocationId" TEXT NOT NULL,
  "language" VARCHAR(12) NOT NULL,
  "text" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "word_collocation_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "word_collocation_translations_nonempty" CHECK (length(btrim("text"))>0)
);
CREATE UNIQUE INDEX "word_collocation_translations_collocationId_language_key" ON "word_collocation_translations"("collocationId","language");
ALTER TABLE "word_collocation_translations" ADD CONSTRAINT "word_collocation_translations_collocationId_fkey" FOREIGN KEY ("collocationId") REFERENCES "word_collocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
