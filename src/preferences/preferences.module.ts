import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LanguagesController } from "../languages/languages.controller";
import { PrismaService } from "../prisma.service";
import { PreferencesController } from "./preferences.controller";
import { PreferencesService } from "./preferences.service";

@Module({
  imports: [AuthModule],
  controllers: [PreferencesController, LanguagesController],
  providers: [PrismaService, PreferencesService],
})
export class PreferencesModule {}
