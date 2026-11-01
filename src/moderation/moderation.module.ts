import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../prisma.service";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";

@Module({
  imports: [AuthModule],
  controllers: [ModerationController],
  providers: [PrismaService, ModerationService],
})
export class ModerationModule {}
