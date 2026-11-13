const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const monitor = require(process.env.WORTKARTEN_MONITOR_MODULE || "../scripts/check-availability.cjs");

const now = Date.parse("2026-11-13T10:00:00Z");
const id = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wortkarten-availability-"));
  const config = path.join(home, ".config/wortkarten");
  const directory = path.join(home, ".local/state/wortkarten-operations");
  fs.mkdirSync(config, { recursive: true, mode: 0o700 });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pingFile = path.join(config, "availability-ping.url");
  const stateFile = path.join(directory, "status.json");
  fs.writeFileSync(pingFile, `https://hc-ping.com/${id}\n`, { mode: 0o600 });
  const state = { version: 1, instanceId: id, pid: process.pid, updatedAt: new Date(now).toISOString(), startedAt: new Date(now - 3600000).toISOString(), starts: [new Date(now - 3600000).toISOString()], serverErrorCount: 0, lastServerErrorAt: null, lastServerErrorStatus: null };
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  save();
  return { home, pingFile, stateFile, state, save };
}
function transport(options = {}) {
  const events = [];
  const fetchImpl = async (url, request) => {
    assert.equal(request.redirect, "error");
    assert.ok(request.signal);
    if (url.startsWith("https://hc-ping.com/")) {
      assert.equal(request.body, undefined);
      events.push(url.endsWith("/fail") ? "fail" : "success");
      return new Response("", { status: options.pingStatus || 200 });
    }
    if (options.networkFailure) throw Error("secret-password from upstream");
    if (url.includes("/api/v1/health")) {
      const body = options.apiBody ?? JSON.stringify({ status: "ok", service: "german-vocab-backend", monitoring: "v1", instanceId: options.apiId || id });
      return new Response(body, { status: options.apiStatus || 200, headers: { "Cache-Control": options.cache || "no-store" } });
    }
    return new Response(options.webBody ?? "<html>Wortkarten</html>", { status: options.webStatus || 200 });
  };
  return { events, fetchImpl };
}
const run = (f, t, overrides = {}) => monitor.runCheck({ home: f.home, now, fetchImpl: t.fetchImpl, processAlive: () => true, ...overrides });

test("healthy frontend, current API instance and private state deliver a status-only success", async () => {
  const f = fixture(), t = transport();
  assert.deepEqual(await run(f, t), { ok: true, reasons: [] });
  assert.deepEqual(t.events, ["success"]);
});
test("a dead local process fails even if an edge response claims the API is healthy", async () => {
  const f = fixture(), t = transport();
  assert.ok((await run(f, t, { processAlive: () => false })).reasons.includes("api_process_missing"));
  assert.deepEqual(t.events, ["fail"]);
});
test("a stalled diagnostic heartbeat is not accepted as health", async () => {
  const f = fixture(), t = transport(); f.state.updatedAt = new Date(now - 240000).toISOString(); f.save();
  assert.ok((await run(f, t)).reasons.includes("stale_operations_state"));
});
test("recent server errors hold the check down, then recover after a quiet window", async () => {
  const f = fixture(), t = transport();
  f.state.serverErrorCount = 1; f.state.lastServerErrorAt = new Date(now - 60000).toISOString(); f.state.lastServerErrorStatus = 500; f.save();
  assert.ok((await run(f, t)).reasons.includes("recent_http_5xx"));
  f.state.updatedAt = new Date(now + 16 * 60000).toISOString(); f.save();
  assert.equal((await run(f, transport(), { now: now + 16 * 60000 })).ok, true);
});
test("repeated starts are detected, while one planned restart is allowed", async () => {
  const f = fixture(); f.state.starts = [now - 60000, now - 120000].map(v => new Date(v).toISOString()); f.save();
  assert.equal((await run(f, transport())).ok, true);
  f.state.starts.push(new Date(now - 180000).toISOString(), new Date(now - 240000).toISOString()); f.save();
  assert.ok((await run(f, transport())).reasons.includes("repeated_api_restarts"));
});
test("a proxy routed to another deployment is rejected", async () => {
  const f = fixture(), t = transport({ apiId: other });
  assert.ok((await run(f, t)).reasons.includes("api_origin_mismatch"));
  assert.deepEqual(t.events, ["fail"]);
});
test("old API versions and cacheable health responses are rejected", async () => {
  const f = fixture();
  assert.ok((await run(f, transport({ apiBody: '{"status":"ok","service":"german-vocab-backend"}' }))).reasons.includes("api_unexpected_version"));
  assert.ok((await run(f, transport({ cache: "public, max-age=300" }))).reasons.includes("api_cache_policy"));
});
test("upstream HTTP failures and malformed API JSON never become success pings", async () => {
  const f = fixture();
  for (const options of [{ apiStatus: 502 }, { apiBody: "not JSON" }, { webStatus: 503 }]) {
    const t = transport(options); assert.equal((await run(f, t)).ok, false); assert.deepEqual(t.events, ["fail"]);
  }
});
test("TLS/network failures are reported without leaking private upstream messages", async () => {
  const f = fixture(), t = transport({ networkFailure: true });
  const result = await run(f, t);
  assert.equal(result.ok, false); assert.ok(result.reasons.includes("api_unreachable"));
  assert.ok(!JSON.stringify(result).includes("secret-password"));
});
test("a branded error page or oversized API response is rejected", async () => {
  const f = fixture();
  assert.ok((await run(f, transport({ webBody: "Unrelated website" }))).reasons.includes("web_unexpected_content"));
  assert.equal((await run(f, transport({ apiBody: "x".repeat(65537) }))).ok, false);
});
test("missing or malformed local state fails observably", async () => {
  const f = fixture(); fs.writeFileSync(f.stateFile, "invalid");
  assert.ok((await run(f, transport())).reasons.includes("operations_state_unavailable"));
});
test("a malformed, insecure or foreign ping target performs no HTTP requests", async () => {
  const f = fixture();
  for (const value of [`http://hc-ping.com/${id}`, `https://example.invalid/${id}`, `https://hc-ping.com/${id}?secret=x`]) {
    fs.writeFileSync(f.pingFile, value); let calls = 0;
    const result = await monitor.runCheck({ home: f.home, fetchImpl: () => { calls++; throw Error("unexpected request"); } });
    assert.deepEqual(result.reasons, ["monitor_configuration"]); assert.equal(calls, 0);
  }
});
test("an undelivered success or redirect is an observable monitoring failure", async () => {
  const f = fixture();
  for (const pingStatus of [302, 500]) {
    const result = await run(f, transport({ pingStatus }));
    assert.equal(result.ok, false); assert.deepEqual(result.reasons, ["monitor_delivery_failed"]);
  }
});
test("future timestamps and malformed counters are not trusted", () => {
  const f = fixture();
  for (const changes of [{ updatedAt: new Date(now + 600000).toISOString() }, { serverErrorCount: -1 }, { starts: ["invalid"] }, { pid: 0 }]) {
    assert.deepEqual(monitor.snapshotReasons({ ...f.state, ...changes }, now, () => true), ["invalid_operations_state"]);
  }
});
test("configuration validation has no HTTP or mutation side effects", () => {
  const f = fixture(); const before = fs.readFileSync(f.stateFile, "utf8");
  monitor.checkConfig(f.home, now); assert.equal(fs.readFileSync(f.stateFile, "utf8"), before);
});
test("POSIX-readable-by-others ping files are refused", { skip: process.platform === "win32" }, async () => {
  const f = fixture(); fs.chmodSync(f.pingFile, 0o644);
  assert.deepEqual((await run(f, transport())).reasons, ["monitor_configuration"]);
});

test("the availability check cannot accidentally reuse the daily backup ping URL", async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.home, ".config/wortkarten/backup-ping.url"), `https://hc-ping.com/${id}`, {mode:0o600});
  let calls = 0;
  const result = await monitor.runCheck({home:f.home, fetchImpl:() => {calls++; throw Error("unexpected request");}});
  assert.deepEqual(result.reasons,["monitor_configuration"]);
  assert.equal(calls,0);
});