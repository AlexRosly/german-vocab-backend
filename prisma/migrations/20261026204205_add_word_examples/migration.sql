-- CreateTable
CREATE TABLE "word_examples" (
    "id" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "german" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "word_examples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "word_examples_wordId_idx" ON "word_examples"("wordId");

-- AddForeignKey
ALTER TABLE "word_examples" ADD CONSTRAINT "word_examples_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
