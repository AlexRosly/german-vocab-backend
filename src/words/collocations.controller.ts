import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { CollocationsService } from "./collocations.service";
import { CollocationParams, CollocationQueryDto, CollocationWordParams, CreateCollocationDto, DeleteCollocationDto, UpdateCollocationDto } from "./dto/collocation.dto";
@ApiTags("collocations") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("collocations")
export class CollocationsConfigController {
  constructor(private readonly collocations:CollocationsService){}
  @Get("config") @Header("Cache-Control","no-store")
  config(){return this.collocations.config();}
}
@ApiTags("collocations") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("words/:id/collocations")
export class CollocationsController {
  constructor(private readonly collocations:CollocationsService){}
  @Get() @Header("Cache-Control","no-store")
  list(@CurrentUser() user:AuthUser,@Param() params:CollocationWordParams,@Query() query:CollocationQueryDto){return this.collocations.list(user,params.id,query.page);}
  @Get(":collocationId") @Header("Cache-Control","no-store")
  detail(@CurrentUser() user:AuthUser,@Param() params:CollocationParams){return this.collocations.detail(user,params.id,params.collocationId);}
  @Post() @Header("Cache-Control","no-store")
  create(@CurrentUser() user:AuthUser,@Param() params:CollocationWordParams,@Body() dto:CreateCollocationDto){return this.collocations.create(user,params.id,dto);}
  @Patch(":collocationId") @Header("Cache-Control","no-store")
  update(@CurrentUser() user:AuthUser,@Param() params:CollocationParams,@Body() dto:UpdateCollocationDto){return this.collocations.update(user,params.id,params.collocationId,dto);}
  @Delete(":collocationId") @Header("Cache-Control","no-store")
  remove(@CurrentUser() user:AuthUser,@Param() params:CollocationParams,@Body() dto:DeleteCollocationDto){return this.collocations.remove(user,params.id,params.collocationId,dto.revision);}
}
