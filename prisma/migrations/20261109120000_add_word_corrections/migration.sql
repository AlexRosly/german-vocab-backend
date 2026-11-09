-- Additive only: no existing rows are changed or deleted.
BEGIN;
CREATE TYPE "CorrectionStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');
CREATE TYPE "CorrectionCategory" AS ENUM ('WORD', 'TRANSLATION', 'EXAMPLE', 'RELATION', 'OTHER');
CREATE TABLE "word_corrections" (
 "id" TEXT NOT NULL,
 "wordId" TEXT NOT NULL,
 "reporterId" TEXT NOT NULL,
 "category" "CorrectionCategory" NOT NULL,
 "description" VARCHAR(2000) NOT NULL,
 "suggestion" VARCHAR(2000),
 "snapshot" JSONB NOT NULL,
 "status" "CorrectionStatus" NOT NULL DEFAULT 'OPEN',
 "revision" VARCHAR(64) NOT NULL,
 "reviewerId" TEXT,
 "reviewComment" VARCHAR(1000),
 "reviewedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "word_corrections_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "word_corrections_description_check" CHECK (char_length(btrim("description")) BETWEEN 10 AND 2000),
 CONSTRAINT "word_corrections_review_check" CHECK (
   ("status" = 'OPEN' AND "reviewerId" IS NULL AND "reviewedAt" IS NULL AND "reviewComment" IS NULL)
   OR ("status" <> 'OPEN' AND "reviewedAt" IS NOT NULL AND "reviewComment" IS NOT NULL AND char_length(btrim("reviewComment")) BETWEEN 3 AND 1000)
 )
);
CREATE INDEX "word_corrections_status_createdAt_id_idx" ON "word_corrections"("status", "createdAt", "id");
CREATE INDEX "word_corrections_reporterId_status_createdAt_idx" ON "word_corrections"("reporterId", "status", "createdAt");
CREATE INDEX "word_corrections_wordId_idx" ON "word_corrections"("wordId");
-- Prisma cannot express this partial uniqueness: one open report per person/card.
CREATE UNIQUE INDEX "word_corrections_one_open_per_reporter" ON "word_corrections"("reporterId", "wordId") WHERE "status" = 'OPEN';
ALTER TABLE "word_corrections" ADD CONSTRAINT "word_corrections_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "word_corrections" ADD CONSTRAINT "word_corrections_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "word_corrections" ADD CONSTRAINT "word_corrections_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
