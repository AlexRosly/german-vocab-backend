import { Body, Controller, Get, Header, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { UpsertWordTranslationDto } from "./dto/upsert-word-translation.dto";
import { WordTranslationParamsDto } from "./dto/word-translation-params.dto";
import { WordTranslationsService } from "./word-translations.service";

@ApiTags("word-translations")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("words/:wordId/translations")
export class WordTranslationsController {
  constructor(private readonly translations: WordTranslationsService) {}

  @Get(":language")
  @Header("Cache-Control", "no-store")
  get(@CurrentUser() user: AuthUser, @Param() params: WordTranslationParamsDto) {
    return this.translations.get(user, params.wordId, params.language);
  }

  @Put(":language")
  @Header("Cache-Control", "no-store")
  set(@CurrentUser() user: AuthUser, @Param() params: WordTranslationParamsDto, @Body() dto: UpsertWordTranslationDto) {
    return this.translations.set(user, params.wordId, params.language, dto);
  }
}
