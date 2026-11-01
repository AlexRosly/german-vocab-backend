import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsNotEmpty, IsString, MaxLength, ValidateIf, ValidateNested } from "class-validator";

import { TranslationInputDto } from "./translation-input.dto";

export class CreateWordExampleDto {
  @ApiProperty({ example: "Ich lerne jeden Tag Deutsch." })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  german!: string;

  @ApiPropertyOptional({ example: "Я учу немецкий каждый день.", description: "Legacy Russian translation" })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  translation?: string;

  @ApiPropertyOptional({ type: [TranslationInputDto] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique((item: TranslationInputDto) => item?.language)
  @ValidateNested({ each: true })
  @Type(() => TranslationInputDto)
  translations?: TranslationInputDto[];
}
