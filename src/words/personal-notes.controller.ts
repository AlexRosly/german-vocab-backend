import { Body, Controller, Get, Header, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { PersonalNoteWordIdDto, SavePersonalNoteDto } from "./dto/personal-note.dto";
import { PersonalNotesService } from "./personal-notes.service";
@ApiTags("personal-notes")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("words/:id/personal-note")
export class PersonalNotesController {
  constructor(private readonly notes: PersonalNotesService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  get(@CurrentUser() user: AuthUser, @Param() params: PersonalNoteWordIdDto) { return this.notes.get(user.id, params.id); }
  @Put()
  @Header("Cache-Control", "no-store")
  save(@CurrentUser() user: AuthUser, @Param() params: PersonalNoteWordIdDto, @Body() dto: SavePersonalNoteDto) { return this.notes.save(user.id, params.id, dto); }
}
