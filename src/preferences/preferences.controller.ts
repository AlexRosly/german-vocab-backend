import { Body, Controller, Get, Header, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { PreferencesService } from "./preferences.service";

@ApiTags("preferences")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("users/me/preferences")
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  get(@CurrentUser() user: AuthUser) {
    return this.preferencesService.get(user.id);
  }

  @Patch()
  @Header("Cache-Control", "no-store")
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.preferencesService.update(user.id, dto);
  }
}
