"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PUBLIC_API = "https://deutsch-wortkarten.netlify.app/api/v1/health";
const PUBLIC_WEB = "https://deutsch-wortkarten.netlify.app/";

function privateFile(file, maximum = 65536) {
  for (const [item, directory] of [[path.dirname(file), true], [file, false]]) {
    const stat = fs.lstatSync(item);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.size > maximum)) throw Error("unsafe_private_file");
    if (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) throw Error("unsafe_private_file");
  }
  return fs.readFileSync(file, "utf8");
}

function readConfig(home = os.homedir()) {
  const ping = privateFile(path.join(home, ".config/wortkarten/availability-ping.url"), 128).trim();
  const prefix = "https://hc-ping.com/";
  if (!ping.startsWith(prefix) || !UUID.test(ping.slice(prefix.length))) throw Error("invalid_ping_configuration");
  const backupPingFile = path.join(home, ".config/wortkarten/backup-ping.url");
  if (fs.existsSync(backupPingFile) && privateFile(backupPingFile, 128).trim().toLowerCase() === ping.toLowerCase()) throw Error("separate_check_required");
  return { ping, stateFile: path.join(home, ".local/state/wortkarten-operations/status.json") };
}

function snapshotReasons(state, now = Date.now(), processAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } }) {
  const bad = () => ["invalid_operations_state"];
  if (!state || state.version !== 1 || !UUID.test(state.instanceId ?? "") || !Number.isSafeInteger(state.pid) || state.pid < 2 ||
      !Number.isSafeInteger(state.serverErrorCount) || state.serverErrorCount < 0 || !Array.isArray(state.starts) || state.starts.length < 1 || state.starts.length > 32) return bad();
  const time = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300000;
  if (!time(state.updatedAt) || !time(state.startedAt) || !state.starts.every(time) ||
      (state.lastServerErrorAt !== null && !time(state.lastServerErrorAt)) ||
      (state.lastServerErrorStatus !== null && (!Number.isInteger(state.lastServerErrorStatus) || state.lastServerErrorStatus < 500 || state.lastServerErrorStatus > 599))) return bad();
  const reasons = [];
  if (now - Date.parse(state.updatedAt) > 180000) reasons.push("stale_operations_state");
  if (!processAlive(state.pid)) reasons.push("api_process_missing");
  if (state.lastServerErrorAt && now - Date.parse(state.lastServerErrorAt) < 15 * 60000) reasons.push("recent_http_5xx");
  if (state.starts.filter(value => now - Date.parse(value) < 15 * 60000).length > 3) reasons.push("repeated_api_restarts");
  return reasons;
}

async function boundedText(response, limit) {
  if (!response.body) throw Error("missing_body");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw Error("oversized_body");
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => {}); }
}

async function probe(url, type, fetchImpl) {
  try {
    const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(10000), headers: { "Cache-Control": "no-cache", "User-Agent": "Wortkarten-Availability/1" } });
    if (response.status !== 200) { await response.body?.cancel().catch(() => {}); return { ok: false, reason: `${type}_http_status` }; }
    const text = await boundedText(response, type === "api" ? 65536 : 1048576);
    if (type === "web") return text.includes("Wortkarten") ? { ok: true } : { ok: false, reason: "web_unexpected_content" };
    const body = JSON.parse(text);
    if (body.status !== "ok" || body.service !== "german-vocab-backend" || body.monitoring !== "v1" || !UUID.test(body.instanceId ?? "")) return { ok: false, reason: "api_unexpected_version" };
    if (!(response.headers.get("cache-control") ?? "").toLowerCase().includes("no-store")) return { ok: false, reason: "api_cache_policy" };
    return { ok: true, instanceId: body.instanceId };
  } catch { return { ok: false, reason: `${type}_unreachable` }; }
}

async function sendPing(ping, suffix, fetchImpl) {
  try {
    const response = await fetchImpl(ping + suffix, { redirect: "error", signal: AbortSignal.timeout(10000), method: "GET" });
    await response.body?.cancel().catch(() => {});
    return response.status === 200;
  } catch { return false; }
}

async function runCheck({ home = os.homedir(), fetchImpl = fetch, now = Date.now(), processAlive } = {}) {
  let config;
  try { config = readConfig(home); } catch { return { ok: false, reasons: ["monitor_configuration"] }; }
  const reasons = [];
  let state;
  try {
    state = JSON.parse(privateFile(config.stateFile));
    reasons.push(...snapshotReasons(state, now, processAlive));
  } catch { reasons.push("operations_state_unavailable"); }
  const [api, web] = await Promise.all([probe(PUBLIC_API + `?monitor=${now}`, "api", fetchImpl), probe(PUBLIC_WEB, "web", fetchImpl)]);
  if (!api.ok) reasons.push(api.reason);
  if (!web.ok) reasons.push(web.reason);
  if (api.ok && state && api.instanceId !== state.instanceId) reasons.push("api_origin_mismatch");
  const healthy = reasons.length === 0;
  const delivered = await sendPing(config.ping, healthy ? "" : "/fail", fetchImpl);
  if (!delivered) reasons.push("monitor_delivery_failed");
  return { ok: healthy && delivered, reasons };
}

function checkConfig(home = os.homedir(), now = Date.now()) {
  const config = readConfig(home);
  const state = JSON.parse(privateFile(config.stateFile));
  if (snapshotReasons(state, now).includes("invalid_operations_state")) throw Error("invalid_operations_state");
}

module.exports = { runCheck, checkConfig, snapshotReasons, readConfig };
if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === "--check-config") {
    try { checkConfig(); console.log("Availability configuration ready; no HTTP requests performed."); }
    catch { console.error("availability_configuration_invalid: check private files and deploy the current API first"); process.exitCode = 78; }
  } else if (process.argv.length !== 2) {
    console.error("unsupported_arguments"); process.exitCode = 64;
  } else {
    runCheck().then(result => {
      console.log(JSON.stringify({ event: "wortkarten_availability", ...result }));
      process.exitCode = result.ok ? 0 : 1;
    }).catch(() => { console.error("availability_monitor_failed"); process.exitCode = 1; });
  }
}
