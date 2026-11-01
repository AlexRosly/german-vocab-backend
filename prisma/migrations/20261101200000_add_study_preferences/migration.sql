-- Additive defaults preserve all accounts, cards, sessions and progress.
ALTER TABLE "users"
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "dailyGoal" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "users" ADD CONSTRAINT "users_dailyGoal_range" CHECK ("dailyGoal" BETWEEN 1 AND 500);
