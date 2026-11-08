import { Transform } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayUnique, IsArray, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";

export const normalizeBook = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ");
export class SavePersonalBooksDto {
  @ApiProperty({ type: [String], maxItems: 20, description: "Private book titles; an empty array clears the private association" })
  @Transform(({ value }: { value: unknown }) => Array.isArray(value) ? value.map(title => typeof title === "string" ? normalizeBook(title) : title) : value)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique(title => typeof title === "string" ? title.toLocaleLowerCase("de") : title)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  @Matches(/^[^\p{Cc}]+$/u, { each: true })
  titles!: string[];

  @ApiProperty({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  revision!: string | null;
}
