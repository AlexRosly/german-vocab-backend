import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { StudyStatisticsQueryDto } from "./study-statistics-query.dto";

export class StudyBookStatisticsQueryDto extends StudyStatisticsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 100000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  page?: number;

  @ApiPropertyOptional({ description: "Current book title: select lessons instead of books", maxLength: 120 })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  book?: string;

  @ApiPropertyOptional({ enum: ["true"], description: "Lessons of words without a book; cannot be combined with book" })
  @IsOptional() @IsIn(["true"])
  unassigned?: "true";
}
