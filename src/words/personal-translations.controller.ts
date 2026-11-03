import { Body, Controller, Get, Header, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { PersonalTranslationParams, SavePersonalTranslationDto } from "./dto/personal-translation.dto";
import { PersonalTranslationsService } from "./personal-translations.service";
@ApiTags("personal-translations") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("words/:id/personal-translations/:language")
export class PersonalTranslationsController {
  constructor(private readonly translations: PersonalTranslationsService) {}
  @Get() @Header("Cache-Control", "no-store")
  get(@CurrentUser() user: AuthUser, @Param() params: PersonalTranslationParams) { return this.translations.get(user.id, params.id, params.language); }
  @Put() @Header("Cache-Control", "no-store")
  save(@CurrentUser() user: AuthUser, @Param() params: PersonalTranslationParams, @Body() dto: SavePersonalTranslationDto) { return this.translations.save(user.id, params.id, params.language, dto); }
}
