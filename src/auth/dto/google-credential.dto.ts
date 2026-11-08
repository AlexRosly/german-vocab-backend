import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class GoogleCredentialDto {
  @ApiProperty({ description: "Google Identity Services ID token", maxLength: 10000 })
  @IsString()
  @MaxLength(10000)
  @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  credential!: string;
}

export class GoogleLinkDto extends GoogleCredentialDto {
  @ApiProperty({ format: "password", minLength: 12, maxLength: 72 })
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;
}
