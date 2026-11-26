BEGIN;
CREATE TABLE "word_images" (
  "wordId" TEXT NOT NULL PRIMARY KEY,
  "storageKey" VARCHAR(64) NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "bytes" INTEGER NOT NULL CHECK ("bytes" > 0 AND "bytes" <= 98304),
  "width" INTEGER NOT NULL CHECK ("width" > 0 AND "width" <= 720),
  "height" INTEGER NOT NULL CHECK ("height" > 0 AND "height" <= 720),
  "revision" VARCHAR(36) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "word_images_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "word_images_storageKey_key" UNIQUE ("storageKey"),
  CONSTRAINT "word_images_revision_key" UNIQUE ("revision")
);
CREATE TRIGGER wk_audit_word_images AFTER INSERT OR UPDATE OR DELETE ON public.word_images FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();
COMMIT;
