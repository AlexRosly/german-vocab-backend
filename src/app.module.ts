import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { WordsController } from "./words/words.controller";
import { WordsService } from "./words/words.service";
import { WordExamplesController } from "./words/word-examples.controller";
import { WordExamplesService } from "./words/word-examples.service";

@Module({
  controllers: [
    HealthController,
    WordsController,
    WordExamplesController,
  ],
  providers: [
    PrismaService,
    WordsService,
    WordExamplesService,
  ],
})
export class AppModule {}