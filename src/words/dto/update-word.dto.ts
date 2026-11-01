import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateWordDto } from "./create-word.dto";
export class UpdateWordDto extends PartialType(OmitType(CreateWordDto, ["examples"] as const), { skipNullProperties: false }) {}
