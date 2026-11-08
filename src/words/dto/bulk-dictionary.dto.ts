import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class BulkDictionaryDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 2000, description: "Snapshot of the published library cards selected by the caller" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(191, { each: true })
  @Matches(/^[A-Za-z0-9._-]+$/, { each: true })
  wordIds!: string[];
}
