import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { CorrectionParams, CorrectionQueryDto, CorrectionWordParams, CreateCorrectionDto, ReviewCorrectionDto } from "./corrections.dto";
import { CorrectionsService } from "./corrections.service";
@ApiTags("corrections") @ApiBearerAuth() @UseGuards(AuthGuard) @Controller()
export class CorrectionsController {
 constructor(private readonly service:CorrectionsService) {}
 @Get("corrections/config") @Header("Cache-Control","no-store") config() { return this.service.config(); }
 @Post("words/:wordId/corrections") @Header("Cache-Control","no-store") create(@CurrentUser() u:AuthUser,@Param() p:CorrectionWordParams,@Body() dto:CreateCorrectionDto) { return this.service.create(u,p.wordId,dto); }
 @Get("corrections/mine") @Header("Cache-Control","no-store") mine(@CurrentUser() u:AuthUser,@Query() q:CorrectionQueryDto) { return this.service.list(u,q); }
 @Get("corrections/mine/:id") @Header("Cache-Control","no-store") detailMine(@CurrentUser() u:AuthUser,@Param() p:CorrectionParams) { return this.service.detail(u,p.id); }
 @Get("moderation/corrections") @UseGuards(AdminGuard) @Header("Cache-Control","no-store") all(@CurrentUser() u:AuthUser,@Query() q:CorrectionQueryDto) { return this.service.list(u,q,true); }
 @Get("moderation/corrections/:id") @UseGuards(AdminGuard) @Header("Cache-Control","no-store") detail(@CurrentUser() u:AuthUser,@Param() p:CorrectionParams) { return this.service.detail(u,p.id,true); }
 @Patch("moderation/corrections/:id") @UseGuards(AdminGuard) @Header("Cache-Control","no-store") review(@CurrentUser() u:AuthUser,@Param() p:CorrectionParams,@Body() dto:ReviewCorrectionDto) { return this.service.review(u,p.id,dto); }
}
