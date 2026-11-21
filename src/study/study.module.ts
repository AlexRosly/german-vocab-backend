import { PersonalTranslationsService } from "../words/personal-translations.service";
import { WordAccessService } from "../words/word-access.service";
import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { StudyController } from "./study.controller";
import { StudyStatisticsService } from "./study-statistics.service";
import { StudyService } from "./study.service";

@Module({
  imports: [AuthModule],
  controllers: [StudyController],
  providers: [StudyStatisticsService, StudyService, PrismaService, PersonalTranslationsService, WordAccessService],
})
export class StudyModule {}
