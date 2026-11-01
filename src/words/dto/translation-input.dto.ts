import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, ValidateIf, IsString, MaxLength, MinLength } from "class-validator";
import { normalizeLanguage, TRANSLATION_LANGUAGE_CODES } from "../../languages/language-options";

export class TranslationInputDto {
  @ApiProperty({ enum: TRANSLATION_LANGUAGE_CODES })
  @Transform(({ value }: { value: unknown }) => normalizeLanguage(value))
  @IsIn(TRANSLATION_LANGUAGE_CODES)
  language!: string;

  @ApiPropertyOptional({ nullable: true, description: "null removes only this language" })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.normalize("NFC").trim() : value)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string | null;
}
