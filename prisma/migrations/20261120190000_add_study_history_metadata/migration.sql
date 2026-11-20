-- Additive metadata only. Old sessions and answers keep NULL rather than invented history.
CREATE TYPE "StudyMode" AS ENUM ('forward', 'reverse', 'article', 'plural', 'spelling');
ALTER TABLE "study_sessions" ADD COLUMN "mode" "StudyMode";
ALTER TABLE "study_session_words" ADD COLUMN "nextReviewAt" TIMESTAMP(3);
