import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { WordsController } from "./words/words.controller";
import { WordsService } from "./words/words.service";

@Module({
  controllers: [HealthController, WordsController],
  providers: [PrismaService, WordsService]
})
export class AppModule {}
