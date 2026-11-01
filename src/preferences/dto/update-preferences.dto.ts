import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsString, ValidateIf } from "class-validator";
import { INTERFACE_LANGUAGE_CODES, normalizeLanguage, TRANSLATION_LANGUAGE_CODES } from "../../languages/language-options";

export class UpdatePreferencesDto {
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
