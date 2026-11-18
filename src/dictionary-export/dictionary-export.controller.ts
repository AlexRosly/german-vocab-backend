import { Controller, Get, Header, Injectable, Query, Res, StreamableFile, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.service";
import { DictionaryExportService } from "./dictionary-export.service";
import { CSV_VERSION, templateCsv } from "./dictionary-csv";

export class ExportRequestDto {}
export class TemplateQueryDto { @IsIn(["blank", "example"]) variant: "blank" | "example" = "blank"; }
// Authentication runs first: exports are throttled per account, not Netlify's shared proxy IP.
@Injectable()
export class DictionaryExportThrottle extends ThrottlerGuard {
  protected async getTracker(request: AuthenticatedRequest): Promise<string> { return request.auth!.user.id; }
}
@ApiTags("dictionary-export") @ApiBearerAuth()
@Controller("dictionary-export") @UseGuards(AuthGuard)
export class DictionaryExportController {
  constructor(private readonly exports: DictionaryExportService) {}
  @Get("config") @Header("Cache-Control", "private, no-store")
  config() { return { enabled: true, version: CSV_VERSION }; }
  private file(data: { csv: string; wordCount: number }, filename: string, response: Response) {
    response.setHeader("Cache-Control", "private, no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Wortkarten-Word-Count", String(data.wordCount));
    const file = new StreamableFile(Buffer.from(data.csv, "utf8"), { type: "text/csv; charset=utf-8", disposition: `attachment; filename="${filename}.csv"` });
    return file;
  }
  @Get("csv") @UseGuards(DictionaryExportThrottle) @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Header("X-Wortkarten-Export-Version", "1")
  async csv(@CurrentUser() user: AuthUser, @Query() _query: ExportRequestDto, @Res({ passthrough: true }) response: Response) {
    return this.file(await this.exports.export(user), "wortkarten-dictionary-" + new Date().toISOString().slice(0, 10), response);
  }
  @Get("template") @Header("X-Wortkarten-Export-Version", "1")
  template(@Query() query: TemplateQueryDto, @Res({ passthrough: true }) response: Response) { return this.file(templateCsv(query.variant === "example"), "wortkarten-" + (query.variant === "example" ? "example" : "template"), response); }
}
