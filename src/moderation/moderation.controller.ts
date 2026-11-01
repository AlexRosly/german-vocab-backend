import { Body, Controller, Get, Header, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { ChangePublicationStatusDto } from "./dto/change-publication-status.dto";
import { ModerationQueryDto } from "./dto/moderation-query.dto";
import { ModerationService } from "./moderation.service";

@ApiTags("moderation")
@ApiBearerAuth()
@UseGuards(AuthGuard, AdminGuard)
@Controller("moderation/words")
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Получить слова на проверку или с выбранным статусом" })
  findAll(@CurrentUser() user: AuthUser, @Query() query: ModerationQueryDto) {
    return this.moderationService.findAll(user, query.status);
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Просмотреть карточку, переводы, примеры и ревизию для решения" })
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.moderationService.findOne(user, id);
  }

  @Patch(":id/status")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Одобрить, отклонить или вернуть карточку на проверку" })
  changeStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: ChangePublicationStatusDto) {
    return this.moderationService.changeStatus(user, id, dto);
  }
}
