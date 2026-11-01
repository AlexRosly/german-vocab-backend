import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

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

  @ApiProperty({ example: "стол" })
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  translation!: string;

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
