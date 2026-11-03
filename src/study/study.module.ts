import { PersonalTranslationsService } from "../words/personal-translations.service";
import { WordAccessService } from "../words/word-access.service";
import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { StudyController } from "./study.controller";
import { StudyService } from "./study.service";

@Module({
  imports: [AuthModule],
  controllers: [StudyController],
  providers: [StudyService, PrismaService, PersonalTranslationsService, WordAccessService],
})
export class StudyModule {}
