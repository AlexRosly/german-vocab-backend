import { Body, Controller, Get, Header, Param, Patch, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { PersonalNoteWordIdDto } from "./dto/personal-note.dto";
import { SaveOrganizationColorDto, SaveWordOrganizationDto } from "./dto/word-organization.dto";
import { WordOrganizationService } from "./word-organization.service";
@ApiTags("dictionary-organization") @ApiBearerAuth() @UseGuards(AuthGuard) @Controller()
export class WordOrganizationController {
  constructor(private readonly service:WordOrganizationService){}
  @Get("words/:id/organization") @Header("Cache-Control","no-store")
  get(@CurrentUser() user:AuthUser,@Param() p:PersonalNoteWordIdDto){return this.service.get(user.id,p.id)}
  @Put("words/:id/organization") @Header("Cache-Control","no-store")
  save(@CurrentUser() user:AuthUser,@Param() p:PersonalNoteWordIdDto,@Body() dto:SaveWordOrganizationDto){return this.service.save(user.id,p.id,dto)}
  @Get("dictionary-organization/settings") @Header("Cache-Control","no-store")
  settings(@CurrentUser() user:AuthUser){return this.service.settings(user.id)}
  @Patch("dictionary-organization/settings") @Header("Cache-Control","no-store")
  color(@CurrentUser() user:AuthUser,@Body() dto:SaveOrganizationColorDto){return this.service.color(user.id,dto)}
}
