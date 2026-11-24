import { WordOrganizationController } from "./words/word-organization.controller";
import { WordOrganizationService } from "./words/word-organization.service";
import { PersonalExampleTranslationsController } from "./words/personal-example-translations.controller";
import { PersonalExampleTranslationsService } from "./words/personal-example-translations.service";
import { DictionaryImportSaveController } from "./dictionary-import/dictionary-import-save.controller";
import { DictionaryImportApplyService } from "./dictionary-import/dictionary-import-apply.service";
import { DictionaryImportController } from "./dictionary-import/dictionary-import.controller";
import { DictionaryImportService } from "./dictionary-import/dictionary-import.service";
import { DictionaryExportController, DictionaryExportThrottle } from "./dictionary-export/dictionary-export.controller";
import { DictionaryExportService } from "./dictionary-export/dictionary-export.service";
import { MailModule } from "./mail/mail.module";
import { CollocationsConfigController, CollocationsController } from "./words/collocations.controller";
import { CollocationsService } from "./words/collocations.service";
import { VerbsService } from "./words/verbs.service";
import { VerbsController } from "./words/verbs.controller";
import { OperationsModule } from "./operations/operations.module";
import { CorrectionsController } from "./corrections/corrections.controller";
import { CorrectionsService } from "./corrections/corrections.service";
import { PersonalBooksController } from "./words/personal-books.controller";
import { PersonalBooksService } from "./words/personal-books.service";
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
  imports: [MailModule, OperationsModule, AuthModule, StudyModule, ModerationModule, PreferencesModule],
  controllers: [WordOrganizationController, PersonalExampleTranslationsController, DictionaryImportSaveController, DictionaryImportController, DictionaryExportController, CollocationsConfigController, CollocationsController, VerbsController, CorrectionsController, PersonalBooksController, PersonalTranslationsController, WordRelationsController, PersonalNotesController, HealthController, WordsController, WordExamplesController, WordTranslationsController],
  providers: [WordOrganizationService, PersonalExampleTranslationsService, DictionaryImportApplyService, DictionaryImportService, DictionaryExportService, DictionaryExportThrottle, CollocationsService, VerbsService, CorrectionsService, PersonalBooksService, PersonalTranslationsService, WordRelationsService, PersonalNotesService, PrismaService, WordsService, WordExamplesService, WordAccessService, WordTranslationsService],
})
export class AppModule {}
