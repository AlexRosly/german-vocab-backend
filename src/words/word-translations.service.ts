import { BadRequestException, Injectable } from "@nestjs/common";
import { AuthUser } from "../auth/auth.service";
import { translationLanguage } from "../languages/language-options";
import { UpsertWordTranslationDto } from "./dto/upsert-word-translation.dto";
import { WordAccessService } from "./word-access.service";
import { WordsService } from "./words.service";

@Injectable()
export class WordTranslationsService {
  constructor(private readonly access: WordAccessService, private readonly words: WordsService) {}

  async get(user: AuthUser, wordId: string, requestedLanguage: string) {
    const language = translationLanguage(requestedLanguage);
    const word = await this.access.requireReadable(user, wordId);
    return { wordId, language, text: word.translations.find((item) => item.language === language)?.text ?? null };
  }

  async set(user: AuthUser, wordId: string, requestedLanguage: string, dto: UpsertWordTranslationDto) {
    const language = translationLanguage(requestedLanguage);
    const text = typeof dto.text === "string" ? dto.text.normalize("NFC").trim() : "";
    if (text.length === 0 || [...text].length > 1000) throw new BadRequestException("Перевод должен содержать от 1 до 1000 символов");
    if (language === "ru") {
      // Reuse the existing permission, duplicate and legacy-field synchronization logic.
      await this.words.update(user, wordId, { translation: text });
      return { wordId, language, text };
    }
    return this.access.transaction(async (tx) => {
      await this.access.beginEdit(tx, user, wordId);
      const saved = await tx.wordTranslation.upsert({
        where: { wordId_language: { wordId, language } },
        create: { wordId, language, text },
        update: { text },
      });
      return { wordId, language, text: saved.text };
    });
  }
}
