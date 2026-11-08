import { Body, Controller, Get, Header, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { PersonalNoteWordIdDto } from "./dto/personal-note.dto";
import { SavePersonalBooksDto } from "./dto/personal-books.dto";
import { PersonalBooksService } from "./personal-books.service";
@ApiTags("personal-books")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("words/:id/personal-books")
export class PersonalBooksController {
  constructor(private readonly notes: PersonalBooksService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  get(@CurrentUser() user: AuthUser, @Param() params: PersonalNoteWordIdDto) { return this.notes.get(user.id, params.id); }
  @Put()
  @Header("Cache-Control", "no-store")
  save(@CurrentUser() user: AuthUser, @Param() params: PersonalNoteWordIdDto, @Body() dto: SavePersonalBooksDto) { return this.notes.save(user.id, params.id, dto); }
}
