import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { TRANSLATION_LANGUAGE_CODES } from "../../languages/language-options";
import { TranslationInputDto } from "./translation-input.dto";
const text=({value}:{value:unknown})=>typeof value==="string"?value.normalize("NFC").trim().replace(/\s+/gu," "):value;
export class CollocationWordParams {
  @IsString() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  id!:string;
}
export class CollocationParams extends CollocationWordParams {
  @IsString() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  collocationId!:string;
}
export class CollocationQueryDto {
  @Type(()=>Number) @IsInt() @Min(1) @Max(1000000)
  page=1;
}
export class CreateCollocationDto {
  @ApiProperty() @IsString() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  verbWordId!:string;
  @ApiProperty({example:"mit dem Arbeitgeber sprechen"})
  @Transform(text) @IsString() @MinLength(1) @MaxLength(500) @Matches(/^[^\p{Cc}]+$/u)
  german!:string;
  @ApiPropertyOptional({nullable:true,example:"mit + Dativ"})
  @ValidateIf((_object,value)=>value!==undefined&&value!==null)
  @Transform(text) @IsString() @MaxLength(300) @Matches(/^[^\p{Cc}]*$/u)
  grammarNote?:string|null;
  @ApiPropertyOptional({type:[TranslationInputDto]})
  @ValidateIf((_object,value)=>value!==undefined)
  @IsArray() @ArrayMaxSize(TRANSLATION_LANGUAGE_CODES.length) @ArrayUnique((item:TranslationInputDto)=>item?.language)
  @ValidateNested({each:true}) @Type(()=>TranslationInputDto)
  translations?:TranslationInputDto[];
}
export class UpdateCollocationDto extends PartialType(CreateCollocationDto,{skipNullProperties:false}) {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  revision!:string;
}
export class DeleteCollocationDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  revision!:string;
}
