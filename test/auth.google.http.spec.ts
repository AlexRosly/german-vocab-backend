import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { GoogleAuthService } from "../src/auth/google-auth.service";
import { PrismaService } from "../src/prisma.service";

describe("Google HTTP boundary", () => {
  let app: INestApplication, base: string, auth: any, google: any;
  const nonce = "n".repeat(43), token = "a".repeat(43);
  const identity = { subject: "123", email: "learner@gmail.com", authoritativeEmail: true };
  const user = { id: "user-a", email: identity.email, emailVerified: null, interfaceLanguage: "ru", translationLanguage: "ru", role: "USER" };
  const previousEnv = process.env.NODE_ENV, previousOrigin = process.env.FRONTEND_ORIGIN;
  beforeEach(async () => {
    process.env.NODE_ENV = "production"; process.env.FRONTEND_ORIGIN = "https://frontend.test";
    auth = {
      signInWithGoogle: jest.fn().mockResolvedValue({ user, accessToken: token, refreshToken: "r".repeat(43), accessExpiresAt: new Date(Date.now()+600000), refreshExpiresAt: new Date(Date.now()+604800000) }),
      authenticate: jest.fn(async value => { if (value !== token) throw new UnauthorizedException(); return { user, sessionId: "session-a" }; }),
      linkGoogle: jest.fn().mockResolvedValue({ connected: true }), googleAccount: jest.fn().mockResolvedValue({ connected: true }),
    };
    google = {
      config: jest.fn().mockReturnValue({ enabled: true, clientId: "123-test.apps.googleusercontent.com" }),
      issue: jest.fn().mockResolvedValue({ enabled: true, clientId: "123-test.apps.googleusercontent.com", nonce, expiresAt: new Date(Date.now()+600000) }),
      verify: jest.fn().mockResolvedValue(identity),
    };
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(PrismaService).useValue({}).overrideProvider(AuthService).useValue(auth)
      .overrideProvider(GoogleAuthService).useValue(google).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/auth/google`;
  });
  afterEach(async () => {
    await app?.close();
    if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
    if (previousOrigin === undefined) delete process.env.FRONTEND_ORIGIN; else process.env.FRONTEND_ORIGIN = previousOrigin;
  });
  function request(path = "", method = "GET", body?: unknown, headers: Record<string,string> = {}) {
    return fetch(base+path,{method,headers:{Origin:"https://frontend.test","Content-Type":"application/json",...headers},body:body===undefined?undefined:JSON.stringify(body)});
  }
  it("exposes only public configuration and sets a secure, HttpOnly, bounded challenge cookie", async () => {
    const config = await request(); expect(config.status).toBe(404);
    const res = await request("/config"); expect(await res.json()).toEqual(google.config());
    const challenge = await request("/challenge","POST"); expect(challenge.status).toBe(200);
    expect(challenge.headers.get("cache-control")).toBe("no-store");
    const cookie = challenge.headers.get("set-cookie")!;
    for (const text of [`wortkarten_google_nonce=${nonce}`,"HttpOnly","Secure","SameSite=Lax","Path=/api/v1/auth","Max-Age=600"]) expect(cookie).toContain(text);
    expect(google.issue).toHaveBeenCalledWith("login",undefined);
  });
  it("verifies a browser-bound credential and returns application session tokens with a refresh cookie", async () => {
    const res = await request("","POST",{credential:"a.b.c"},{Cookie:`wortkarten_google_nonce=${nonce}`});
    expect(res.status).toBe(200); expect(google.verify).toHaveBeenCalledWith("a.b.c",nonce,"login");
    expect(auth.signInWithGoogle).toHaveBeenCalledWith(identity);
    const body = await res.json(); expect(body.accessToken).toBe(token); expect(body.user).toEqual(user);
    expect(body).not.toHaveProperty("refreshToken"); expect(body).not.toHaveProperty("credential");
    expect(res.headers.get("set-cookie")).toContain("wortkarten_refresh=");
  });
  it("rejects role/identity injection and malformed credential bodies before verification", async () => {
    for (const body of [{credential:"a.b.c",role:"ADMIN"},{credential:"a.b.c",userId:"other"},{credential:"bad"},{credential:"a".repeat(10001)},{credential:null}]) {
      expect((await request("","POST",body)).status).toBe(400);
    }
    expect(google.verify).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes and refuses duplicate nonce cookies", async () => {
    expect((await request("/challenge","POST",undefined,{Origin:"https://evil.test"})).status).toBe(403);
    google.verify.mockRejectedValue(new UnauthorizedException());
    const res = await request("","POST",{credential:"a.b.c"},{Cookie:`wortkarten_google_nonce=${nonce}; wortkarten_google_nonce=${nonce}`});
    expect(res.status).toBe(401); expect(google.verify).toHaveBeenCalledWith("a.b.c",undefined,"login");
    expect(auth.signInWithGoogle).not.toHaveBeenCalled();
  });
  it("requires an authenticated user for account status and linking and binds challenge to that user", async () => {
    for (const [path, method] of [["/account","GET"],["/link-challenge","POST"],["/link","POST"]]) expect((await request(path,method)).status).toBe(401);
    const headers = {Authorization:`Bearer ${token}`,Cookie:`wortkarten_google_nonce=${nonce}`};
    expect((await request("/link-challenge","POST",undefined,headers)).status).toBe(200);
    expect(google.issue).toHaveBeenCalledWith("link",user.id);
    const link = await request("/link","POST",{credential:"a.b.c",password:"A long password 123!"},headers);
    expect(link.status).toBe(200); expect(await link.json()).toEqual({connected:true});
    expect(google.verify).toHaveBeenCalledWith("a.b.c",nonce,"link",user.id);
    expect(auth.linkGoogle).toHaveBeenCalledWith(user.id,identity,"A long password 123!");
    expect(link.headers.get("set-cookie")).not.toContain("wortkarten_refresh=");
  });
  it("reports an invalid Google linking token as a body error without ending the current app session", async () => {
    google.verify.mockRejectedValue(new UnauthorizedException("Повторите вход через Google"));
    const headers = {Authorization:`Bearer ${token}`,Cookie:`wortkarten_google_nonce=${nonce}`};
    expect((await request("/link","POST",{credential:"a.b.c",password:"A long password 123!"},headers)).status).toBe(403);
    expect((await request("/account","GET",undefined,headers)).status).toBe(200);
    expect(auth.linkGoogle).not.toHaveBeenCalled();
  });
});
