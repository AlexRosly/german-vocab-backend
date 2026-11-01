import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";

const user = { id: "user-a", email: "learner@example.com", emailVerified: null, interfaceLanguage: "ru", translationLanguage: "ru", role: "USER" };
const accessToken = "a".repeat(43);
const refreshToken = "r".repeat(43);
const credentials = { email: " Learner@EXAMPLE.com ", password: "A long password 123!" };

describe("Auth HTTP boundary (mocked persistence)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let auth: ReturnType<typeof makeAuth>;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousOrigin = process.env.FRONTEND_ORIGIN;

  function makeAuth() {
    const result = () => ({ user, accessToken, refreshToken, accessExpiresAt: new Date(Date.now() + 600_000), refreshExpiresAt: new Date(Date.now() + 604_800_000) });
    return {
      register: jest.fn().mockImplementation(async () => result()),
      login: jest.fn().mockImplementation(async () => result()),
      refresh: jest.fn().mockImplementation(async (token: string | undefined) => {
        if (token !== refreshToken) throw new UnauthorizedException();
        return result();
      }),
      logout: jest.fn().mockResolvedValue(undefined),
      authenticate: jest.fn().mockImplementation(async (token: string) => {
        if (token !== accessToken) throw new UnauthorizedException();
        return { user, sessionId: "session-a" };
      }),
    };
  }

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_ORIGIN = "http://localhost:3000";
    auth = makeAuth();
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(PrismaService).useValue({})
      .overrideProvider(AuthService).useValue(auth)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.enableCors({ origin: process.env.FRONTEND_ORIGIN, credentials: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/auth`;
  });

  afterEach(async () => {
    await app?.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previousOrigin;
  });

  function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("normalizes email and returns a bearer token with a scoped HttpOnly cookie", async () => {
    const response = await post("register", credentials);
    expect(response.status).toBe(201);
    expect(auth.register).toHaveBeenCalledWith(expect.objectContaining({ email: user.email, password: credentials.password }));
    const body = await response.json();
    expect(body).toMatchObject({ user, accessToken, tokenType: "Bearer" });
    expect(body).not.toHaveProperty("refreshToken");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    const cookie = response.headers.get("Set-Cookie")!;
    expect(cookie).toContain(`wortkarten_refresh=${refreshToken}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/v1/auth");
  });

  it("sets Secure on the refresh cookie in production", async () => {
    process.env.NODE_ENV = "production";
    const response = await post("login", credentials);
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("; Secure");
  });

  it("rejects role/userId injection and invalid credentials before calling the service", async () => {
    for (const body of [
      { ...credentials, role: "ADMIN" }, { ...credentials, userId: "another-user" },
      { ...credentials, email: "not-an-email" }, { ...credentials, password: "short" },
      { ...credentials, password: null }, {},
    ]) {
      expect((await post("register", body)).status).toBe(400);
    }
    expect(auth.register).not.toHaveBeenCalled();
  });

  it("protects me and uses only the user resolved by the bearer token", async () => {
    expect((await fetch(`${baseUrl}/me`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/me`, { headers: { Authorization: "Bearer invalid" } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${"b".repeat(43)}` } })).status).toBe(401);
    const response = await fetch(`${baseUrl}/me?userId=user-b`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(user);
  });

  it("refreshes only from the cookie and rejects missing, malformed and duplicate cookies", async () => {
    const response = await post("refresh", undefined, { Cookie: `unrelated=value; wortkarten_refresh=${refreshToken}` });
    expect(response.status).toBe(200);
    expect(auth.refresh).toHaveBeenCalledWith(refreshToken);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect((await post("refresh")).status).toBe(401);
    expect((await post("refresh", undefined, { Cookie: "wortkarten_refresh=%ZZ" })).status).toBe(401);
    expect((await post("refresh", undefined, { Cookie: `wortkarten_refresh=${refreshToken}; wortkarten_refresh=${refreshToken}` })).status).toBe(401);
    expect((await post("refresh", { refreshToken })).status).toBe(401);
  });

  it("rejects browser requests from another origin, including login CSRF", async () => {
    for (const path of ["register", "login", "refresh", "logout"]) {
      const response = await post(path, credentials, { Origin: "https://attacker.example", Cookie: `wortkarten_refresh=${refreshToken}` });
      expect(response.status).toBe(403);
    }
    expect(auth.register).not.toHaveBeenCalled();
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("clears the scoped cookie and makes logout repeatable", async () => {
    const response = await post("logout", undefined, { Cookie: `wortkarten_refresh=${refreshToken}` });
    expect(response.status).toBe(204);
    expect(auth.logout).toHaveBeenCalledWith(refreshToken);
    expect(response.headers.get("Set-Cookie")).toContain("wortkarten_refresh=;");
    expect(response.headers.get("Set-Cookie")).toContain("Path=/api/v1/auth");
    expect((await post("logout")).status).toBe(204);
  });

  it("limits repeated login attempts", async () => {
    auth.login.mockRejectedValue(new UnauthorizedException());
    for (let index = 0; index < 10; index += 1) {
      expect((await post("login", credentials)).status).toBe(401);
    }
    expect((await post("login", credentials)).status).toBe(429);
    expect(auth.login).toHaveBeenCalledTimes(10);
  });
});
