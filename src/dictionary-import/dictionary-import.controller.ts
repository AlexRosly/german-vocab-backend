import { validateImportUpload } from "./dictionary-file-reader";
import { BadRequestException, Body, Controller, Get, Header, HttpCode, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.service";
import { DictionaryExportThrottle, ExportRequestDto } from "../dictionary-export/dictionary-export.controller";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "./dictionary-csv-reader";
import { DictionaryImportService } from "./dictionary-import.service";

@Controller("dictionary-import") @UseGuards(AuthGuard)
export class DictionaryImportController {
  constructor(private readonly imports: DictionaryImportService) {}
  @Get("config") @Header("Cache-Control", "private, no-store") config() { return { enabled: true, version: 1, readOnly: true, formats: ["csv", "xlsx"], maxBytes: MAX_IMPORT_BYTES, maxRows: MAX_IMPORT_ROWS }; }
  @Post("preview") @HttpCode(200) @Header("Cache-Control", "private, no-store") @UseGuards(DictionaryExportThrottle) @Throttle({ default: { limit: 3, ttl: 60000 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 0, parts: 1 },
    fileFilter: (_request, file, callback) => callback(/\.(csv|xlsx)$/i.test(file.originalname) ? null : new BadRequestException("dictionary_import_supported_files"), /\.(csv|xlsx)$/i.test(file.originalname)) }))
  preview(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Body() _body: ExportRequestDto, @Query() _query: ExportRequestDto) {
    return this.imports.preview(user, validateImportUpload(file));
  }
}
