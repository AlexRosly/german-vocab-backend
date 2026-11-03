import { PersonalTranslationsController } from "./words/personal-translations.controller";
import { PersonalTranslationsService } from "./words/personal-translations.service";
import { PersonalNotesController } from "./words/personal-notes.controller";
import { PersonalNotesService } from "./words/personal-notes.service";
import { WordRelationsController } from "./words/word-relations.controller";
import { WordRelationsService } from "./words/word-relations.service";
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { WordsController } from "./words/words.controller";
import { WordsService } from "./words/words.service";
import { WordExamplesController } from "./words/word-examples.controller";
import { WordExamplesService } from "./words/word-examples.service";
import { StudyModule } from "./study/study.module";
import { AuthModule } from "./auth/auth.module";
import { WordAccessService } from "./words/word-access.service";
import { ModerationModule } from "./moderation/moderation.module";
import { PreferencesModule } from "./preferences/preferences.module";
import { WordTranslationsController } from "./words/word-translations.controller";
import { WordTranslationsService } from "./words/word-translations.service";

@Module({
  imports: [AuthModule, StudyModule, ModerationModule, PreferencesModule],
  controllers: [PersonalTranslationsController, WordRelationsController, PersonalNotesController, HealthController, WordsController, WordExamplesController, WordTranslationsController],
  providers: [PersonalTranslationsService, WordRelationsService, PersonalNotesService, PrismaService, WordsService, WordExamplesService, WordAccessService, WordTranslationsService],
})
export class AppModule {}
