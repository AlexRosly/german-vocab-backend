import { Controller, Get, Header, Query, UseGuards } from "@nestjs/common";
import { Type, Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";
import { WordAuditService } from "./word-audit.service";
class AuditQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Transform(({ value }) => typeof value === "string" ? value.normalize("NFC").trim() : value) @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9._-]{1,191}$/) wordId?: string;
}
@ApiTags("word-audit") @ApiBearerAuth() @Controller("word-audit") @UseGuards(AuthGuard, AdminGuard)
export class WordAuditController {
  constructor(private readonly service: WordAuditService) {}
  @Get("config") @Header("Cache-Control", "no-store") async config() { return { enabled: await this.service.ready() }; }
  @Get() @Header("Cache-Control", "no-store") list(@Query() query: AuditQuery) { return this.service.list(query); }
}
