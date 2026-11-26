import { Body, Controller, Delete, Get, Header, HttpCode, Param, Put, Query, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { IsUUID, ValidateIf } from "class-validator";
import { Transform } from "class-transformer";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { DictionaryExportThrottle } from "../dictionary-export/dictionary-export.controller";
import { IMAGE_UPLOAD_LIMIT, ImageFile } from "./word-image-store";
import { WordImagesService } from "./word-images.service";

class RevisionDto {
  @Transform(({ value }) => value === "" ? null : value)
  @ValidateIf((_o, value) => value !== null) @IsUUID("4") revision!: string | null;
}
class ContentDto { @IsUUID("4") revision!: string; }
@ApiTags("word-images") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("word-images")
export class WordImagesConfigController {
  constructor(private readonly images: WordImagesService) {}
  @Get("config") @Header("Cache-Control", "private, no-store") config() { return this.images.config(); }
}
@ApiTags("word-images") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("words/:wordId/image")
export class WordImagesController {
  constructor(private readonly images: WordImagesService) {}
  @Get() @Header("Cache-Control", "private, no-store")
  get(@CurrentUser() user: AuthUser, @Param("wordId") id: string) { return this.images.get(user, id); }
  @Get("content")
  @Header("Cache-Control", "private, no-store") @Header("X-Content-Type-Options", "nosniff")
  async content(@CurrentUser() user: AuthUser, @Param("wordId") id: string, @Query() query: ContentDto, @Res({ passthrough: true }) response: Response) {
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    return new StreamableFile(await this.images.content(user, id, query.revision), { type: "image/webp", disposition: 'inline; filename="word.webp"' });
  }
  @Put() @HttpCode(200) @Header("Cache-Control", "private, no-store")
  @UseGuards(DictionaryExportThrottle) @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: IMAGE_UPLOAD_LIMIT, files: 1, fields: 1, fieldSize: 80, parts: 2 } }))
  save(@CurrentUser() user: AuthUser, @Param("wordId") id: string, @Body() dto: RevisionDto, @UploadedFile() file: ImageFile) { return this.images.save(user, id, dto.revision, file); }
  @Delete() @Header("Cache-Control", "private, no-store")
  remove(@CurrentUser() user: AuthUser, @Param("wordId") id: string, @Body() dto: RevisionDto) { return this.images.remove(user, id, dto.revision); }
}
