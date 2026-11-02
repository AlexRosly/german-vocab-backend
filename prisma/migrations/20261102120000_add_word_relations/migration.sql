-- Add related expressions without rewriting existing cards or progress.
CREATE TABLE "word_relations" (
  "leftWordId" TEXT NOT NULL,
  "rightWordId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "word_relations_pkey" PRIMARY KEY ("leftWordId", "rightWordId"),
  CONSTRAINT "word_relations_canonical_pair" CHECK ("leftWordId" COLLATE "C" < "rightWordId" COLLATE "C")
);
CREATE INDEX "word_relations_rightWordId_idx" ON "word_relations"("rightWordId");
ALTER TABLE "word_relations" ADD CONSTRAINT "word_relations_leftWordId_fkey" FOREIGN KEY ("leftWordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "word_relations" ADD CONSTRAINT "word_relations_rightWordId_fkey" FOREIGN KEY ("rightWordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
