import { Transform } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength, ValidateIf } from "class-validator";
export class PersonalNoteWordIdDto {
  @IsString()
  @MaxLength(191)
  @Matches(/^[A-Za-z0-9_-]+$/)
  id!: string;
}
export class SavePersonalNoteDto {
  @ApiProperty({ maxLength: 2000, description: "Empty text clears only your private note" })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : value)
  @IsString()
  @MaxLength(2000)
  text!: string;

  @ApiProperty({ nullable: true, description: "Revision from GET; null for an absent note" })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  revision!: string | null;
}
