#!/usr/bin/env node
// Export is READ ONLY. Encrypted remote repository is initialised separately by its owner.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const backup = require('./backup-database.cjs');
const names = ['snapshot.json', 'schema.sql', 'restore-empty-database.sql', 'manifest.json'];
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
function privateFile(file) {
  if (!path.isAbsolute(file) || !fs.existsSync(file)) fail('private_file_missing');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) fail('private_file_permissions');
}
function privateRoot(root) {
  if (!path.isAbsolute(root) || path.parse(root).root === path.resolve(root)) fail('invalid_work_root');
  let existing = root;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const resolved = path.resolve(fs.realpathSync(existing), path.relative(existing, root));
  for (let current = resolved;; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git')) || current === repo) fail('work_root_inside_checkout');
    if (path.dirname(current) === current) break;
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) fail('work_root_permissions');
  return fs.realpathSync(root);
}
function configuration(env = process.env) {
  let db;
  try { db = new URL(env.DATABASE_URL); } catch { fail('database_configuration'); }
  if (!['postgresql:', 'postgres:'].includes(db.protocol) || db.hostname !== env.WORTKARTEN_BACKUP_EXPECT_HOST || (db.searchParams.get('schema') || 'public') !== 'public') fail('database_target_mismatch');
  const remote = /^rclone:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)$/.exec(env.RESTIC_REPOSITORY || '');
  if (!remote || !/^[a-f0-9]{64}$/.test(env.WORTKARTEN_BACKUP_REPOSITORY_ID || '')) fail('remote_repository_configuration');
  privateFile(env.RESTIC_PASSWORD_FILE || '');
  privateFile(env.RCLONE_CONFIG || '');
  const config = fs.readFileSync(env.RCLONE_CONFIG, 'utf8');
  const section = config.split(/\r?\n\[/).map(s => s.replace(/^\[/, '')).find(s => s.startsWith(remote[1] + ']'));
  if (!section || !/^type\s*=\s*drive\s*$/m.test(section)) fail('google_drive_remote_required');
  const job = env.WORTKARTEN_BACKUP_JOB || 'wortkarten-production';
  if (!/^[a-z0-9-]{3,60}$/.test(job)) fail('invalid_job_name');
  const ping = env.WORTKARTEN_BACKUP_HEARTBEAT_URL || '';
  if (ping && !/^https:\/\/hc-ping\.com\/[a-f0-9-]{36}$/.test(ping)) fail('invalid_heartbeat_url');
  if (!['true', 'false', undefined].includes(env.WORTKARTEN_BACKUP_RETENTION)) fail('invalid_retention_setting');
  const root = privateRoot(env.WORTKARTEN_BACKUP_ROOT || '');
  return { env, root, host: db.hostname, repositoryId: env.WORTKARTEN_BACKUP_REPOSITORY_ID, job, ping, retention: env.WORTKARTEN_BACKUP_RETENTION === 'true', restic: env.WORTKARTEN_RESTIC_BIN || 'restic' };
}
function execute(command, args, options = {}) {
  let output;
  try {
    if (options.outputFile) output = fs.openSync(options.outputFile, 'wx', 0o600);
    const result = spawnSync(command, args, { env: options.env, cwd: options.cwd, shell: false, windowsHide: true, input: options.input, stdio: ['pipe', output === undefined ? 'pipe' : output, 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60 * 1000 });
    if (result.error || result.status !== 0) fail('child_command_failed');
    return result.stdout?.toString('utf8') || '';
  } finally { if (output !== undefined) fs.closeSync(output); }
}
function verifyExport(directory, expectedHost, allowOlderTables = false) {
  const files = {};
  for (const name of names) {
    const file = path.join(directory, name);
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) fail('invalid_export_file');
    files[name] = fs.readFileSync(file, 'utf8');
  }
  const manifest = JSON.parse(files['manifest.json']);
  const snap = JSON.parse(files['snapshot.json']);
  if (manifest.version !== 1 || snap.version !== 1 || !manifest.readOnly || !snap.readOnly || manifest.host !== expectedHost || snap.host !== expectedHost) fail('export_metadata_mismatch');
  const tableNames = Object.keys(manifest.tables).sort();
  if (JSON.stringify(Object.keys(snap.data).sort()) !== JSON.stringify(tableNames) || tableNames.some(t => !backup.tables.includes(t)) || !tableNames.includes('words') || !tableNames.includes('users') || !allowOlderTables && JSON.stringify(tableNames) !== JSON.stringify([...backup.tables].sort())) fail('export_table_set_mismatch');
  for (const name of names.filter(n => n !== 'manifest.json')) if (manifest.files[name] !== digest(files[name])) fail('export_file_hash_mismatch');
  for (const table of tableNames) if (!Array.isArray(snap.data[table]) || snap.data[table].length !== manifest.tables[table].count || backup.tableHash(snap.data[table]) !== manifest.tables[table].sha256) fail('export_table_hash_mismatch');
  return { files, counts: Object.fromEntries(tableNames.map(t => [t, manifest.tables[t].count])) };
}
function writeStatus(root, name, value) {
  const temp = path.join(root, '.' + name + '.' + randomUUID());
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temp, path.join(root, name));
}
async function heartbeat(url, suffix, fetcher) {
  if (!url) return false;
  try {
    const result = await fetcher(url + suffix, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), body: 'Wortkarten database backup' });
    return result.ok;
  } catch { return false; }
}
function removeOwnWork(root, work, token) {
  // Never delete a computed path unless its resolved parent, name and marker match this run.
  if (path.dirname(work) !== root || !/^run-[a-f0-9-]{36}$/.test(path.basename(work)) || fs.lstatSync(work).isSymbolicLink() || path.dirname(fs.realpathSync(work)) !== root || fs.readFileSync(path.join(work, '.owner'), 'utf8') !== token) fail('cleanup_guard');
  fs.rmSync(work, { recursive: true });
}
async function runJob(config, dependencies = {}) {
  const run = dependencies.execute || execute, fetcher = dependencies.fetch || fetch;
  const lock = path.join(config.root, '.running');
  // Atomic mkdir; no automatic unlock or takeover of a possibly live backup.
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch { fail('backup_already_running_or_stale_lock'); }
  const token = randomUUID(), work = path.join(config.root, 'run-' + token);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  fs.mkdirSync(work, { mode: 0o700 }); fs.writeFileSync(path.join(work, '.owner'), token, { flag: 'wx', mode: 0o600 });
  let stage = 'repository', durable = false, snapshotId;
  const resticEnv = { ...config.env }; delete resticEnv.DATABASE_URL;
  const restic = (args, options = {}) => run(config.restic, args, { ...options, env: resticEnv });
  try {
    await heartbeat(config.ping, '/start', fetcher);
    const repository = JSON.parse(restic(['cat', 'config']));
    if (repository.id !== config.repositoryId) fail('remote_repository_id_mismatch');
    stage = 'export';
    const payload = path.join(work, 'payload');
    run(process.execPath, [path.join(repo, 'scripts/backup-database.cjs'), '--directory', payload, '--expect-host', config.host], { env: config.env, cwd: repo });
    stage = 'validate';
    const exported = verifyExport(payload, config.host), bundle = JSON.stringify({ version: 1, files: exported.files });
    stage = 'upload';
    const output = restic(['backup', '--json', '--host', config.job, '--tag', 'wortkarten-db', '--tag', config.job, '--stdin', '--stdin-filename', 'wortkarten-db.json'], { input: Buffer.from(bundle) });
    const summary = output.trim().split(/\r?\n/).map(line => JSON.parse(line)).find(row => row.message_type === 'summary');
    snapshotId = summary?.snapshot_id;
    if (!/^[a-f0-9]{64}$/.test(snapshotId || '')) fail('backup_snapshot_id_missing');
    stage = 'download_verify';
    const downloaded = path.join(work, 'downloaded.json');
    restic(['dump', snapshotId, '/wortkarten-db.json'], { outputFile: downloaded });
    if (digest(fs.readFileSync(downloaded)) !== digest(bundle)) fail('remote_roundtrip_mismatch');
    durable = true;
    stage = 'retention';
    if (config.retention) {
      restic(['forget', '--host', config.job, '--tag', 'wortkarten-db,' + config.job, '--group-by', 'host,tags', '--keep-daily', '14', '--keep-weekly', '8', '--keep-monthly', '6', '--prune']);
      restic(['check']);
    }
    stage = 'cleanup';
    removeOwnWork(config.root, work, token);
    stage = 'heartbeat';
    const heartbeatDelivered = await heartbeat(config.ping, '', fetcher);
    if (config.ping && !heartbeatDelivered) fail('heartbeat_delivery_failed');
    const result = { finishedAt: new Date().toISOString(), snapshotId, encryptedArchiveUploadedAndDownloaded: true, filesAndTableHashesVerified: true, databaseRestoreTested: false, retentionApplied: config.retention, heartbeatConfigured: Boolean(config.ping), heartbeatDelivered, counts: exported.counts };
    writeStatus(config.root, 'last-success.json', result);
    return result;
  } catch {
    const result = { failedAt: new Date().toISOString(), stage, encryptedArchiveVerified: durable, snapshotId: snapshotId || null };
    writeStatus(config.root, 'last-failure.json', result);
    await heartbeat(config.ping, '/fail', fetcher);
    fail('backup_failed_at_' + stage);
  } finally {
    fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock);
  }
}
async function main() {
  // Never print exception text from a storage tool: it may contain credentials/URLs.
  let code = 'backup_configuration_failed';
  try { const result = await runJob(configuration()); console.log(JSON.stringify(result)); }
  catch (error) { if (/^(backup_failed_at_[a-z_]+|backup_already_running_or_stale_lock)$/.test(error.message)) code = error.message; console.error(JSON.stringify({ ok: false, code, action: 'Inspect private last-failure.json and the deployment guide' })); process.exitCode = 1; }
}
module.exports = { configuration, privateRoot, verifyExport, runJob, execute, digest, names };
if (require.main === module) main();
