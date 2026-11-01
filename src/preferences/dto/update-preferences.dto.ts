import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsString, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { INTERFACE_LANGUAGE_CODES, normalizeLanguage, TRANSLATION_LANGUAGE_CODES } from "../../languages/language-options";

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ example: "Europe/Berlin", default: "UTC" })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  timeZone?: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 500 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(500)
  dailyGoal?: number;

  @ApiPropertyOptional({ enum: INTERFACE_LANGUAGE_CODES })
  @Transform(({ value }: { value: unknown }) => normalizeLanguage(value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn(INTERFACE_LANGUAGE_CODES)
  interfaceLanguage?: string;

  @ApiPropertyOptional({ enum: TRANSLATION_LANGUAGE_CODES })
  @Transform(({ value }: { value: unknown }) => normalizeLanguage(value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn(TRANSLATION_LANGUAGE_CODES)
  translationLanguage?: string;
}
