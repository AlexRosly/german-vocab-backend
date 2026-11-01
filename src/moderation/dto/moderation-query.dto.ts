import { ApiPropertyOptional } from "@nestjs/swagger";
import { WordPublicationStatus } from "@prisma/client";
import { IsEnum } from "class-validator";

export class ModerationQueryDto {
  @ApiPropertyOptional({ enum: WordPublicationStatus, default: WordPublicationStatus.PENDING_REVIEW })
  @IsEnum(WordPublicationStatus)
  status: WordPublicationStatus = WordPublicationStatus.PENDING_REVIEW;
}
