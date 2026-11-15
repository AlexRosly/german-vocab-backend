import { Controller, Get, Header, Param, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.service";
import { VerbIdDto, VerbQueryDto } from "./dto/verb-query.dto";
import { VerbsService } from "./verbs.service";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { PrismaService } from "../prisma.service";

@ApiTags("verbs") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("verbs")
export class VerbsController {
  constructor(private readonly prisma: PrismaService, private readonly verbs: VerbsService) {}
  @Get("config") @Header("Cache-Control", "no-store")
  async config() {
    const rows = await this.prisma.$queryRaw<{ enabled: boolean }[]>`SELECT to_regclass('public.word_verb_forms') IS NOT NULL AS enabled`;
    return { enabled: rows[0]?.enabled === true, version: 1, catalog: true };
  }
  @Get() @Header("Cache-Control", "no-store")
  list(@CurrentUser() user: AuthUser, @Query() query: VerbQueryDto) { return this.verbs.list(user, query); }

  @Get(":id") @Header("Cache-Control", "no-store")
  detail(@CurrentUser() user: AuthUser, @Param() params: VerbIdDto) { return this.verbs.detail(user, params.id); }
}
