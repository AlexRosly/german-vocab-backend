import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
export async function importSchemaReady(db: Reader): Promise<boolean> {
  const result = await db.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public.dictionary_import_batches') IS NOT NULL AND to_regclass('public.word_lexeme_guards') IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='personal_word_books' AND column_name='lessons') AS ready`;
  return result[0]?.ready === true;
}
export async function guardWordSpellings(tx: Prisma.TransactionClient, spellings: string[]) {
  if (!await importSchemaReady(tx)) return;
  const keys = [...new Set(spellings.map(s => createHash("sha256").update(s.normalize("NFC").trim().replace(/\s+/gu," ").replace(/^(der|die|das) /iu,'').toLocaleLowerCase("de")).digest("hex")))].sort();
  for (const key of keys) await tx.$executeRaw`INSERT INTO word_lexeme_guards(key,revision) VALUES (${key},1) ON CONFLICT(key) DO UPDATE SET revision=word_lexeme_guards.revision+1`;
}
export function transactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (["P2034","P2002"].includes(error.code) || (error.code === "P2010" && ["40001","40P01"].includes(String(error.meta?.code))));
}
