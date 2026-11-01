import {
  Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Req, Res, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SkipThrottle, Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { CookieOptions, Request, Response } from "express";
import { AuthGuard } from "./auth.guard";
import { AuthOriginGuard } from "./auth-origin.guard";
import { AuthResult, AuthService, AuthUser } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { CurrentSession } from "./current-session.decorator";
import { SessionIdDto } from "./dto/session-id.dto";
import { CredentialsDto } from "./dto/credentials.dto";

const COOKIE_NAME = "wortkarten_refresh";

@ApiTags("auth")
@Controller("auth")
@UseGuards(AuthOriginGuard, ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @Header("Cache-Control", "no-store")
  async register(@Body() dto: CredentialsDto, @Res({ passthrough: true }) response: Response) {
    return this.sendAuth(await this.authService.register(dto), response);
  }

  @Post("login")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async login(@Body() dto: CredentialsDto, @Res({ passthrough: true }) response: Response) {
    return this.sendAuth(await this.authService.login(dto), response);
  }

  @Post("refresh")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.sendAuth(await this.authService.refresh(this.readCookie(request)), response);
  }

  @Post("logout")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.authService.logout(this.readCookie(request));
    response.clearCookie(COOKIE_NAME, this.cookieOptions());
  }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @Header("Cache-Control", "no-store")
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get("sessions")
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "no-store")
  listSessions(@CurrentUser() user: AuthUser, @CurrentSession() sessionId: string) {
    return this.authService.listSessions(user.id, sessionId);
  }

  @Delete("sessions/:id")
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async revokeSession(@CurrentUser() user: AuthUser, @CurrentSession() currentId: string,
    @Param() params: SessionIdDto, @Res({ passthrough: true }) response: Response) {
    await this.authService.revokeSession(user.id, params.id);
    if (params.id === currentId) response.clearCookie(COOKIE_NAME, this.cookieOptions());
  }

  @Post("logout-all")
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response) {
    await this.authService.logoutAll(user.id);
    response.clearCookie(COOKIE_NAME, this.cookieOptions());
  }

  private readCookie(request: Request): string | undefined {
    const values = (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${COOKIE_NAME}=`));
    return values.length === 1 ? values[0].slice(COOKIE_NAME.length + 1) : undefined;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/v1/auth",
    };
  }

  private sendAuth(result: AuthResult, response: Response) {
    response.cookie(COOKIE_NAME, result.refreshToken, {
      ...this.cookieOptions(),
      maxAge: Math.max(0, result.refreshExpiresAt.getTime() - Date.now()),
    });
    return {
      user: result.user,
      accessToken: result.accessToken,
      tokenType: "Bearer",
      expiresIn: Math.max(0, Math.floor((result.accessExpiresAt.getTime() - Date.now()) / 1000)),
      accessExpiresAt: result.accessExpiresAt,
    };
  }
}
