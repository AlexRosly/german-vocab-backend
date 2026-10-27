import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateWordExampleDto {
  @ApiProperty({ example: "Ich lerne jeden Tag Deutsch." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  german!: string;

  @ApiProperty({ example: "Я учу немецкий каждый день." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  translation!: string;
}