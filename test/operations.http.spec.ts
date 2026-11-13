import "reflect-metadata";
import { Body, Controller, Get, HttpException, INestApplication, Logger, Post, ServiceUnavailableException, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { IsString } from "class-validator";
import { HealthController } from "../src/health.controller";
import { OperationsModule } from "../src/operations/operations.module";
import { OperationsStatusService } from "../src/operations/operations-status.service";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

class Input { @IsString() text!: string; }
@Controller("fixture")
class FixtureController {
  @Get("unauthorized") unauthorized() { throw new UnauthorizedException(); }
  @Get("unknown/:id") unknown() { const error = new Error("secret-password secret-token person@example.com"); Object.assign(error, { code: "P1001" }); throw error; }
  @Get("unavailable") unavailable() { throw new ServiceUnavailableException("Feature is temporarily unavailable"); }
  @Get("http-error") httpError() { throw { statusCode: 413, message: "Payload too large", expose: false }; }
  @Get("response-object") responseObject() { throw new HttpException({ statusCode: 409, message: ["conflict"], detail: "retained" }, 409); }
  @Post("validation") validation(@Body() input: Input) { return input; }
}

describe("Operations boundary", () => {
  let app: INestApplication, base: string, service: OperationsStatusService;
  let logger: jest.SpyInstance;
  beforeEach(async () => {
    delete process.env.WORTKARTEN_OPERATIONS_DIR;
    logger = jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const module = await Test.createTestingModule({ imports: [OperationsModule], controllers: [HealthController, FixtureController] }).compile();
    service = module.get(OperationsStatusService);
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  afterEach(async () => { await app?.close(); logger.mockRestore(); delete process.env.WORTKARTEN_OPERATIONS_DIR; });

  it("returns uncached liveness bound to the current process, without database traffic or private counters", async () => {
    const response = await fetch(base + "/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", service: "german-vocab-backend", monitoring: "v1", instanceId: service.snapshot().instanceId });
    expect(service.snapshot().serverErrorCount).toBe(0);
  });
  it("preserves expected authentication and validation errors without counting server failures", async () => {
    expect((await fetch(base + "/fixture/unauthorized")).status).toBe(401);
    const response = await fetch(base + "/fixture/validation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: 4, injected: "x" }) });
    expect(response.status).toBe(400);
    expect(Array.isArray((await response.json()).message)).toBe(true);
    expect(service.snapshot().serverErrorCount).toBe(0);
    expect(logger).not.toHaveBeenCalled();
  });
  it("counts unexpected 5xx and never logs secrets, request data or the actual path parameter", async () => {
    const response = await fetch(base + "/fixture/unknown/private-word-id?token=private-query", { headers: { Authorization: "Bearer private-header" } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ statusCode: 500, message: "Internal server error" });
    expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
    expect(service.snapshot()).toMatchObject({ serverErrorCount: 1, lastServerErrorStatus: 500 });
    const log = JSON.stringify(logger.mock.calls);
    for (const secret of ["secret-password", "secret-token", "person@example.com", "private-word-id", "private-query", "private-header"]) expect(log).not.toContain(secret);
    expect(log).toContain("P1001");
    expect(log).toContain("http_server_error");
  });
  it("preserves explicit 503 responses and records their server status", async () => {
    const response = await fetch(base + "/fixture/unavailable");
    expect(response.status).toBe(503);
    expect((await response.json()).message).toBe("Feature is temporarily unavailable");
    expect(service.snapshot()).toMatchObject({ serverErrorCount: 1, lastServerErrorStatus: 503 });
  });
  it("preserves http-errors status and structured HTTP responses", async () => {
    expect((await fetch(base + "/fixture/http-error")).status).toBe(413);
    expect(await (await fetch(base + "/fixture/response-object")).json()).toEqual({ statusCode: 409, message: ["conflict"], detail: "retained" });
    expect(service.snapshot().serverErrorCount).toBe(0);
  });
});

describe("Operations state persistence", () => {
  afterEach(() => { delete process.env.WORTKARTEN_OPERATIONS_DIR; });
  it("retains errors and recent starts across restarts without persisting request content", () => {
    const directory = mkdtempSync(join(tmpdir(), "wortkarten-operations-"));
    process.env.WORTKARTEN_OPERATIONS_DIR = directory;
    const first = new OperationsStatusService(); first.onModuleInit(); first.recordServerError(500); first.onModuleDestroy();
    const second = new OperationsStatusService(); second.onModuleInit();
    expect(second.snapshot().serverErrorCount).toBe(1);
    expect(second.snapshot().starts).toHaveLength(2);
    expect(second.snapshot().instanceId).not.toBe(first.snapshot().instanceId);
    expect(JSON.parse(readFileSync(join(directory, "status.json"), "utf8"))).toEqual(second.snapshot());
    second.onModuleDestroy();
  });
  it("does not overwrite a damaged previous diagnostic state or stop the API", () => {
    const directory = mkdtempSync(join(tmpdir(), "wortkarten-operations-"));
    const file = join(directory, "status.json"); writeFileSync(file, "invalid", { mode: 0o600 });
    process.env.WORTKARTEN_OPERATIONS_DIR = directory;
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const service = new OperationsStatusService();
    expect(() => service.onModuleInit()).not.toThrow(); service.recordServerError(500);
    expect(readFileSync(file, "utf8")).toBe("invalid");
    service.onModuleDestroy(); error.mockRestore();
  });
});
