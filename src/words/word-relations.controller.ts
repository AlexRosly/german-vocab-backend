import { Controller, Delete, Get, Header, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { presentWord } from "../languages/word-presentation";
import { RelationPairParams, RelationWordParams } from "./dto/word-relation.dto";
import { WordRelationsService } from "./word-relations.service";
@ApiTags("word-relations")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("words/:id/relations")
export class WordRelationsController {
  constructor(private readonly relations: WordRelationsService) {}
  @Get() @Header("Cache-Control", "no-store")
  async list(@CurrentUser() user: AuthUser, @Param() params: RelationWordParams) {
    return (await this.relations.list(user, params.id)).map(word => presentWord(word, user.translationLanguage));
  }
  @Put(":relatedId") @Header("Cache-Control", "no-store")
  save(@CurrentUser() user: AuthUser, @Param() params: RelationPairParams) { return this.relations.save(user, params.id, params.relatedId); }
  @Delete(":relatedId") @Header("Cache-Control", "no-store")
  remove(@CurrentUser() user: AuthUser, @Param() params: RelationPairParams) { return this.relations.save(user, params.id, params.relatedId, true); }
}
