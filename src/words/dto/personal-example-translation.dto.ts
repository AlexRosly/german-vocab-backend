import { IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";
import { SavePersonalTranslationDto, PersonalTranslationParams } from "./personal-translation.dto";
export class PersonalExampleTranslationParams extends PersonalTranslationParams {
  @IsString() @MaxLength(191) @Matches(/^[A-Za-z0-9_-]+$/)
  exampleId!: string;
}
export class SavePersonalExampleTranslationDto extends SavePersonalTranslationDto {
  @IsString() @IsNotEmpty() @MaxLength(1000)
  sourceGerman!: string;
}
