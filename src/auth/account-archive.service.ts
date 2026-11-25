import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { compare } from "bcrypt";
import { PrismaService } from "../prisma.service";
import { GoogleAuthService, type GoogleIdentity } from "./google-auth.service";
import { ArchiveAccountDto } from "./dto/account-archive.dto";
import { transactionConflict } from "../dictionary-import/import-schema";

@Injectable()
export class AccountArchiveService {
  constructor(private readonly prisma: PrismaService, private readonly google: GoogleAuthService) {}
  async config(userId: string) {
    const accounts = await this.prisma.account.findMany({ where: { userId }, select: { provider: true, passwordHash: true } });
    return { enabled: true, password: accounts.some(a => a.provider === "EMAIL" && !!a.passwordHash), google: this.google.config().enabled && accounts.some(a => a.provider === "GOOGLE") };
  }
  async archive(userId: string, dto: ArchiveAccountDto, identity?: GoogleIdentity) {
    if (dto.confirmation !== "ARCHIVE" || (dto.method === "password" ? dto.credential !== undefined : dto.password !== undefined)) throw new BadRequestException("Проверьте подтверждение архивирования");
    let verifiedHash: string | null = null;
    if (dto.method === "password") {
      if (!dto.password || Buffer.byteLength(dto.password, "utf8") > 72) throw new ForbiddenException("Не удалось подтвердить владельца аккаунта");
      const account = await this.prisma.account.findFirst({ where: { userId, provider: "EMAIL" }, select: { passwordHash: true } });
      if (!account?.passwordHash || !await compare(dto.password, account.passwordHash)) throw new ForbiddenException("Не удалось подтвердить владельца аккаунта");
      verifiedHash = account.passwordHash;
    } else if (!identity) throw new ForbiddenException("Не удалось подтвердить владельца аккаунта");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.prisma.$transaction(async tx => {
          const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, archivedAt: true } });
          if (!user) throw new UnauthorizedException();
          const proof = await tx.account.findFirst({ where: dto.method === "password"
            ? { userId, provider: "EMAIL", passwordHash: verifiedHash }
            : { userId, provider: "GOOGLE", providerAccountId: identity!.subject }, select: { id: true } });
          if (!proof) throw new ForbiddenException("Не удалось подтвердить владельца аккаунта");
          if (user.archivedAt) throw new ConflictException("Аккаунт уже архивирован");
          await tx.user.update({ where: { id: userId }, data: { archivedAt: new Date() } });
          await tx.authSession.deleteMany({ where: { userId } });
          await tx.googleAuthChallenge.deleteMany({ where: { userId } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
        return;
      } catch (e) {
        if (!transactionConflict(e)) throw e;
        if (attempt === 2) throw new ConflictException("Аккаунт изменился. Повторите подтверждение архивирования");
      }
    }
  }
}
