CREATE TYPE "VerbAuxiliary" AS ENUM ('HABEN', 'SEIN');

CREATE TABLE "word_verb_forms" (
  "id" TEXT NOT NULL,
  "wordId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "praeteritum" VARCHAR(200) NOT NULL,
  "participle2" VARCHAR(200) NOT NULL,
  "auxiliary" "VerbAuxiliary" NOT NULL,
  "reflexive" BOOLEAN NOT NULL DEFAULT false,
  "usage" VARCHAR(300),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "word_verb_forms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "word_verb_forms_position_check" CHECK ("position" BETWEEN 0 AND 3),
  CONSTRAINT "word_verb_forms_text_check" CHECK (length(btrim("praeteritum")) > 0 AND length(btrim("participle2")) > 0)
);
CREATE UNIQUE INDEX "word_verb_forms_wordId_position_key" ON "word_verb_forms"("wordId", "position");
ALTER TABLE "word_verb_forms" ADD CONSTRAINT "word_verb_forms_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
