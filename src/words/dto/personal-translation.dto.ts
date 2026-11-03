import { Transform } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches, MaxLength, ValidateIf } from "class-validator";
import { normalizeLanguage, TRANSLATION_LANGUAGE_CODES } from "../../languages/language-options";
import { PersonalNoteWordIdDto } from "./personal-note.dto";
export class PersonalTranslationParams extends PersonalNoteWordIdDto {
  @Transform(({ value }: { value: unknown }) => normalizeLanguage(value))
  @IsString() @IsIn(TRANSLATION_LANGUAGE_CODES)
  language!: string;
}
export class SavePersonalTranslationDto {
  @ApiProperty({ maxLength: 1000, description: "Empty text clears only your translation in this language" })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.normalize("NFC").replace(/\r\n?/g, "\n").trim() : value)
  @IsString() @MaxLength(1000)
  text!: string;
  @ApiProperty({ nullable: true, description: "Revision from GET; null when absent" })
  @ValidateIf((_object, value) => value !== null)
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  revision!: string | null;
}
