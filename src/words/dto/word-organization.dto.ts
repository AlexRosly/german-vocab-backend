import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { normalizeTitle } from "../organization-data";
const normalize=({value}:{value:unknown})=>typeof value==="string"?normalizeTitle(value):value;
class BookInput {
  @Transform(normalize) @IsString() @MinLength(1) @MaxLength(120) @Matches(/^[^\p{Cc}]+$/u)
  title!:string;
  @IsArray() @ArrayMaxSize(10000) @ArrayUnique() @IsInt({each:true}) @Min(1,{each:true}) @Max(10000,{each:true})
  lessonNumbers!:number[];
}
class LessonNameInput {
  @Transform(normalize) @IsString() @MinLength(1) @MaxLength(120)
  book!:string;
  @IsInt() @Min(1) @Max(10000)
  lessonNumber!:number;
  @Transform(normalize) @IsString() @MaxLength(120)
  name!:string;
}
export class SaveWordOrganizationDto {
  @IsArray() @ArrayMaxSize(20) @ArrayUnique((b:BookInput)=>typeof b?.title === "string" ? b.title.toLocaleLowerCase("de") : undefined) @ValidateNested({each:true}) @Type(()=>BookInput)
  books!:BookInput[];
  @IsArray() @ArrayMaxSize(20) @IsString({each:true})
  tags!:string[];
  @ValidateIf((_o,v)=>v!==null) @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  bookRevision!:string|null;
  @ValidateIf((_o,v)=>v!==null) @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  tagsRevision!:string|null;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>LessonNameInput)
  lessonNameUpdates!:LessonNameInput[];
  @ValidateIf((_o,v)=>v!==null) @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  settingsRevision!:string|null;
}
export class SaveOrganizationColorDto {
  @ValidateIf((_o,v)=>v!==null) @IsString() @Matches(/^#[0-9a-fA-F]{6}$/)
  neutralColor!:string|null;
  @ValidateIf((_o,v)=>v!==null) @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  revision!:string|null;
}
