import { GoogleAuthService } from "./google-auth.service";
import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { PrismaService } from "../prisma.service";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthOriginGuard } from "./auth-origin.guard";
import { AuthService } from "./auth.service";
import { AdminGuard } from "./admin.guard";

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
  controllers: [AuthController],
  providers: [GoogleAuthService, PrismaService, AuthService, AuthGuard, AuthOriginGuard, AdminGuard],
  exports: [AuthService, AuthGuard, AdminGuard],
})
export class AuthModule {}
