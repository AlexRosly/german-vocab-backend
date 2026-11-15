import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { PrismaService } from "../prisma.service";

@ApiTags("verbs") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("verbs")
export class VerbsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get("config") @Header("Cache-Control", "no-store")
  async config() {
    const rows = await this.prisma.$queryRaw<{ enabled: boolean }[]>`SELECT to_regclass('public.word_verb_forms') IS NOT NULL AS enabled`;
    return { enabled: rows[0]?.enabled === true, version: 1 };
  }
}
