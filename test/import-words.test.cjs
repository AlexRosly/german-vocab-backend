const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const http = require('node:http');
const { prepareBatch, validateApi, ImportApi, applyBatch, resumeReport, writeReport } = require('../scripts/import-words.cjs');
const card = (german = 'Testwort', extras = {}) => ({ german, article: 'none', grammaticalNumber: 'not_applicable', ...extras });
const batch = (...words) => ({ schemaVersion: 1, words });
const report = prepared => ({ version: 1, mode: 'preview', ...prepared, target: null, ownerId: null });
const auth = (id = 'user-a', token = 'a', cookie = 'r') => Response.json({ accessToken: token.repeat(43), user: { id } }, { headers: { 'Set-Cookie': `wortkarten_refresh=${cookie.repeat(43)}; Path=/api/v1/auth; HttpOnly` } });

test('uses the actual compiled DTO, keeps missing translations/examples optional and normalizes input', async () => {
  const data = await prepareBatch(batch(card('  Baum  ', { article: 'der', grammaticalNumber: 'singular', translations: [{ language: ' EN ', text: ' tree ' }], examples: [{ german: ' Der Baum ist grün. ' }] })));
  assert.equal(data.rows[0].payload.german, 'Baum'); assert.deepEqual(data.rows[0].payload.translations, [{ language: 'en', text: 'tree' }]);
  assert.deepEqual(data.rows[0].payload.examples, [{ german: 'Der Baum ist grün.' }]);
  assert.equal(data.rows[0].state, 'pending'); assert.equal((await prepareBatch(batch(card()))).rows.length, 1);
});
test('rejects invalid DTO fields and publication/ownership injection before any request', async () => {
  for (const extras of [{ role: 'ADMIN' }, { userId: 'other' }, { publicationStatus: 'PUBLISHED' }, { personalNote: 'private' }, { article: 'bad' }, { grammaticalNumber: 'bad' },
    { lessonNumber: 10001 }, { german: '' }, { translations: [{ language: 'en', text: null }] }, { translation: 'ru', translations: [{ language: 'ru', text: 'again' }] },
    { examples: Array.from({ length: 21 }, () => ({ german: 'Example' })) }, { examples: [{ german: 'x'.repeat(1001) }] }]) await assert.rejects(prepareBatch(batch(card('Test', extras))));
});
test('rejects malformed batches and duplicate IDs but marks exact in-file card duplicates', async () => {
  for (const value of [[], null, {}, { schemaVersion: 2, words: [card()] }, batch(), batch(...Array.from({ length: 1001 }, () => card())),
    batch({ ...card(), sourceId: '../x' }), batch({ ...card(), sourceId: 'x' }, { ...card('second'), sourceId: 'x' })]) await assert.rejects(prepareBatch(value));
  const one = card('Test', { translations: [{ language: 'en', text: 'one' }, { language: 'de', text: 'eins' }] });
  const two = { ...one, translations: [...one.translations].reverse() };
  const prepared = await prepareBatch(batch(one, two)); assert.equal(prepared.rows[1].state, 'duplicate-in-file'); assert.equal(prepared.rows[1].duplicateOf, 'row-0001');
});
test('requires an explicit API origin with HTTPS or local HTTP and never accepts URL credentials', () => {
  assert.equal(validateApi('https://example.test/api/v1/'), 'https://example.test/api/v1'); assert.equal(validateApi('http://127.0.0.1:3101/api/v1'), 'http://127.0.0.1:3101/api/v1');
  for (const url of ['http://example.test/api/v1', 'https://a:b@example.test/api/v1', 'https://example.test/', 'https://example.test/api/v1?secret=1', 'https://example.test/api/v1#x', 'file:///api/v1']) assert.throws(() => validateApi(url));
});
test('checkpoints in-flight before each create, accepts only own pending cards and skips server duplicates', async () => {
  const data = report(await prepareBatch(batch(card('One'), card('Two'), card('Three')))); const history = []; let calls = 0;
  const api = { ownerId: 'user-a', create: async payload => { assert.equal(data.rows[calls].state, 'in-flight'); calls++;
    return calls === 2 ? Response.json({ wordId: 'existing' }, { status: 409 }) : Response.json({ id: `new-${calls}`, publicationStatus: 'PENDING_REVIEW', createdByUserId: 'user-a' }, { status: 201 }); } };
  await applyBatch(data, api, async value => history.push(structuredClone(value)));
  assert.deepEqual(data.rows.map(row => row.state), ['created', 'duplicate', 'created']); assert.equal(calls, 3); assert.equal(history.length, 6);
  assert.equal(history[0].rows[0].state, 'in-flight'); assert.equal(history[1].rows[0].state, 'created');
});
test('unknown network or 500 results stop the batch without automatic retries', async () => {
  for (const create of [async () => { throw new Error('network'); }, async () => Response.json({}, { status: 500 })]) {
    const data = report(await prepareBatch(batch(card('One'), card('Two')))); let calls = 0;
    await applyBatch(data, { ownerId: 'user-a', create: async value => { calls++; return create(value); } }, async () => {});
    assert.equal(calls, 1); assert.deepEqual(data.rows.map(row => row.state), ['uncertain', 'pending']); assert.throws(() => resumeReport(data, data));
  }
});
test('published, foreign or malformed success never appears as a successfully imported pending card', async () => {
  for (const value of [{ id: 'new', publicationStatus: 'PUBLISHED', createdByUserId: 'user-a' }, { id: 'new', publicationStatus: 'PENDING_REVIEW', createdByUserId: 'other' }, null]) {
    const data = report(await prepareBatch(batch(card())));
    await applyBatch(data, { ownerId: 'user-a', create: async () => Response.json(value, { status: 201 }) }, async () => {}); assert.equal(data.rows[0].state, 'uncertain');
  }
});
test('resumes only matching immutable data and never repeats already created rows', async () => {
  const prepared = await prepareBatch(batch(card('One'), card('Two'))); const previous = report(prepared); previous.rows[0].state = 'created'; previous.rows[0].wordId = 'old-id';
  const resumed = resumeReport(await prepareBatch(batch(card('One'), card('Two'))), JSON.parse(JSON.stringify(previous))); let calls = 0;
  await applyBatch(resumed, { ownerId: 'user-a', create: async () => { calls++; return Response.json({ id: 'second', publicationStatus: 'PENDING_REVIEW', createdByUserId: 'user-a' }, { status: 201 }); } }, async () => {});
  assert.equal(calls, 1); assert.equal(resumed.rows[0].wordId, 'old-id'); assert.throws(() => resumeReport({ ...prepared, batchHash: 'changed' }, previous));
  previous.rows[1].state = 'in-flight'; assert.throws(() => resumeReport(prepared, previous));
});
test('a 400 or a non-duplicate 409 is rejected and stops later creates', async () => {
  for (const status of [400, 409]) {
    const data = report(await prepareBatch(batch(card('One'), card('Two')))); let calls = 0;
    await applyBatch(data, { ownerId: 'user-a', create: async () => { calls++; return Response.json({ message: 'Rejected' }, { status }); } }, async () => {});
    assert.equal(calls, 1); assert.deepEqual(data.rows.map(row => row.state), ['rejected', 'pending']);
  }
});
test('an authenticated retry preserves the word body and rotates the in-memory cookie once', async () => {
  const calls = [];
  const api = new ImportApi('https://example.test/api/v1', async (url, init) => {
    assert.equal(init.redirect, 'error'); calls.push({ url, init });
    if (url.endsWith('/login')) return auth(); if (url.endsWith('/refresh')) { assert.equal(init.headers.Cookie, `wortkarten_refresh=${'r'.repeat(43)}`); return auth('user-a', 'b', 's'); }
    if (url.endsWith('/logout')) { assert.equal(init.headers.Cookie, `wortkarten_refresh=${'s'.repeat(43)}`); return new Response(null, { status: 204 }); }
    return init.headers.Authorization.endsWith('a'.repeat(43)) ? new Response(null, { status: 401 }) : Response.json({ id: 'pending' }, { status: 201 });
  });
  await api.login('a@example.test', 'secret'); await api.create(card()); await api.close();
  const posts = calls.filter(row => row.url.endsWith('/words')); assert.equal(posts.length, 2); assert.equal(posts[0].init.body, posts[1].init.body); assert.equal(api.token, null); assert.equal(api.cookie, null);
});
test('does not retry after 500 or refresh into another account', async () => {
  let posts = 0; const api = new ImportApi('https://example.test/api/v1', async url => {
    if (url.endsWith('/login')) return auth(); if (url.endsWith('/refresh')) return auth('other', 'b'); posts++; return new Response(null, { status: 401 });
  });
  await api.login('a@example.test', 'secret'); await assert.rejects(api.create(card())); assert.equal(posts, 1);
  const failing = new ImportApi('https://example.test/api/v1', async url => url.endsWith('/login') ? auth() : (++posts, new Response(null, { status: 500 })));
  await failing.login('a@example.test', 'secret'); assert.equal((await failing.create(card())).status, 500); assert.equal(posts, 2);
});
test('default CLI preview is offline, leaves input unchanged and keeps credentials out of its report', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wortkarten-import-')); const input = path.join(dir, 'input.json'), output = path.join(dir, 'report.json');
  const original = JSON.stringify(batch(card())); await fs.writeFile(input, original);
  const cli = path.resolve(__dirname, '../scripts/import-words.cjs');
  const result = spawnSync(process.execPath, [cli, '--input', input, '--report', output, '--api', 'http://127.0.0.1:1/api/v1'], { encoding: 'utf8', env: { ...process.env, WORTKARTEN_IMPORT_EMAIL: 'not-for-output@example.test', WORTKARTEN_IMPORT_PASSWORD: 'do-not-log-me' } });
  assert.equal(result.status, 0, result.stderr); const saved = await fs.readFile(output, 'utf8'); const parsed = JSON.parse(saved);
  assert.equal(parsed.mode, 'preview'); assert.equal(parsed.ownerId, null); assert.equal(parsed.rows[0].state, 'pending'); assert.equal(parsed.rows[0].payload, undefined);
  assert.equal(await fs.readFile(input, 'utf8'), original); assert.doesNotMatch(saved + result.stdout + result.stderr, /do-not-log-me|not-for-output/);
  const second = spawnSync(process.execPath, [cli, '--input', input, '--report', output], { encoding: 'utf8' }); assert.notEqual(second.status, 0); assert.equal(await fs.readFile(output, 'utf8'), saved);
  await assert.rejects(fs.stat(output + '.lock'));
});
test('report writes are atomic and retain source IDs and word IDs without repeated large payloads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wortkarten-report-')); const file = path.join(dir, 'report.json'); const data = report(await prepareBatch(batch(card())));
  await writeReport(file, data); data.rows[0].state = 'created'; data.rows[0].wordId = 'created-id'; await writeReport(file, data);
  const saved = JSON.parse(await fs.readFile(file, 'utf8')); assert.equal(saved.rows[0].wordId, 'created-id'); assert.equal(saved.rows[0].german, 'Testwort'); assert.equal(saved.rows[0].payload, undefined);
  assert.deepEqual((await fs.readdir(dir)), ['report.json']);
});
test('real CLI applies only after an explicit flag, resumes without duplicate POSTs and rejects another owner', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wortkarten-cli-')); const input = path.join(dir, 'words.json'), output = path.join(dir, 'journal.json');
  await fs.writeFile(input, JSON.stringify(batch(card('One'), card('Two'))));
  let owner = 'user-a'; const sent = [];
  const server = http.createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk; const body = text ? JSON.parse(text) : null;
    response.setHeader('Content-Type', 'application/json');
    if (request.url.endsWith('/auth/login')) {
      assert.equal(body.password, 'secret-from-env'); response.setHeader('Set-Cookie', `wortkarten_refresh=${'r'.repeat(43)}; HttpOnly; Path=/api/v1/auth`);
      response.end(JSON.stringify({ accessToken: 'a'.repeat(43), user: { id: owner } })); return;
    }
    if (request.url.endsWith('/auth/logout')) { response.writeHead(204); response.end(); return; }
    assert.equal(request.url, '/api/v1/words'); assert.equal(request.headers.authorization, `Bearer ${'a'.repeat(43)}`);
    assert.equal(body.publicationStatus, undefined); assert.equal(body.role, undefined); sent.push(body);
    response.writeHead(201); response.end(JSON.stringify({ id: `new-${sent.length}`, publicationStatus: 'PENDING_REVIEW', createdByUserId: owner }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${server.address().port}/api/v1`; const cli = path.resolve(__dirname, '../scripts/import-words.cjs');
  const run = extra => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--input', input, '--report', output, ...extra], { env: { ...process.env, WORTKARTEN_IMPORT_EMAIL: 'operator@example.test', WORTKARTEN_IMPORT_PASSWORD: 'secret-from-env' }, stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; }); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
  try {
    assert.equal((await run([])).status, 0); assert.equal(sent.length, 0);
    const applied = await run(['--apply','--resume','--api',api]); assert.equal(applied.status, 0, applied.stderr); assert.equal(sent.length, 2);
    const journal = JSON.parse(await fs.readFile(output, 'utf8')); assert.deepEqual(journal.rows.map(row => row.state), ['created','created']); assert.equal(journal.ownerId, 'user-a');
    assert.equal((await run(['--apply','--resume','--api',api])).status, 0); assert.equal(sent.length, 2);
    owner = 'user-b'; assert.notEqual((await run(['--apply','--resume','--api',api])).status, 0); assert.equal(sent.length, 2);
    assert.doesNotMatch(applied.stdout + applied.stderr + JSON.stringify(journal), /secret-from-env|operator@example.test/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('an existing report lock blocks concurrent runs without changing the journal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wortkarten-lock-')); const input = path.join(dir, 'words.json'), output = path.join(dir, 'journal.json');
  await fs.writeFile(input, JSON.stringify(batch(card()))); await fs.writeFile(output, 'existing-report'); await fs.writeFile(output + '.lock', 'owned-by-test');
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/import-words.cjs'), '--input', input, '--report', output], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.equal(await fs.readFile(output, 'utf8'), 'existing-report'); assert.equal(await fs.readFile(output + '.lock', 'utf8'), 'owned-by-test');
});

test('CLI preview accepts the whole supported translation catalog for a word and its examples', async () => {
  const { TRANSLATION_LANGUAGE_CODES } = require('../dist/languages/language-options.js');
  const translations = TRANSLATION_LANGUAGE_CODES.map(language => ({ language, text: `meaning-${language}` }));
  assert.ok(translations.length > 4);
  const prepared = await prepareBatch(batch(card('mehrsprachig', { translations, examples: [{ german: 'Wir lernen.', translations }] })));
  assert.equal(prepared.rows[0].payload.translations.length, translations.length);
  assert.equal(prepared.rows[0].payload.examples[0].translations.length, translations.length);
  assert.equal(prepared.rows[0].state, 'pending');
});


test('imports source books through the actual DTO without allowing private books or publication injection', async () => {
  const prepared = await prepareBatch(batch(card('Quelle', { sourceBook: ' B1+   Brückenkurs ' })));
  assert.equal(prepared.rows[0].payload.sourceBook, 'B1+ Brückenkurs');
  for (const extras of [{ sourceBook: 'x'.repeat(121) }, { personalBooks: ['Private course'] }, { sourceBook:'Book', publicationStatus:'PUBLISHED' }]) {
    await assert.rejects(prepareBatch(batch(card('Quelle', extras))));
  }
});
