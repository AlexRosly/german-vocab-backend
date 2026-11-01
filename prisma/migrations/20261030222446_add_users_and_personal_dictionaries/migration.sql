/*
  Warnings:

  - A unique constraint covering the columns `[userId,wordId]` on the table `word_progress` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `study_sessions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `word_progress` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "WordPublicationStatus" AS ENUM ('PENDING_REVIEW', 'PUBLISHED', 'REJECTED');

-- DropIndex
DROP INDEX "study_sessions_startedAt_idx";

-- DropIndex
DROP INDEX "word_progress_nextReviewAt_idx";

-- DropIndex
DROP INDEX "word_progress_wordId_key";

-- Add nullable userId columns first
ALTER TABLE "study_sessions"
ADD COLUMN "userId" TEXT;

ALTER TABLE "word_progress"
ADD COLUMN "userId" TEXT;

-- AlterTable
ALTER TABLE "words" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "publicationStatus" "WordPublicationStatus" NOT NULL DEFAULT 'PUBLISHED';

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "interfaceLanguage" TEXT NOT NULL DEFAULT 'ru',
    "translationLanguage" TEXT NOT NULL DEFAULT 'ru',
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_words" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_translations" (
    "id" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "word_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "user_words_wordId_idx" ON "user_words"("wordId");

-- CreateIndex
CREATE UNIQUE INDEX "user_words_userId_wordId_key" ON "user_words"("userId", "wordId");

-- CreateIndex
CREATE INDEX "word_translations_language_idx" ON "word_translations"("language");

-- CreateIndex
CREATE UNIQUE INDEX "word_translations_wordId_language_key" ON "word_translations"("wordId", "language");

-- CreateIndex
CREATE INDEX "study_sessions_userId_startedAt_idx" ON "study_sessions"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "word_progress_userId_nextReviewAt_idx" ON "word_progress"("userId", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "word_progress_userId_wordId_key" ON "word_progress"("userId", "wordId");

-- CreateIndex
CREATE INDEX "words_publicationStatus_idx" ON "words"("publicationStatus");

-- CreateIndex
CREATE INDEX "words_createdByUserId_idx" ON "words"("createdByUserId");

-- Create initial legacy owner
INSERT INTO "users" (
    "id",
    "email",
    "interfaceLanguage",
    "translationLanguage",
    "role",
    "createdAt",
    "updatedAt"
)
VALUES (
    'legacy-owner',
    NULL,
    'ru',
    'ru',
    'ADMIN',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Assign existing study sessions to legacy owner
UPDATE "study_sessions"
SET "userId" = 'legacy-owner';

-- Assign existing progress to legacy owner
UPDATE "word_progress"
SET "userId" = 'legacy-owner';

-- Add all existing words to legacy owner's dictionary
INSERT INTO "user_words" (
    "id",
    "userId",
    "wordId",
    "createdAt"
)
SELECT
    'legacy-user-word-' || w."id",
    'legacy-owner',
    w."id",
    CURRENT_TIMESTAMP
FROM "words" w
ON CONFLICT ("userId", "wordId") DO NOTHING;

-- Migrate existing Russian translations
INSERT INTO "word_translations" (
    "id",
    "wordId",
    "language",
    "text",
    "createdAt",
    "updatedAt"
)
SELECT
    'legacy-translation-' || w."id",
    w."id",
    'ru',
    w."translation",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "words" w
ON CONFLICT ("wordId", "language") DO NOTHING;

-- Make userId required after backfill
ALTER TABLE "study_sessions"
ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "word_progress"
ALTER COLUMN "userId" SET NOT NULL;


-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "words" ADD CONSTRAINT "words_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_words" ADD CONSTRAINT "user_words_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_words" ADD CONSTRAINT "user_words_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_translations" ADD CONSTRAINT "word_translations_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_progress" ADD CONSTRAINT "word_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
