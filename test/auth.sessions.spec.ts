import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { AuthModule } from "../src/auth/auth.module";
import { PrismaService } from "../src/prisma.service";
import { AuthService } from "../src/auth/auth.service";
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const user = (id: string) => ({ id, email: `${id}@example.test`, emailVerified: null, interfaceLanguage: "ru", translationLanguage: "en", role: id === "admin" ? "ADMIN" : "USER" });
type Row = ReturnType<typeof seed>;
function seed(id: string, userId: string, token: string, refresh = token.toUpperCase(), expired = false) {
  return { id, userId, user: user(userId), accessTokenHash: digest(token.repeat(43)), refreshTokenHash: digest(refresh.repeat(43)),
    createdAt: new Date("2026-01-01T12:00:00Z"), updatedAt: new Date("2026-02-01T12:00:00Z"),
    accessExpiresAt: new Date(Date.now() + 600000), refreshExpiresAt: new Date(Date.now() + (expired ? -1 : 6000000)) };
}
describe("Account sessions (real auth service, in-memory Prisma)", () => {
  let app: INestApplication; let url: string; let rows: Map<string, Row>; let db: any;
  const previousOrigin = process.env.FRONTEND_ORIGIN;
  beforeEach(async () => {
    process.env.FRONTEND_ORIGIN = "http://localhost:3000";
    rows = new Map([seed("current", "a", "a"), seed("other", "a", "b"), seed("foreign", "b", "c"), seed("admin", "admin", "d"), seed("expired", "a", "e", "E", true)].map((row) => [row.id, row]));
    const matches = (row: any, where: any = {}) => Object.entries(where).every(([key, value]: [string, any]) => {
      if (value && typeof value === "object") { if (value.gt) return row[key] > value.gt; if (value.not) return row[key] !== value.not; }
      return row[key] === value;
    });
    const project = (row: any, select: any) => row && select ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]])) : row;
    db = { authSession: {
      findUnique: jest.fn(async ({ where, select }) => project([...rows.values()].find((row) => matches(row, where)), select) ?? null),
      findFirst: jest.fn(async ({ where, select }) => project([...rows.values()].find((row) => matches(row, where)), select) ?? null),
      findMany: jest.fn(async ({ where, select, take }) => [...rows.values()].filter((row) => matches(row, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).slice(0, take).map((row) => project(row, select))),
      deleteMany: jest.fn(async ({ where }) => { let count = 0; for (const [id, row] of rows) if (matches(row, where)) { rows.delete(id); count++; } return { count }; }),
      updateMany: jest.fn(async ({ where, data }) => { let count = 0; for (const row of rows.values()) if (matches(row, where)) { Object.assign(row, data); count++; } return { count }; }),
    }, $transaction: jest.fn() };
    db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(db));
    const module = await Test.createTestingModule({ imports: [AuthModule] }).overrideProvider(PrismaService).useValue(db).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1"); url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/auth`;
  });
  afterEach(async () => { await app?.close(); if (previousOrigin === undefined) delete process.env.FRONTEND_ORIGIN; else process.env.FRONTEND_ORIGIN = previousOrigin; });
  const request = (path: string, method = "GET", token = "a", origin = "http://localhost:3000") => fetch(url + path, { method, headers: { Authorization: token ? `Bearer ${token.repeat(43)}` : "", Origin: origin } });
  it("requires a valid bearer session for listing and revocation", async () => {
    for (const [path, method] of [["/sessions", "GET"], ["/sessions/other", "DELETE"], ["/logout-all", "POST"]]) expect((await request(path, method, "")).status).toBe(401);
    expect(db.authSession.deleteMany).not.toHaveBeenCalled();
  });
  it("lists only live own metadata, marks current and never returns tokens or identity", async () => {
    const response = await request("/sessions?userId=b"); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.hasMore).toBe(false); expect(body.sessions.map((row: { id: string }) => row.id)).toEqual(["current", "other"]);
    expect(body.sessions.map((row: { current: boolean }) => row.current)).toEqual([true, false]);
    expect(Object.keys(body.sessions[0]).sort()).toEqual(["createdAt", "current", "id", "refreshExpiresAt", "updatedAt"]);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  });
  it("bounds other sessions to 100 while always including the current session", async () => {
    for (let i = 0; i < 110; i++) { const row = seed(`recent-${i}`, "a", "z"); rows.set(row.id, row); }
    const body = await (await request("/sessions")).json();
    expect(body.sessions).toHaveLength(101); expect(body.sessions[0]).toMatchObject({ id: "current", current: true }); expect(body.hasMore).toBe(true);
    expect(db.authSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101, select: { id: true, createdAt: true, updatedAt: true, refreshExpiresAt: true } }));
  });
  it("revokes one own session and immediately invalidates both tokens, preserving others", async () => {
    const response = await request("/sessions/other", "DELETE"); expect(response.status).toBe(204); expect(response.headers.get("set-cookie")).toBeNull();
    expect(rows.has("other")).toBe(false); expect(rows.has("current")).toBe(true); expect(rows.has("foreign")).toBe(true);
    expect((await request("/me", "GET", "b")).status).toBe(401);
    expect((await fetch(url + "/refresh", { method: "POST", headers: { Cookie: `wortkarten_refresh=${"B".repeat(43)}` } })).status).toBe(401);
    expect((await request("/sessions/other", "DELETE")).status).toBe(204);
  });
  it("never revokes a foreign session, even as ADMIN, with the same idempotent response", async () => {
    for (const token of ["a", "d"]) for (const id of ["foreign", "missing"]) expect((await request(`/sessions/${id}`, "DELETE", token)).status).toBe(204);
    expect(rows.has("foreign")).toBe(true); expect((await request("/me", "GET", "c")).status).toBe(200);
  });
  it("clears the scoped cookie when revoking the current session", async () => {
    const response = await request("/sessions/current", "DELETE"); expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("wortkarten_refresh=;"); expect(response.headers.get("set-cookie")).toContain("Path=/api/v1/auth");
    expect((await request("/me")).status).toBe(401);
  });
  it("logout-all revokes every own row including expired ones, without touching other users", async () => {
    const response = await request("/logout-all", "POST"); expect(response.status).toBe(204); expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect([...rows.keys()].sort()).toEqual(["admin", "foreign"]);
    expect((await request("/me")).status).toBe(401); expect((await request("/me", "GET", "b")).status).toBe(401);
    expect((await request("/me", "GET", "c")).status).toBe(200);
  });
  it("blocks cross-origin revocation and invalid IDs before deleting", async () => {
    for (const [path, method] of [["/sessions/other", "DELETE"], ["/logout-all", "POST"]]) expect((await request(path, method, "a", "https://attacker.example")).status).toBe(403);
    expect((await request("/sessions/" + "x".repeat(129), "DELETE")).status).toBe(400);
    expect(db.authSession.deleteMany).not.toHaveBeenCalled();
  });
  it("a refresh which read the session before revocation cannot restore it", async () => {
    let release: () => void = () => {}; let started: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; }); const read = new Promise<void>((resolve) => { started = resolve; });
    const original = db.authSession.findUnique.getMockImplementation();
    db.authSession.findUnique.mockImplementation(async (args: { where: { refreshTokenHash?: string } }) => { const row = await original(args); if (args.where.refreshTokenHash) { started(); await gate; } return row && { ...row }; });
    const service = app.get(AuthService); const pending = service.refresh("B".repeat(43)); await read;
    await service.logoutAll("a"); release(); await expect(pending).rejects.toThrow(); expect(rows.has("other")).toBe(false);
  });
});
