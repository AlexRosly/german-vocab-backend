import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsEnum, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { VerbAuxiliaryDto } from "./verb-form.dto";
export enum VerbScopeDto { library = "library", mine = "mine" }

export class VerbQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({value}: {value: unknown}) => typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/gu," ") : value)
  @IsString() @MaxLength(100) @Matches(/^[^\p{Cc}]*$/u)
  q?: string;

  @ApiPropertyOptional({ enum: VerbScopeDto, default: "library" })
  @IsEnum(VerbScopeDto)
  scope: VerbScopeDto = VerbScopeDto.library;

  @ApiPropertyOptional({ enum: VerbAuxiliaryDto })
  @ValidateIf((_object,value) => value !== undefined) @IsEnum(VerbAuxiliaryDto)
  auxiliary?: VerbAuxiliaryDto;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 })
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000)
  page = 1;
}

export class VerbIdDto {
  @IsString() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  id!: string;
}
