import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, MaxLength, ValidateIf } from "class-validator";

export class WordQueryDto {
  @ApiPropertyOptional({ description: "Поиск по немецкому слову или переводу", maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  q?: string;
}
