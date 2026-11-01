import { Transform } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class UpsertWordTranslationDto {
  @ApiProperty({ example: "tree" })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.normalize("NFC").trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;
}
