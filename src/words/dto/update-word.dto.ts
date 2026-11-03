import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateWordDto } from "./create-word.dto";
export class UpdateWordDto extends PartialType(OmitType(CreateWordDto, ["examples", "relatedWordIds"] as const), { skipNullProperties: false }) {}
