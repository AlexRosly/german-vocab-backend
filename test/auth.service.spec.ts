import { BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { compare, hash } from "bcrypt";
import { createHash } from "node:crypto";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";

const user = {
  id: "user-a", email: "learner@example.com", emailVerified: null,
  interfaceLanguage: "ru", translationLanguage: "ru", role: "USER" as const,
};
const password = "A long password 123!";
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

describe("AuthService", () => {
  let service: AuthService;
  let db: ReturnType<typeof makeDatabase>;

  function makeDatabase() {
    return {
      user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(user) },
      account: { findUnique: jest.fn() },
      authSession: {
        create: jest.fn().mockResolvedValue({}), findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    };
  }

  beforeEach(() => {
    db = makeDatabase();
    db.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(db));
    service = new AuthService(db as unknown as PrismaService);
  });

  it("registers a USER with a bcrypt hash and stores only token hashes", async () => {
    const result = await service.register({ email: " Learner@EXAMPLE.com ", password });
    const created = db.user.create.mock.calls[0][0];
    expect(created.data.email).toBe("learner@example.com");
    expect(created.data.role).toBe("USER");
    const account = created.data.accounts.create;
    expect(account).toMatchObject({ provider: "EMAIL", providerAccountId: "learner@example.com" });
    expect(account.passwordHash).not.toBe(password);
    expect(await compare(password, account.passwordHash)).toBe(true);
    const saved = db.authSession.create.mock.calls[0][0].data;
    expect(saved).toMatchObject({ userId: "user-a", accessTokenHash: digest(result.accessToken), refreshTokenHash: digest(result.refreshToken) });
    expect(saved).not.toHaveProperty("accessToken");
    expect(saved).not.toHaveProperty("refreshToken");
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.accessExpiresAt.getTime() - Date.now()).toBeGreaterThan(590_000);
    expect(result.refreshExpiresAt.getTime() - Date.now()).toBeGreaterThan(604_790_000);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does not attach credentials to an existing email, including OAuth accounts", async () => {
    db.user.findFirst.mockResolvedValue({ id: "oauth-user" });
    await expect(service.register({ email: user.email, password })).rejects.toBeInstanceOf(ConflictException);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.authSession.create).not.toHaveBeenCalled();
  });

  it("converts a concurrent registration unique conflict into HTTP 409", async () => {
    db.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique", { code: "P2002", clientVersion: "6.19.3" }));
    await expect(service.register({ email: user.email, password })).rejects.toBeInstanceOf(ConflictException);
    expect(db.authSession.create).not.toHaveBeenCalled();
  });

  it("rejects passwords exceeding 72 UTF-8 bytes instead of truncating them", async () => {
    await expect(service.register({ email: user.email, password: "я".repeat(37) })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("logs in by EMAIL credentials and returns the same error for unknown and wrong passwords", async () => {
    const passwordHash = await hash(password, 12);
    db.account.findUnique.mockResolvedValue({ passwordHash, user });
    const result = await service.login({ email: "LEARNER@example.com", password });
    expect(result.user.id).toBe("user-a");
    expect(db.account.findUnique.mock.calls[0][0].where.provider_providerAccountId).toEqual({ provider: "EMAIL", providerAccountId: user.email });
    const wrong = await service.login({ email: user.email, password: "An incorrect password" }).catch((error: Error) => error);
    db.account.findUnique.mockResolvedValue(null);
    const unknown = await service.login({ email: "unknown@example.com", password }).catch((error: Error) => error);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect((wrong as Error).message).toBe((unknown as Error).message);
    expect(db.authSession.create).toHaveBeenCalledTimes(1);
  });

  it("rotates both tokens and keeps the original absolute session expiry", async () => {
    const original = await service.register({ email: user.email, password });
    const saved = db.authSession.create.mock.calls[0][0].data;
    db.authSession.findUnique.mockResolvedValue({ id: "session-a", ...saved, user });
    const result = await service.refresh(original.refreshToken);
    expect(result.refreshToken).not.toBe(original.refreshToken);
    expect(result.accessToken).not.toBe(original.accessToken);
    expect(result.refreshExpiresAt).toEqual(original.refreshExpiresAt);
    expect(db.authSession.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "session-a", refreshTokenHash: digest(original.refreshToken) },
      data: { accessTokenHash: digest(result.accessToken), refreshTokenHash: digest(result.refreshToken) },
    });
  });

  it("allows only one of two concurrent refresh requests to rotate a session", async () => {
    let currentHash = digest("r".repeat(43));
    db.authSession.findUnique.mockImplementation(async () => ({
      id: "session-a", user, refreshTokenHash: currentHash,
      refreshExpiresAt: new Date(Date.now() + 60_000),
    }));
    db.authSession.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.refreshTokenHash !== currentHash) return { count: 0 };
      currentHash = data.refreshTokenHash;
      return { count: 1 };
    });
    const results = await Promise.allSettled([service.refresh("r".repeat(43)), service.refresh("r".repeat(43))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rejects expired, reused, missing and malformed refresh tokens", async () => {
    db.authSession.findUnique.mockResolvedValue({ id: "expired", user, refreshExpiresAt: new Date(Date.now() - 1) });
    await expect(service.refresh("r".repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
    db.authSession.findUnique.mockResolvedValue(null);
    await expect(service.refresh("r".repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh("malformed")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.authSession.updateMany).not.toHaveBeenCalled();
  });

  it("rejects unknown and expired access tokens and resolves a live session user", async () => {
    db.authSession.findUnique.mockResolvedValue(null);
    await expect(service.authenticate("a".repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
    db.authSession.findUnique.mockResolvedValue({ id: "session-a", user, accessExpiresAt: new Date(Date.now() - 1), refreshExpiresAt: new Date(Date.now() + 60_000) });
    await expect(service.authenticate("a".repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
    db.authSession.findUnique.mockResolvedValue({ id: "session-a", user, accessExpiresAt: new Date(Date.now() + 60_000), refreshExpiresAt: new Date(Date.now() + 120_000) });
    expect(await service.authenticate("a".repeat(43))).toEqual({ user, sessionId: "session-a" });
    expect(db.authSession.findUnique.mock.calls.at(-1)![0].where).toEqual({ accessTokenHash: digest("a".repeat(43)) });
  });

  it("deletes only the supplied refresh session and makes logout idempotent", async () => {
    await service.logout("r".repeat(43));
    expect(db.authSession.deleteMany).toHaveBeenCalledWith({ where: { refreshTokenHash: digest("r".repeat(43)) } });
    await service.logout(undefined);
    expect(db.authSession.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("keeps two users separate and revokes only the session being logged out", async () => {
    const userB = { ...user, id: "user-b", email: "second@example.com" };
    type Session = {
      id: string; userId: string; accessTokenHash: string; refreshTokenHash: string;
      accessExpiresAt: Date; refreshExpiresAt: Date;
    };
    const sessions = new Map<string, Session>();
    db.authSession.create.mockImplementation(async ({ data }: { data: Omit<Session, "id"> }) => {
      const session = { ...data, id: `session-${sessions.size}` };
      sessions.set(session.id, session);
      return session;
    });
    db.authSession.findUnique.mockImplementation(async ({ where }: { where: { accessTokenHash?: string; refreshTokenHash?: string } }) => {
      const session = [...sessions.values()].find((item) =>
        where.accessTokenHash ? item.accessTokenHash === where.accessTokenHash : item.refreshTokenHash === where.refreshTokenHash,
      );
      return session ? { ...session, user: session.userId === user.id ? user : userB } : null;
    });
    db.authSession.deleteMany.mockImplementation(async ({ where }: { where: { refreshTokenHash: string } }) => {
      let count = 0;
      for (const [id, session] of sessions) {
        if (session.refreshTokenHash === where.refreshTokenHash) { sessions.delete(id); count += 1; }
      }
      return { count };
    });
    const first = await service.register({ email: user.email, password });
    db.user.create.mockResolvedValue(userB);
    const second = await service.register({ email: userB.email, password });
    expect((await service.authenticate(first.accessToken)).user.id).toBe("user-a");
    expect((await service.authenticate(second.accessToken)).user.id).toBe("user-b");
    await service.logout(first.refreshToken);
    await expect(service.authenticate(first.accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect((await service.authenticate(second.accessToken)).user.id).toBe("user-b");
  });
});
