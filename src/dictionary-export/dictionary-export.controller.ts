import { Controller, Get, Header, Injectable, Query, Res, StreamableFile, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, Matches } from "class-validator";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.service";
import { DictionaryExportService } from "./dictionary-export.service";
import { CSV_VERSION, templateCsv } from "./dictionary-csv";

export class ExportRequestDto {}
export class HistoryQueryDto {
  @IsIn(["sessions", "answers"]) kind: "sessions" | "answers" = "sessions";
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
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
  config() { return { enabled: true, version: CSV_VERSION, history: true }; }
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
  @Get("history") @UseGuards(DictionaryExportThrottle) @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Header("X-Wortkarten-Export-Version", "1")
  async history(@CurrentUser() user: AuthUser, @Query() query: HistoryQueryDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.exports.history(user, query.kind, { from: query.from, to: query.to });
    response.setHeader("Cache-Control", "private, no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Wortkarten-History-Row-Count", String(result.rowCount));
    response.setHeader("X-Wortkarten-History-Kind", query.kind);
    return new StreamableFile(Buffer.from(result.csv, "utf8"), { type: "text/csv; charset=utf-8", disposition: `attachment; filename="wortkarten-history-${query.kind}-${new Date().toISOString().slice(0, 10)}.csv"` });
  }
  @Get("template") @Header("X-Wortkarten-Export-Version", "1")
  template(@Query() query: TemplateQueryDto, @Res({ passthrough: true }) response: Response) { return this.file(templateCsv(query.variant === "example"), "wortkarten-" + (query.variant === "example" ? "example" : "template"), response); }
}
