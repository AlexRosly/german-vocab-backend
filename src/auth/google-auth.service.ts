import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isEmail } from "class-validator";
import { PrismaService } from "../prisma.service";

export type GoogleIdentity = { subject: string; email: string; authoritativeEmail: boolean };
export type GooglePurpose = "login" | "link";
export const GOOGLE_NONCE_COOKIE = "wortkarten_google_nonce";
export const GOOGLE_CHALLENGE_TTL = 10 * 60 * 1000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class GoogleAuthService {
  private readonly verifier = new OAuth2Client();
  constructor(private readonly prisma: PrismaService) {}

  config() {
    // A Client ID may already exist in hosting settings before the additive migration.
    // Enable explicitly only after its table is present and verified.
    if (process.env.GOOGLE_AUTH_ENABLED !== "true") return { enabled: false as const };
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    return clientId && /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)
      ? { enabled: true as const, clientId } : { enabled: false as const };
  }

  async issue(purpose: GooglePurpose, userId?: string) {
    const config = this.config();
    if (!config.enabled) throw new ServiceUnavailableException("Вход через Google пока не настроен");
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + GOOGLE_CHALLENGE_TTL);
    await this.prisma.googleAuthChallenge.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await this.prisma.googleAuthChallenge.create({ data: { nonceHash: digest(nonce), purpose, userId: userId ?? null, expiresAt } });
    return { ...config, nonce, expiresAt };
  }

  async verify(credential: string, nonce: string | undefined, purpose: GooglePurpose, userId?: string): Promise<GoogleIdentity> {
    const config = this.config();
    if (!config.enabled) throw new ServiceUnavailableException("Вход через Google пока не настроен");
    if (!nonce || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new UnauthorizedException("Повторите вход через Google");
    let payload;
    try { payload = (await this.verifier.verifyIdToken({ idToken: credential, audience: config.clientId })).getPayload(); }
    catch { throw new UnauthorizedException("Не удалось проверить вход через Google"); }
    // Signature, issuer, audience and expiry are verified by Google's official library.
    if (!payload || typeof payload.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub) ||
        typeof payload.email !== "string" || payload.email.length > 254 || !isEmail(payload.email) || payload.email_verified !== true ||
        typeof payload.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce) ||
        !timingSafeEqual(Buffer.from(payload.nonce), Buffer.from(nonce))) throw new UnauthorizedException("Не удалось проверить вход через Google");
    const consumed = await this.prisma.googleAuthChallenge.deleteMany({ where: {
      nonceHash: digest(nonce), purpose, userId: userId ?? null, expiresAt: { gt: new Date() },
    } });
    if (consumed.count !== 1) throw new UnauthorizedException("Повторите вход через Google");
    const email = payload.email.trim().toLowerCase();
    return { subject: payload.sub, email, authoritativeEmail: email.endsWith("@gmail.com") || (typeof payload.hd === "string" && !!payload.hd) };
  }
}
