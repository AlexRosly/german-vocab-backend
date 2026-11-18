BEGIN;
ALTER TABLE "personal_word_books" ADD COLUMN "lessons" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "dictionary_import_batches" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "key" UUID NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "rows" JSONB NOT NULL,
  "decisions" JSONB NOT NULL,
  "summary" JSONB NOT NULL,
  "cursor" INTEGER NOT NULL DEFAULT 0,
  "results" JSONB NOT NULL DEFAULT '[]',
  "state" VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dictionary_import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dictionary_import_batches_state_check" CHECK ("state" IN ('PLANNED','IMPORTING','COMPLETED','EXPIRED')),
  CONSTRAINT "dictionary_import_batches_cursor_check" CHECK ("cursor" >= 0),
  CONSTRAINT "dictionary_import_batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "dictionary_import_batches_userId_key_key" ON "dictionary_import_batches"("userId","key");
CREATE INDEX "dictionary_import_batches_userId_createdAt_idx" ON "dictionary_import_batches"("userId","createdAt");
CREATE INDEX "dictionary_import_batches_state_expiresAt_idx" ON "dictionary_import_batches"("state","expiresAt");
CREATE TABLE "word_lexeme_guards" (
  "key" VARCHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "word_lexeme_guards_pkey" PRIMARY KEY ("key")
);
COMMIT;
