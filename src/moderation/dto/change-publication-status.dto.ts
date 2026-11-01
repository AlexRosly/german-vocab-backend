import { ApiProperty } from "@nestjs/swagger";
import { WordPublicationStatus } from "@prisma/client";
import { IsEnum, IsString, Matches } from "class-validator";

export class ChangePublicationStatusDto {
  @ApiProperty({ enum: WordPublicationStatus })
  @IsEnum(WordPublicationStatus)
  publicationStatus!: WordPublicationStatus;

  @ApiProperty({ description: "Ревизия из последнего GET карточки модерации", pattern: "^[a-f0-9]{64}$" })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedRevision!: string;
}
