import { TRANSLATION_LANGUAGE_CODES } from "../../languages/language-options";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, ValidateIf, ValidateNested, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Matches, Min, MinLength } from "class-validator";

import { TranslationInputDto } from "./translation-input.dto";
import { CreateWordExampleDto } from "./create-word-example.dto";

const trimText = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.normalize("NFC").trim() : value;

export enum ArticleDto {
  der = "der",
  das = "das",
  die = "die",
  none = "none"
}
export enum GrammaticalNumberDto {
  singular = "singular", plural = "plural", not_applicable = "not_applicable"
}
export enum CefrLevelDto {
  A1 = "A1", A2 = "A2", B1 = "B1", B2 = "B2", C1 = "C1", C2 = "C2"
}

export class CreateWordDto {
  @ApiProperty({ example: "Tisch" })
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  german!: string;

  @ApiProperty({ enum: ArticleDto, example: "der" })
  @IsEnum(ArticleDto)
  article!: ArticleDto;

  @ApiProperty({ enum: GrammaticalNumberDto, example: "singular" })
  @IsEnum(GrammaticalNumberDto)
  grammaticalNumber!: GrammaticalNumberDto;

  @ApiPropertyOptional({ example: "стол", description: "Legacy Russian translation" })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  translation?: string;

  @ApiPropertyOptional({ type: [TranslationInputDto] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(TRANSLATION_LANGUAGE_CODES.length)
  @ArrayUnique((item: TranslationInputDto) => item?.language)
  @ValidateNested({ each: true })
  @Type(() => TranslationInputDto)
  translations?: TranslationInputDto[];

  @ApiPropertyOptional({ type: [String], maxItems: 20, description: "Existing readable cards to link to the new pending card" })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(191, { each: true })
  @Matches(/^[A-Za-z0-9._-]+$/, { each: true })
  relatedWordIds?: string[];

  @ApiPropertyOptional({ type: [CreateWordExampleDto] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateWordExampleDto)
  examples?: CreateWordExampleDto[];

  @ApiPropertyOptional({ example: "Tische" })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pluralForm?: string | null;

  @ApiPropertyOptional({ enum: CefrLevelDto, example: "A1" })
  @IsOptional()
  @IsEnum(CefrLevelDto)
  level?: CefrLevelDto | null;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  lessonNumber?: number | null;

  @ApiPropertyOptional({ example: "Предмет мебели" })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}
