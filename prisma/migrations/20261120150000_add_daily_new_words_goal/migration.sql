-- Personal daily plan; existing goals, words and learning history stay unchanged.
ALTER TABLE "users" ADD COLUMN "newWordsDailyGoal" INTEGER NOT NULL DEFAULT 10;
