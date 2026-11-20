-- Personal marker only; no shared words or learning history are rewritten.
ALTER TABLE "user_words" ADD COLUMN "isDifficult" BOOLEAN NOT NULL DEFAULT false;
