import { BadRequestException, Body, Controller, Get, Header, Headers, HttpCode, Param, Post, UploadedFile, UseGuards, UseInterceptors, Res } from "@nestjs/common";
import type {Response} from 'express';
import { FileInterceptor } from "@nestjs/platform-express";
import { IsInt, IsString, Max, MaxLength, Min } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.service";
import { DictionaryExportThrottle } from "../dictionary-export/dictionary-export.controller";
import { MAX_IMPORT_BYTES } from "./dictionary-csv-reader";
import { DictionaryImportApplyService } from "./dictionary-import-apply.service";
class PrepareDto { @IsString() @MaxLength(2*1024*1024) decisions!:string; }
class ApplyDto { @IsInt() @Min(0) @Max(10000) cursor!:number; }
class EmptyDto {}
@Controller("dictionary-import") @UseGuards(AuthGuard)
export class DictionaryImportSaveController {
  constructor(private readonly imports:DictionaryImportApplyService){}
  @Get("save-config") @Header("Cache-Control","private, no-store")
  async config(){return{enabled:await this.imports.ready(),version:1,chunkSize:25};}
  @Get("latest-batch") @Header("Cache-Control","private, no-store")
  async latest(@CurrentUser()user:AuthUser,@Res({passthrough:true})response:Response){const batch=await this.imports.latest(user);if(!batch){response.status(204);return;}return batch;}
  @Post("prepare") @HttpCode(200) @Header("Cache-Control","private, no-store") @UseGuards(DictionaryExportThrottle) @Throttle({default:{limit:3,ttl:60000}})
  @UseInterceptors(FileInterceptor("file",{limits:{fileSize:MAX_IMPORT_BYTES,files:1,fields:1,fieldSize:2*1024*1024,parts:2},fileFilter:(_r,f,cb)=>cb(/\.csv$/i.test(f.originalname)?null:new BadRequestException("dictionary_import_csv_only"),/\.csv$/i.test(f.originalname))}))
  prepare(@CurrentUser()user:AuthUser,@UploadedFile()file:{buffer:Buffer}|undefined,@Body()body:PrepareDto,@Headers("idempotency-key")key:string){if(!file?.buffer?.length)throw new BadRequestException("dictionary_import_empty");return this.imports.prepare(user,file.buffer,body.decisions,key);}
  @Get("batches/:key") @Header("Cache-Control","private, no-store")
  get(@CurrentUser()user:AuthUser,@Param("key")key:string){return this.imports.get(user,key);}
  @Post("batches/:key/apply") @HttpCode(200) @Header("Cache-Control","private, no-store") @UseGuards(DictionaryExportThrottle) @Throttle({default:{limit:120,ttl:60000}})
  apply(@CurrentUser()user:AuthUser,@Param("key")key:string,@Body()body:ApplyDto){return this.imports.apply(user,key,body.cursor);}
  @Post("batches/:key/discard") @HttpCode(200) @Header("Cache-Control","private, no-store")
  discard(@CurrentUser()user:AuthUser,@Param("key")key:string,@Body()_body:EmptyDto){return this.imports.discard(user,key);}
}
