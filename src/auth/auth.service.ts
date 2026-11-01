import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { compare, hash } from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { CredentialsDto } from "./dto/credentials.dto";

const ACCESS_TTL_MS = 10 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USER_SELECT = {
  id: true,
  email: true,
  emailVerified: true,
  interfaceLanguage: true,
  translationLanguage: true,
  role: true,
} satisfies Prisma.UserSelect;

export type AuthUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;
export interface AuthContext {
  user: AuthUser;
  sessionId: string;
}

export interface AuthResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isToken(token: string | undefined): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

@Injectable()
export class AuthService {
  // Unknown accounts still perform a password comparison with the same cost.
  private readonly dummyHash = hash(randomBytes(32).toString("hex"), 12);

  constructor(private readonly prisma: PrismaService) {}

  async register(dto: CredentialsDto): Promise<AuthResult> {
    this.checkPasswordLength(dto.password);
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await hash(dto.password, 12);
    const tokens = this.newTokens();

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // Never attach password credentials to an existing OAuth user by email.
        const existing = await tx.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException("Этот email уже зарегистрирован");
        }

        const created = await tx.user.create({
          data: {
            email,
            role: "USER",
            accounts: {
              create: { provider: "EMAIL", providerAccountId: email, passwordHash },
            },
          },
          select: USER_SELECT,
        });
        await tx.authSession.create({
          data: { userId: created.id, ...this.sessionData(tokens) },
        });
        return created;
      });
      return { user, ...tokens };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Этот email уже зарегистрирован");
      }
      throw error;
    }
  }

  async login(dto: CredentialsDto): Promise<AuthResult> {
    this.checkPasswordLength(dto.password);
    const email = dto.email.trim().toLowerCase();
    const account = await this.prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: "EMAIL", providerAccountId: email } },
      select: { passwordHash: true, user: { select: USER_SELECT } },
    });
    const passwordMatches = await compare(
      dto.password,
      account?.passwordHash ?? (await this.dummyHash),
    );
    if (!account?.passwordHash || !passwordMatches) {
      throw new UnauthorizedException("Неверный email или пароль");
    }

    const tokens = this.newTokens();
    await this.prisma.authSession.create({
      data: { userId: account.user.id, ...this.sessionData(tokens) },
    });
    return { user: account.user, ...tokens };
  }

  async refresh(refreshToken: string | undefined): Promise<AuthResult> {
    if (!isToken(refreshToken)) throw new UnauthorizedException("Сессия недействительна");
    const refreshTokenHash = digest(refreshToken);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const session = await tx.authSession.findUnique({
        where: { refreshTokenHash },
        include: { user: { select: USER_SELECT } },
      });
      if (!session || session.refreshExpiresAt <= now) {
        throw new UnauthorizedException("Сессия недействительна");
      }

      // Keep the original absolute expiry; refresh does not extend a session forever.
      const tokens = this.newTokens(session.refreshExpiresAt);
      const updated = await tx.authSession.updateMany({
        where: { id: session.id, refreshTokenHash, refreshExpiresAt: { gt: now } },
        data: this.sessionData(tokens),
      });
      // Compare-and-swap makes a refresh token usable only once, including concurrent requests.
      if (updated.count !== 1) throw new UnauthorizedException("Сессия недействительна");
      return { user: session.user, ...tokens };
    });
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (isToken(refreshToken)) {
      await this.prisma.authSession.deleteMany({
        where: { refreshTokenHash: digest(refreshToken) },
      });
    }
  }

  async authenticate(accessToken: string): Promise<AuthContext> {
    if (!isToken(accessToken)) throw new UnauthorizedException();
    const session = await this.prisma.authSession.findUnique({
      where: { accessTokenHash: digest(accessToken) },
      include: { user: { select: USER_SELECT } },
    });
    const now = new Date();
    if (!session || session.accessExpiresAt <= now || session.refreshExpiresAt <= now) {
      throw new UnauthorizedException();
    }
    return { user: session.user, sessionId: session.id };
  }

  private checkPasswordLength(password: string): void {
    if (typeof password !== "string" || [...password].length < 12 || Buffer.byteLength(password, "utf8") > 72) {
      throw new BadRequestException("Пароль должен содержать не менее 12 символов и не более 72 байт UTF-8");
    }
  }

  private newTokens(refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS)) {
    return {
      accessToken: randomBytes(32).toString("base64url"),
      refreshToken: randomBytes(32).toString("base64url"),
      accessExpiresAt: new Date(Math.min(Date.now() + ACCESS_TTL_MS, refreshExpiresAt.getTime())),
      refreshExpiresAt,
    };
  }

  private sessionData(tokens: ReturnType<AuthService["newTokens"]>) {
    return {
      accessTokenHash: digest(tokens.accessToken),
      refreshTokenHash: digest(tokens.refreshToken),
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
    };
  }
}
