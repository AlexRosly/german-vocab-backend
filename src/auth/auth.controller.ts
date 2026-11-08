import { GoogleAuthService, GOOGLE_NONCE_COOKIE, GOOGLE_CHALLENGE_TTL } from "./google-auth.service";
import { GoogleCredentialDto, GoogleLinkDto } from "./dto/google-credential.dto";
import {
  ForbiddenException, UnauthorizedException, Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Req, Res, UseGuards,
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
  constructor(private readonly authService: AuthService, private readonly google: GoogleAuthService) {}

  @Get("google/config") @SkipThrottle() @Header("Cache-Control", "no-store")
  googleConfig() { return this.google.config(); }

  @Post("google/challenge") @HttpCode(200) @Header("Cache-Control", "no-store")
  async googleChallenge(@Res({ passthrough: true }) response: Response) {
    return this.issueGoogleChallenge(response, "login");
  }

  @Post("google") @HttpCode(200) @Header("Cache-Control", "no-store")
  async googleLogin(@Body() dto: GoogleCredentialDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const identity = await this.google.verify(dto.credential, this.readCookie(request, GOOGLE_NONCE_COOKIE), "login");
    response.clearCookie(GOOGLE_NONCE_COOKIE, this.cookieOptions());
    return this.sendAuth(await this.authService.signInWithGoogle(identity), response);
  }

  @Get("google/account") @UseGuards(AuthGuard) @Header("Cache-Control", "no-store")
  googleAccount(@CurrentUser() user: AuthUser) { return this.authService.googleAccount(user.id); }

  @Post("google/link-challenge") @UseGuards(AuthGuard) @HttpCode(200) @Header("Cache-Control", "no-store")
  async googleLinkChallenge(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response) {
    return this.issueGoogleChallenge(response, "link", user.id);
  }

  @Post("google/link") @UseGuards(AuthGuard) @HttpCode(200) @Header("Cache-Control", "no-store")
  async googleLink(@CurrentUser() user: AuthUser, @Body() dto: GoogleLinkDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    let identity;
    try { identity = await this.google.verify(dto.credential, this.readCookie(request, GOOGLE_NONCE_COOKIE), "link", user.id); }
    catch (error) { if (error instanceof UnauthorizedException) throw new ForbiddenException(error.message); throw error; }
    response.clearCookie(GOOGLE_NONCE_COOKIE, this.cookieOptions());
    return this.authService.linkGoogle(user.id, identity, dto.password);
  }

  private async issueGoogleChallenge(response: Response, purpose: "login" | "link", userId?: string) {
    const result = await this.google.issue(purpose, userId);
    response.cookie(GOOGLE_NONCE_COOKIE, result.nonce, { ...this.cookieOptions(), maxAge: GOOGLE_CHALLENGE_TTL });
    return result;
  }

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

  private readCookie(request: Request, name = COOKIE_NAME): string | undefined {
    const values = (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`));
    return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
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
