import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength } from "class-validator";
export class SessionIdDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  id!: string;
}
