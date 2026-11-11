const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { configuration, runJob, digest, names } = require('../scripts/backup-offsite.cjs');
const { tables, tableHash } = require('../scripts/backup-database.cjs');
const { unpack } = require('../scripts/backup-unpack.cjs');
const secret = 'FAKE_BACKUP_SECRET_DO_NOT_PRINT';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-offsite-test-'));
  const password = path.join(root, 'password'), rclone = path.join(root, 'rclone.conf');
  fs.writeFileSync(password, secret, { mode: 0o600 });
  fs.writeFileSync(rclone, '[wk-drive]\ntype = drive\ntoken = ' + secret, { mode: 0o600 });
  const env = { ...process.env, DATABASE_URL: `postgresql://user:${secret}@db.invalid/neondb`, RESTIC_PASSWORD_FILE: password, RCLONE_CONFIG: rclone, RESTIC_REPOSITORY: 'rclone:wk-drive:WortkartenBackups/production', WORTKARTEN_BACKUP_ROOT: path.join(root, 'runs'), WORTKARTEN_BACKUP_EXPECT_HOST: 'db.invalid', WORTKARTEN_BACKUP_REPOSITORY_ID: 'a'.repeat(64), WORTKARTEN_BACKUP_RETENTION: 'true' };
  return { root, env, config: () => configuration(env), close() { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); assert.match(path.basename(root), /^wk-offsite-test-/); fs.rmSync(root, { recursive: true }); } };
}
function writeFixture(directory, host) {
  fs.mkdirSync(directory, { mode: 0o700 });
  const data = Object.fromEntries(tables.map(t => [t, []]));
  data.words = [{ id: 'test-word', german: 'Apfel', translation: 'яблоко' }];
  const files = { 'snapshot.json': JSON.stringify({ version: 1, host, readOnly: true, data }), 'schema.sql': 'CREATE TABLE test ();', 'restore-empty-database.sql': 'BEGIN; COMMIT;' };
  files['manifest.json'] = JSON.stringify({ version: 1, host, readOnly: true, files: Object.fromEntries(Object.entries(files).map(([n, v]) => [n, digest(v)])), tables: Object.fromEntries(tables.map(t => [t, { count: data[t].length, sha256: tableHash(data[t]) }])) });
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), value, { mode: 0o600 });
}
function transport(config, options = {}) {
  let bundle; const calls = [];
  const execute = (command, args, opts) => {
    calls.push(args[0]);
    if (args[0].endsWith('backup-database.cjs')) {
      writeFixture(args[args.indexOf('--directory') + 1], config.host);
      if (options.corruptExport) fs.appendFileSync(path.join(args[args.indexOf('--directory') + 1], 'schema.sql'), 'corrupt');
      return '';
    }
    assert.equal(opts.env.DATABASE_URL, undefined);
    if (options.failAt === args[0]) throw Error(secret);
    if (args[0] === 'cat') return JSON.stringify({ id: options.wrongId ? 'b'.repeat(64) : config.repositoryId });
    if (args[0] === 'backup') { bundle = opts.input; return JSON.stringify({ message_type: 'summary', snapshot_id: 'c'.repeat(64) }); }
    if (args[0] === 'dump') {
      assert.equal(args[1], 'c'.repeat(64)); assert.equal(args[2], '/wortkarten-db.json');
      fs.writeFileSync(opts.outputFile, options.corruptDownload ? 'corrupt' : bundle, { flag: 'wx', mode: 0o600 }); return '';
    }
    if (args[0] === 'forget') {
      assert.ok(calls.includes('dump')); assert.ok(args.includes('--group-by')); assert.ok(args.includes('host,tags'));
      assert.ok(args.includes('wortkarten-db,wortkarten-production')); return '';
    }
    if (args[0] === 'check') return '';
    throw Error('unexpected command');
  };
  return { execute, calls };
}
test('configuration refuses a local repository, incorrect Drive remote, wrong DB and checkout output', () => {
  const f = fixture(); try {
    const env = { ...f.env, RESTIC_REPOSITORY: f.root }; assert.throws(() => configuration(env), /remote_repository/);
    assert.throws(() => configuration({ ...f.env, WORTKARTEN_BACKUP_EXPECT_HOST: 'other.invalid' }), /database_target/);
    assert.throws(() => configuration({ ...f.env, WORTKARTEN_BACKUP_ROOT: path.resolve(__dirname, '../backups') }), /checkout/);
    fs.writeFileSync(f.env.RCLONE_CONFIG, '[wk-drive]\ntype = local\n', { mode: 0o600 }); assert.throws(f.config, /google_drive/);
  } finally { f.close(); }
});
test('success requires exact archive download and table hashes before retention and success heartbeat', async () => {
  const f = fixture(); try {
    f.env.WORTKARTEN_BACKUP_HEARTBEAT_URL = 'https://hc-ping.com/' + '12345678-1234-1234-1234-123456789012';
    const config = f.config(), t = transport(config), pings = [];
    const result = await runJob(config, { ...t, fetch: async url => { pings.push(url); return { ok: true }; } });
    assert.equal(result.encryptedArchiveUploadedAndDownloaded, true); assert.equal(result.databaseRestoreTested, false);
    assert.equal(result.heartbeatDelivered, true); assert.equal(result.counts.words, 1);
    assert.deepEqual(t.calls.slice(-3), ['dump', 'forget', 'check']); assert.ok(pings[0].endsWith('/start')); assert.ok(!pings.at(-1).endsWith('/start'));
    assert.ok(fs.existsSync(path.join(config.root, 'last-success.json'))); assert.ok(!fs.readdirSync(config.root).some(n => n.startsWith('run-')));
    assert.ok(!JSON.stringify(result).includes(secret));
  } finally { f.close(); }
});
test('incorrect repository identity stops before database export', async () => {
  const f = fixture(); try { const c = f.config(), t = transport(c, { wrongId: true }); await assert.rejects(runJob(c, t), /repository/); assert.deepEqual(t.calls, ['cat']); } finally { f.close(); }
});
for (const scenario of [{ corruptExport: true, stage: 'validate' }, { failAt: 'backup', stage: 'upload' }, { corruptDownload: true, stage: 'download_verify' }]) test('failure at ' + scenario.stage + ' preserves local recovery copy and skips retention/success', async () => {
  const f = fixture(); try {
    const c = f.config(), t = transport(c, scenario);
    await assert.rejects(runJob(c, t), new RegExp('backup_failed_at_' + scenario.stage));
    assert.ok(!t.calls.includes('forget')); assert.ok(!fs.existsSync(path.join(c.root, 'last-success.json')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(c.root, 'last-failure.json'))).stage, scenario.stage);
    assert.ok(fs.readdirSync(c.root).some(n => n.startsWith('run-'))); assert.ok(!fs.existsSync(path.join(c.root, '.running')));
  } finally { f.close(); }
});
test('an existing job lock never gets taken over or removed', async () => {
  const f = fixture(); try { const c = f.config(); fs.mkdirSync(path.join(c.root, '.running')); await assert.rejects(runJob(c), /running_or_stale_lock/); assert.ok(fs.existsSync(path.join(c.root, '.running'))); } finally { f.close(); }
});
test('retention failure reports durable archive but does not report job success', async () => {
  const f = fixture(); try {
    const c = f.config(), t = transport(c, { failAt: 'forget' }); await assert.rejects(runJob(c, t), /retention/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(c.root, 'last-failure.json'))).encryptedArchiveVerified, true);
    assert.ok(!fs.existsSync(path.join(c.root, 'last-success.json')));
  } finally { f.close(); }
});
test('lost success heartbeat fails observably without claiming unverified delivery', async () => {
  const f = fixture(); try {
    f.env.WORTKARTEN_BACKUP_HEARTBEAT_URL = 'https://hc-ping.com/12345678-1234-1234-1234-123456789012';
    const c = f.config(), t = transport(c); await assert.rejects(runJob(c, { ...t, fetch: async () => ({ ok: false }) }), /heartbeat/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(c.root, 'last-failure.json'))).encryptedArchiveVerified, true);
  } finally { f.close(); }
});
test('unpack refuses existing destinations and arbitrary filenames, verifies hashes without a DB connection', () => {
  const f = fixture(); try {
    const source = path.join(f.root, 'source'); writeFixture(source, 'db.invalid');
    const files = Object.fromEntries(names.map(n => [n, fs.readFileSync(path.join(source, n), 'utf8')]));
    const archive = path.join(f.root, 'archive.json'); fs.writeFileSync(archive, JSON.stringify({ version: 1, files }));
    assert.throws(() => unpack(archive, source, 'db.invalid'), /NEW/);
    const out = path.join(f.root, 'restore'); assert.equal(unpack(archive, out, 'db.invalid').databaseRestored, false);
    fs.writeFileSync(archive, JSON.stringify({ version: 1, files: { ...files, '../escape': 'private' } }));
    assert.throws(() => unpack(archive, path.join(f.root, 'escape'), 'db.invalid'), /format/);
    files['schema.sql'] += 'corrupted'; fs.writeFileSync(archive, JSON.stringify({ version: 1, files }));
    assert.throws(() => unpack(archive, path.join(f.root, 'corrupt'), 'db.invalid'), /hash/);
  } finally { f.close(); }
});
test('child errors cannot expose private stderr or supplied credentials', () => {
  const { execute } = require('../scripts/backup-offsite.cjs');
  assert.throws(() => execute(process.execPath, ['-e', `console.error('${secret}');process.exit(1)`]), error => error.message === 'child_command_failed' && !String(error).includes(secret));
});
