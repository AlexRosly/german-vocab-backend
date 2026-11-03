import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsString, Matches, MaxLength, ValidateIf } from "class-validator";
export class DictionaryEntryParams {
  @IsString() @MaxLength(191) @Matches(/^[A-Za-z0-9_-]+$/)
  id!: string;
}
export class SaveDictionaryEntryDto {
  @ApiProperty({ description: "Revision from dictionaryEntry in /words/mine or GET dictionary-settings" })
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  revision!: string;
  @ApiPropertyOptional() @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  isFavorite?: boolean;
  @ApiPropertyOptional() @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  isArchived?: boolean;
}
