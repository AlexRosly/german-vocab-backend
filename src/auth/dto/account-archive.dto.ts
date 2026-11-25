import { Equals, IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";

export class ArchiveAccountDto {
  @Equals("ARCHIVE") confirmation!: string;
  @IsIn(["password", "google"]) method!: "password" | "google";
  @ValidateIf((o, v) => o.method === "password" || v !== undefined)
  @IsString() @MinLength(1) @MaxLength(72) password?: string;
  @ValidateIf((o, v) => o.method === "google" || v !== undefined)
  @IsString() @MaxLength(10000) @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  credential?: string;
}
