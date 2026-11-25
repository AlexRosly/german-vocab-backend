import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response, CookieOptions } from "express";
import { AuthGuard } from "./auth.guard";
import { AuthOriginGuard } from "./auth-origin.guard";
import { CurrentUser } from "./current-user.decorator";
import { AuthUser } from "./auth.service";
import { GoogleAuthService, GOOGLE_NONCE_COOKIE, GOOGLE_CHALLENGE_TTL } from "./google-auth.service";
import { ArchiveAccountDto } from "./dto/account-archive.dto";
import { AccountArchiveService } from "./account-archive.service";

@ApiTags("account") @ApiBearerAuth() @Controller("auth/account")
@UseGuards(AuthOriginGuard, ThrottlerGuard, AuthGuard)
export class AccountArchiveController {
  constructor(private readonly service: AccountArchiveService, private readonly google: GoogleAuthService) {}
  @Get("archive-config") @Header("Cache-Control", "no-store")
  config(@CurrentUser() user: AuthUser) { return this.service.config(user.id); }
  private cookies(): CookieOptions { return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/v1/auth" }; }
  @Post("archive-challenge") @HttpCode(200) @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async challenge(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response) {
    const config = await this.service.config(user.id);
    if (!config.google) throw new ForbiddenException("Для архивирования подтвердите пароль аккаунта");
    const result = await this.google.issue("archive", user.id);
    response.cookie(GOOGLE_NONCE_COOKIE, result.nonce, { ...this.cookies(), maxAge: GOOGLE_CHALLENGE_TTL });
    return result;
  }
  @Post("archive") @HttpCode(204) @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async archive(@CurrentUser() user: AuthUser, @Body() dto: ArchiveAccountDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    let identity;
    if (dto.method === "google") {
      const values = (request.headers.cookie ?? "").split(";").map(x => x.trim()).filter(x => x.startsWith(GOOGLE_NONCE_COOKIE + "="));
      const nonce = values.length === 1 ? values[0].slice(GOOGLE_NONCE_COOKIE.length + 1) : undefined;
      try { identity = await this.google.verify(dto.credential!, nonce, "archive", user.id); }
      catch (e) { if (e instanceof UnauthorizedException) throw new ForbiddenException("Не удалось подтвердить владельца аккаунта"); throw e; }
    }
    await this.service.archive(user.id, dto, identity);
    response.clearCookie("wortkarten_refresh", this.cookies());
    response.clearCookie(GOOGLE_NONCE_COOKIE, this.cookies());
  }
}
