import { ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { OAuth2Client, LoginTicket } from "google-auth-library";
import { createHash } from "node:crypto";
import { hash } from "bcrypt";
import { Prisma } from "@prisma/client";
import { GoogleAuthService } from "../src/auth/google-auth.service";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";

const clientId = "123-test.apps.googleusercontent.com";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const identity = { subject: "123456789", email: "learner@gmail.com", authoritativeEmail: true };
const user = { id: "user-a", email: identity.email, emailVerified: null, role: "ADMIN" as const, interfaceLanguage: "de", translationLanguage: "uk" };

describe("Google ID verification and single-use login challenges", () => {
  let service: GoogleAuthService;
  let rows: Map<string, any>;
  let db: any;
  let verify: jest.SpyInstance;
  let payload: Record<string, unknown>;
  const previous = process.env.GOOGLE_CLIENT_ID;
  const previousEnabled = process.env.GOOGLE_AUTH_ENABLED;
  beforeEach(() => {
    process.env.GOOGLE_AUTH_ENABLED = "true";
    process.env.GOOGLE_CLIENT_ID = clientId;
    rows = new Map();
    db = { googleAuthChallenge: {
      create: jest.fn(async ({ data }) => { rows.set(data.nonceHash, { ...data }); return data; }),
      deleteMany: jest.fn(async ({ where }) => {
        let count = 0;
        for (const [key, value] of rows) {
          if (where.nonceHash !== undefined && key !== where.nonceHash) continue;
          if (where.purpose !== undefined && value.purpose !== where.purpose) continue;
          if (Object.hasOwn(where, "userId") && value.userId !== where.userId) continue;
          if (where.expiresAt?.gt && value.expiresAt <= where.expiresAt.gt) continue;
          if (where.expiresAt?.lte && value.expiresAt > where.expiresAt.lte) continue;
          rows.delete(key); count++;
        }
        return { count };
      }),
    } };
    payload = { sub: identity.subject, email: identity.email, email_verified: true };
    verify = jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockImplementation(async () => ({ getPayload: () => payload }) as unknown as LoginTicket);
    service = new GoogleAuthService(db as PrismaService);
  });
  afterEach(() => {
    verify.mockRestore();
    if (previous === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = previous;
    if (previousEnabled === undefined) delete process.env.GOOGLE_AUTH_ENABLED; else process.env.GOOGLE_AUTH_ENABLED = previousEnabled;
  });

  it("stores a hash of an expiring nonce and verifies the exact client audience before consuming it once", async () => {
    const challenge = await service.issue("login"); payload.nonce = challenge.nonce;
    expect(challenge.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rows.has(digest(challenge.nonce))).toBe(true);
    expect([...rows.values()][0]).not.toHaveProperty("nonce");
    expect(challenge.expiresAt.getTime() - Date.now()).toBeGreaterThan(590000);
    expect(await service.verify("signed.jwt.token", challenge.nonce, "login")).toEqual(identity);
    expect(verify).toHaveBeenCalledWith({ idToken: "signed.jwt.token", audience: clientId });
    await expect(service.verify("signed.jwt.token", challenge.nonce, "login")).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it("binds linking to the current user and prevents using a login challenge for linking", async () => {
    const login = await service.issue("login"); payload.nonce = login.nonce;
    await expect(service.verify("jwt", login.nonce, "link", user.id)).rejects.toBeInstanceOf(UnauthorizedException);
    const link = await service.issue("link", user.id); payload.nonce = link.nonce;
    await expect(service.verify("jwt", link.nonce, "link", "other-user")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await service.verify("jwt", link.nonce, "link", user.id)).toEqual(identity);
  });
  it("rejects expired, missing, malformed and mismatched nonce values", async () => {
    const challenge = await service.issue("login");
    payload.nonce = challenge.nonce;
    rows.get(digest(challenge.nonce)).expiresAt = new Date(Date.now() - 1);
    await expect(service.verify("jwt", challenge.nonce, "login")).rejects.toBeInstanceOf(UnauthorizedException);
    for (const value of [undefined, "bad", "x".repeat(44)]) await expect(service.verify("jwt", value, "login")).rejects.toBeInstanceOf(UnauthorizedException);
    const fresh = await service.issue("login");
    for (const nonce of ["x".repeat(43), "я".repeat(43), null]) {
      payload.nonce = nonce;
      await expect(service.verify("jwt", fresh.nonce, "login")).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });
  it("rejects unsigned/wrong-audience/expired tokens through the verifier and rejects incomplete claims", async () => {
    const challenge = await service.issue("login"); payload.nonce = challenge.nonce;
    verify.mockRejectedValueOnce(new Error("Invalid signature or audience"));
    await expect(service.verify("bad.jwt.token", challenge.nonce, "login")).rejects.toBeInstanceOf(UnauthorizedException);
    for (const patch of [{ email_verified: false }, { email: "not-an-email" }, { sub: "bad/sub" }, { sub: "" }]) {
      const old = payload; payload = { ...payload, ...patch };
      await expect(service.verify("jwt", challenge.nonce, "login")).rejects.toBeInstanceOf(UnauthorizedException);
      payload = old;
    }
    expect(rows.size).toBe(1);
  });
  it("does not mark a third-party email as app-verified merely because Google once verified it", async () => {
    const challenge = await service.issue("login");
    payload = { ...payload, nonce: challenge.nonce, email: "learner@example.com" };
    expect((await service.verify("jwt", challenge.nonce, "login")).authoritativeEmail).toBe(false);
    const next = await service.issue("login"); payload = { ...payload, nonce: next.nonce, hd: "example.com" };
    expect((await service.verify("jwt", next.nonce, "login")).authoritativeEmail).toBe(true);
  });
  it("stays disabled without a valid client ID and performs no database writes", async () => {
    for (const value of [undefined, "", "https://evil.test/client"]) {
      if (value === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = value;
      expect(service.config()).toEqual({ enabled: false });
      await expect(service.issue("login")).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
    expect(db.googleAuthChallenge.create).not.toHaveBeenCalled();
  });
  it("does not enable an unmigrated deployment merely because its Client ID is configured", async () => {
    for (const flag of [undefined, "", "false", "1", "TRUE"]) {
      if (flag === undefined) delete process.env.GOOGLE_AUTH_ENABLED; else process.env.GOOGLE_AUTH_ENABLED = flag;
      expect(service.config()).toEqual({ enabled: false });
      await expect(service.issue("login")).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
    expect(db.googleAuthChallenge.create).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("Google accounts and explicit linking", () => {
  let auth: AuthService;
  let db: any;
  const password = "A long password 123!";
  let passwordHash: string;
  beforeAll(async () => { passwordHash = await hash(password, 12); });
  beforeEach(() => {
    db = {
      user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ ...user, role: "USER" }), update: jest.fn() },
      account: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      authSession: { create: jest.fn().mockResolvedValue({}) }, $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation((callback: (tx: any) => unknown) => callback(db));
    auth = new AuthService(db as PrismaService);
  });
  it("creates an ordinary Google user and hashes only the application's session tokens", async () => {
    const result = await auth.signInWithGoogle(identity);
    const data = db.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ email: identity.email, role: "USER", accounts: { create: { provider: "GOOGLE", providerAccountId: identity.subject } } });
    expect(data.emailVerified).toBeInstanceOf(Date);
    expect(data.accounts.create).not.toHaveProperty("passwordHash");
    expect(db.authSession.create.mock.calls[0][0].data).toMatchObject({ userId: user.id, accessTokenHash: digest(result.accessToken), refreshTokenHash: digest(result.refreshToken) });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("uses the stable provider subject and preserves an existing user's role and preferences", async () => {
    db.account.findUnique.mockResolvedValue({ user });
    const result = await auth.signInWithGoogle({ ...identity, email: "changed@gmail.com" });
    expect(result.user).toEqual(user);
    expect(db.user.create).not.toHaveBeenCalled(); expect(db.user.update).not.toHaveBeenCalled();
    expect(db.account.findUnique.mock.calls[0][0].where.provider_providerAccountId).toEqual({ provider: "GOOGLE", providerAccountId: identity.subject });
  });
  it("never auto-links a registered email or issues a session for it", async () => {
    db.user.findFirst.mockResolvedValue({ id: "existing-admin" });
    await expect(auth.signInWithGoogle(identity)).rejects.toBeInstanceOf(ConflictException);
    expect(db.user.create).not.toHaveBeenCalled(); expect(db.account.create).not.toHaveBeenCalled(); expect(db.authSession.create).not.toHaveBeenCalled();
  });
  it("keeps third-party email unverified in the app", async () => {
    await auth.signInWithGoogle({ ...identity, authoritativeEmail: false });
    expect(db.user.create.mock.calls[0][0].data.emailVerified).toBeNull();
  });
  it("resolves a concurrent first Google registration by looking up the provider again", async () => {
    db.account.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ user });
    db.user.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3" }));
    expect((await auth.signInWithGoogle(identity)).user.id).toBe(user.id);
    expect(db.user.create).toHaveBeenCalledTimes(1); expect(db.authSession.create).toHaveBeenCalledTimes(1);
  });
  it("links only after the current account's password is confirmed, without altering its identity or sessions", async () => {
    db.account.findFirst.mockResolvedValueOnce({ passwordHash }).mockResolvedValue(null);
    expect(await auth.linkGoogle(user.id, identity, password)).toEqual({ connected: true });
    expect(db.account.create).toHaveBeenCalledWith({ data: { userId: user.id, provider: "GOOGLE", providerAccountId: identity.subject } });
    expect(db.user.update).not.toHaveBeenCalled(); expect(db.authSession.create).not.toHaveBeenCalled();
  });
  it("rejects a wrong or absent password credential without linking", async () => {
    db.account.findFirst.mockResolvedValue({ passwordHash });
    await expect(auth.linkGoogle(user.id, identity, "An incorrect password")).rejects.toBeInstanceOf(ForbiddenException);
    db.account.findFirst.mockResolvedValue(null);
    await expect(auth.linkGoogle(user.id, identity, password)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.account.create).not.toHaveBeenCalled();
  });
  it("cannot move another user's Google account or replace an already linked provider", async () => {
    db.account.findFirst.mockResolvedValue({ passwordHash });
    db.account.findUnique.mockResolvedValue({ userId: "other-user" });
    await expect(auth.linkGoogle(user.id, identity, password)).rejects.toBeInstanceOf(ConflictException);
    db.account.findUnique.mockResolvedValue(null);
    db.account.findFirst.mockResolvedValueOnce({ passwordHash }).mockResolvedValueOnce({ id: "existing-google" });
    await expect(auth.linkGoogle(user.id, identity, password)).rejects.toBeInstanceOf(ConflictException);
    expect(db.account.create).not.toHaveBeenCalled();
  });
  it("confirms the same link idempotently and exposes no provider identifiers in its status", async () => {
    db.account.findFirst.mockResolvedValue({ passwordHash }); db.account.findUnique.mockResolvedValue({ userId: user.id });
    expect(await auth.linkGoogle(user.id, identity, password)).toEqual({ connected: true });
    expect(db.account.create).not.toHaveBeenCalled();
    expect(await auth.googleAccount(user.id)).toEqual({ connected: true });
  });
});
