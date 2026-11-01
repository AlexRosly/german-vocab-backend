import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateWordExampleDto {
  @ApiProperty({ example: "Ich lerne jeden Tag Deutsch." })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  german!: string;

  @ApiProperty({ example: "Я учу немецкий каждый день." })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  translation!: string;
}
