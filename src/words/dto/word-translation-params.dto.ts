import { Transform } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { normalizeLanguage, TRANSLATION_LANGUAGE_CODES } from "../../languages/language-options";

export class WordTranslationParamsDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  @Matches(/^\S+$/u)
  wordId!: string;

  @ApiProperty({ enum: TRANSLATION_LANGUAGE_CODES })
  @Transform(({ value }: { value: unknown }) => normalizeLanguage(value))
  @IsString()
  @IsIn(TRANSLATION_LANGUAGE_CODES)
  language!: string;
}
