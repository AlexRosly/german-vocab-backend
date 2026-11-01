-- AlterTable
ALTER TABLE "word_progress" ADD COLUMN     "consecutiveKnown" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentIntervalDays" INTEGER NOT NULL DEFAULT 0;
