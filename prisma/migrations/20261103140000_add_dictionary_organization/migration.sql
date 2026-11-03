-- Defaults keep old clients' dictionary inserts compatible during rollout.
BEGIN;
ALTER TABLE "user_words"
  ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revision" VARCHAR(64) NOT NULL DEFAULT (gen_random_uuid())::text;
CREATE INDEX "user_words_userId_isArchived_idx" ON "user_words"("userId", "isArchived");
COMMIT;
