import { Body, Controller, Get, Header, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { PersonalExampleTranslationParams, SavePersonalExampleTranslationDto } from "./dto/personal-example-translation.dto";
import { PersonalExampleTranslationsService } from "./personal-example-translations.service";
@ApiTags("personal-example-translations") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("words/:id/examples/:exampleId/personal-translations/:language")
export class PersonalExampleTranslationsController {
  constructor(private readonly translations: PersonalExampleTranslationsService) {}
  @Get() @Header("Cache-Control", "no-store")
  get(@CurrentUser() user: AuthUser, @Param() p: PersonalExampleTranslationParams) { return this.translations.get(user.id, p.id, p.exampleId, p.language); }
  @Put() @Header("Cache-Control", "no-store")
  save(@CurrentUser() user: AuthUser, @Param() p: PersonalExampleTranslationParams, @Body() dto: SavePersonalExampleTranslationDto) { return this.translations.save(user.id, p.id, p.exampleId, p.language, dto); }
}
