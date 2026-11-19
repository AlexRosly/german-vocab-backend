import { BadRequestException } from "@nestjs/common";
import { parseDictionaryCsv } from "./dictionary-csv-reader";
import { parseDictionaryXlsx } from "./dictionary-xlsx-reader";

const isZip = (buffer: Buffer) => buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
export function validateImportUpload(file: { buffer: Buffer; originalname: string } | undefined) {
  if (!file?.buffer?.length) throw new BadRequestException("dictionary_import_empty");
  const excel = /\.xlsx$/i.test(file.originalname);
  if (!/\.(csv|xlsx)$/i.test(file.originalname)) throw new BadRequestException("dictionary_import_supported_files");
  if (excel !== isZip(file.buffer)) throw new BadRequestException(excel ? "dictionary_import_invalid_xlsx" : "dictionary_import_invalid_csv");
  return file.buffer;
}
export async function parseDictionaryFile(buffer: Buffer) {
  return isZip(buffer) ? parseDictionaryXlsx(buffer) : parseDictionaryCsv(buffer);
}
