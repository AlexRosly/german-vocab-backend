import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { INTERFACE_LANGUAGES, TRANSLATION_LANGUAGES } from "./language-options";

@ApiTags("languages")
@Controller("languages")
export class LanguagesController {
  @Get()
  getLanguages() {
    return { interfaceLanguages: INTERFACE_LANGUAGES, translationLanguages: TRANSLATION_LANGUAGES };
  }
}
