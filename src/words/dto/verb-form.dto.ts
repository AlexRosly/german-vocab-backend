import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";

export enum VerbAuxiliaryDto { HABEN = "HABEN", SEIN = "SEIN" }
const text = ({ value }: { value: unknown }) => typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/gu, " ") : value;

export class VerbFormDto {
  @ApiProperty({ example: "ging" })
  @Transform(text) @IsString() @MinLength(1) @MaxLength(200) @Matches(/^[^\p{Cc}]+$/u)
  praeteritum!: string;

  @ApiProperty({ example: "gegangen" })
  @Transform(text) @IsString() @MinLength(1) @MaxLength(200) @Matches(/^[^\p{Cc}]+$/u)
  participle2!: string;

  @ApiProperty({ enum: VerbAuxiliaryDto }) @IsEnum(VerbAuxiliaryDto)
  auxiliary!: VerbAuxiliaryDto;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  reflexive?: boolean;

  @ApiPropertyOptional({ maxLength: 300, nullable: true })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(text) @IsString() @MaxLength(300) @Matches(/^[^\p{Cc}]*$/u)
  usage?: string | null;
}
