import { PartialType } from "@nestjs/swagger";
import { CreateWordExampleDto } from "./create-word-example.dto";

export class UpdateWordExampleDto extends PartialType(CreateWordExampleDto) {}