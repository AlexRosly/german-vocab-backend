import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional } from "class-validator";

export class StudyStatisticsQueryDto {
  @ApiPropertyOptional({ default: 30, enum: [7, 30, 90] })
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([7, 30, 90])
  days?: number;
}
