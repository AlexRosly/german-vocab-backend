-- CreateEnum
CREATE TYPE "Article" AS ENUM ('der', 'das', 'die', 'none');

-- CreateEnum
CREATE TYPE "GrammaticalNumber" AS ENUM ('singular', 'plural', 'not_applicable');

-- CreateEnum
CREATE TYPE "CefrLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- CreateTable
CREATE TABLE "words" (
    "id" TEXT NOT NULL,
    "german" TEXT NOT NULL,
    "article" "Article" NOT NULL DEFAULT 'none',
    "grammaticalNumber" "GrammaticalNumber" NOT NULL DEFAULT 'not_applicable',
    "translation" TEXT NOT NULL,
    "pluralForm" TEXT,
    "level" "CefrLevel",
    "lessonNumber" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "words_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "words_german_idx" ON "words"("german");

-- CreateIndex
CREATE INDEX "words_lessonNumber_level_idx" ON "words"("lessonNumber", "level");
