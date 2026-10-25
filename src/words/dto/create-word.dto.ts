import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

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
  @IsString()
  @MinLength(1)
  german!: string;

  @ApiProperty({ enum: ArticleDto, example: "der" })
  @IsEnum(ArticleDto)
  article!: ArticleDto;

  @ApiProperty({ enum: GrammaticalNumberDto, example: "singular" })
  @IsEnum(GrammaticalNumberDto)
  grammaticalNumber!: GrammaticalNumberDto;

  @ApiProperty({ example: "стол" })
  @IsString()
  @MinLength(1)
  translation!: string;

  @ApiPropertyOptional({ example: "Tische" })
  @IsOptional()
  @IsString()
  pluralForm?: string;

  @ApiPropertyOptional({ enum: CefrLevelDto, example: "A1" })
  @IsOptional()
  @IsEnum(CefrLevelDto)
  level?: CefrLevelDto;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  lessonNumber?: number;

  @ApiPropertyOptional({ example: "Предмет мебели" })
  @IsOptional()
  @IsString()
  notes?: string;
}
