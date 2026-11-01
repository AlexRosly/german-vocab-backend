import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { StudyAnswer } from "@prisma/client";
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum,
  IsInt, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";

export type StudyAnswerDto = StudyAnswer;

export class StudySessionWordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  @Matches(/^\S+$/u)
  wordId!: string;

  @ApiProperty({ enum: StudyAnswer })
  @IsEnum(StudyAnswer)
  answer!: StudyAnswerDto;
}

export class CreateStudySessionDto {
  @ApiProperty({ minimum: 1, maximum: 500 })
  @IsInt()
  @Min(1)
  @Max(500)
  totalWords!: number;

  @ApiProperty({ type: [StudySessionWordDto], minItems: 1, maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique((item: StudySessionWordDto | null) => item?.wordId)
  @ValidateNested({ each: true })
  @Type(() => StudySessionWordDto)
  words!: StudySessionWordDto[];
}
