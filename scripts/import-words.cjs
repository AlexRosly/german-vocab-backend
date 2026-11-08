#!/usr/bin/env node
// Local operator tool. The default is an offline preview, never a DB connection.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const MAX_BYTES = 10 * 1024 * 1024;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function validator() {
  require('reflect-metadata');
  let CreateWordDto;
  try { ({ CreateWordDto } = require('../dist/words/dto/create-word.dto.js')); }
  catch { throw new Error('Сначала выполните npm run build в backend.'); }
  const { plainToInstance } = require('class-transformer');
  const { validate } = require('class-validator');
  function fields(errors, prefix = '') {
    return errors.flatMap(error => [...(error.constraints ? [prefix + error.property] : []), ...fields(error.children ?? [], prefix + error.property + '.')]);
  }
  return async value => {
    const allowed = ['german', 'article', 'grammaticalNumber', 'translation', 'translations', 'examples', 'pluralForm', 'level', 'sourceBook', 'lessonNumber', 'notes'];
    if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('В карточке есть неизвестные поля. userId, role и статус публикации задаёт только сервер.');
    const dto = plainToInstance(CreateWordDto, value);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
    if (errors.length) throw new Error('Проверьте поля: ' + [...new Set(fields(errors))].join(', '));
    // Same cross-field rule as translationEntries; null is a deletion, not an import value.
    for (const entry of [dto, ...(dto.examples ?? [])]) {
      if (entry.translation !== undefined && entry.translations?.some(row => row.language === 'ru')) throw new Error('Перевод ru указан дважды.');
      if (entry.translations?.some(row => row.text === null)) throw new Error('Для новой карточки пропустите отсутствующий перевод вместо null.');
    }
    return JSON.parse(JSON.stringify(dto));
  };
}
async function prepareBatch(input, validateWord = validator()) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1 ||
    Object.keys(input).some(key => !['schemaVersion', 'words'].includes(key)) || !Array.isArray(input.words) || input.words.length < 1 || input.words.length > 1000) {
    throw new Error('Нужен JSON { schemaVersion: 1, words: [...] }, от 1 до 1000 карточек.');
  }
  const rows = [], ids = new Set(), fingerprints = new Map(), errors = [];
  for (const [index, raw] of input.words.entries()) {
    const sourceId = raw?.sourceId ?? `row-${String(index + 1).padStart(4, '0')}`;
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof sourceId !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(sourceId) || ids.has(sourceId)) throw new Error('Нужен уникальный sourceId из букв, цифр, . _ -.');
      ids.add(sourceId);
      const { sourceId: _sourceId, ...data } = raw;
      const payload = await validateWord(data);
      // Translation order does not change a card's meaning.
      if (payload.translations) payload.translations.sort((a, b) => a.language.localeCompare(b.language));
      for (const example of payload.examples ?? []) if (example.translations) example.translations.sort((a, b) => a.language.localeCompare(b.language));
      const fingerprint = hash(canonical(payload));
      const duplicateOf = fingerprints.get(fingerprint) ?? null;
      if (!duplicateOf) fingerprints.set(fingerprint, sourceId);
      rows.push({ sourceId, fingerprint, payload, state: duplicateOf ? 'duplicate-in-file' : 'pending', ...(duplicateOf ? { duplicateOf } : {}) });
    } catch (error) { errors.push(`Строка ${index + 1}: ${error.message}`); }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { batchHash: hash(rows.map(({ sourceId, fingerprint }) => ({ sourceId, fingerprint }))), rows };
}
function validateApi(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Укажите полный --api URL, заканчивающийся на /api/v1.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol !== 'https:' && !local) || url.pathname.replace(/\/$/, '') !== '/api/v1') throw new Error('API: HTTPS или локальный HTTP, путь /api/v1, без credentials/query/hash.');
  return url.origin + '/api/v1';
}
class ImportApi {
  constructor(baseUrl, fetcher = fetch) { this.baseUrl = validateApi(baseUrl); this.fetcher = fetcher; this.token = null; this.cookie = null; this.ownerId = null; }
  async raw(route, init = {}) {
    try { return await this.fetcher(this.baseUrl + route, { ...init, redirect: 'error', signal: AbortSignal.timeout(90000) }); }
    catch { throw new Error('Сетевая ошибка или тайм-аут. Результат запроса может быть неизвестен.'); }
  }
  async auth(response) {
    if (!response.ok) throw new Error(`Авторизация не выполнена (HTTP ${response.status}).`);
    const value = await response.json().catch(() => null);
    if (!value || typeof value.accessToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.accessToken) || typeof value.user?.id !== 'string' || !value.user.id) throw new Error('Некорректный ответ авторизации.');
    if (this.ownerId && value.user.id !== this.ownerId) throw new Error('Аккаунт изменился. Импорт остановлен.');
    const cookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
    const matches = cookies.map(row => /^wortkarten_refresh=([^;]+)/.exec(row)).filter(Boolean);
    if (matches.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(matches[0][1])) throw new Error('Нет корректной refresh cookie; импорт остановлен.');
    this.ownerId = value.user.id; this.token = value.accessToken; this.cookie = `wortkarten_refresh=${matches[0][1]}`;
  }
  async login(email, password) { await this.auth(await this.raw('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })); }
  async create(payload) {
    const body = JSON.stringify(payload);
    const send = () => this.raw('/words', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` }, body });
    let response = await send();
    if (response.status === 401) { await this.auth(await this.raw('/auth/refresh', { method: 'POST', headers: { Cookie: this.cookie } })); response = await send(); }
    return response;
  }
  async close() { if (!this.cookie) return; try { const response = await this.raw('/auth/logout', { method: 'POST', headers: { Cookie: this.cookie } }); if (response.status !== 204) throw new Error('Выход импортера не подтверждён.'); } finally { this.token = this.cookie = null; } }
}
function resumeReport(prepared, previous) {
  const states = ['pending', 'created', 'duplicate', 'duplicate-in-file', 'rejected', 'in-flight', 'uncertain'];
  if (!previous || previous.version !== 1 || previous.batchHash !== prepared.batchHash || !Array.isArray(previous.rows) || previous.rows.length !== prepared.rows.length ||
    previous.rows.some((row, index) => row.sourceId !== prepared.rows[index].sourceId || row.fingerprint !== prepared.rows[index].fingerprint || !states.includes(row.state))) throw new Error('Отчёт не соответствует этому неизменённому JSON.');
  if (previous.rows.some(row => ['in-flight', 'uncertain'].includes(row.state))) throw new Error('Есть строка с неизвестным результатом. Проверьте её в приложении; автоматически повторять её нельзя.');
  return { ...previous, rows: prepared.rows.map((row, index) => ({ ...row, state: previous.rows[index].state, ...(previous.rows[index].wordId ? { wordId: previous.rows[index].wordId } : {}), ...(previous.rows[index].httpStatus ? { httpStatus: previous.rows[index].httpStatus } : {}) })) };
}
async function applyBatch(report, api, checkpoint) {
  for (const row of report.rows) {
    if (row.state !== 'pending') continue;
    row.state = 'in-flight'; await checkpoint(report);
    try {
      const response = await api.create(row.payload);
      const value = await response.json().catch(() => null);
      if (response.status === 409 && typeof value?.wordId === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(value.wordId)) {
        row.state = 'duplicate'; row.wordId = value.wordId;
      } else if (response.status === 201 && typeof value?.id === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(value.id) && value.publicationStatus === 'PENDING_REVIEW' && value.createdByUserId === api.ownerId) {
        row.state = 'created'; row.wordId = value.id;
      } else {
        row.state = response.status >= 400 && response.status < 500 ? 'rejected' : 'uncertain';
        row.httpStatus = response.status;
      }
    } catch { row.state = 'uncertain'; }
    await checkpoint(report);
    if (['uncertain', 'rejected'].includes(row.state)) break;
  }
  return report;
}
async function writeReport(filename, report) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const stored = { ...report, rows: report.rows.map(({ payload, ...row }) => ({ ...row, ...(payload ? { german: payload.german, article: payload.article } : {}) })) };
  try { await fs.writeFile(temporary, JSON.stringify(stored, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, filename); }
  finally { await fs.unlink(temporary).catch(() => {}); }
}
function summary(report) {
  const counts = {}; for (const row of report.rows) counts[row.state] = (counts[row.state] ?? 0) + 1;
  return { mode: report.mode, rows: report.rows.length, counts };
}
function args(argv) {
  const result = { apply: false, resume: false };
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (['--apply', '--resume'].includes(option)) result[option.slice(2)] = true;
    else if (['--input', '--report', '--api'].includes(option) && argv[i + 1] && !argv[i + 1].startsWith('--')) result[option.slice(2)] = argv[++i];
    else throw new Error('Параметры: --input words.json --report report.json [--api https://host/api/v1 --apply] [--resume]. Пароли в параметрах не принимаются.');
  }
  if (!result.input || !result.report) throw new Error('Обязательны --input и --report. По умолчанию выполняется только offline preview.');
  if (result.apply && !result.api) throw new Error('Для --apply укажите --api.');
  if (result.api) result.api = validateApi(result.api);
  return result;
}
async function main(argv = process.argv.slice(2), env = process.env) {
  const options = args(argv); const inputPath = path.resolve(options.input), reportPath = path.resolve(options.report);
  const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (key(inputPath) === key(reportPath)) throw new Error('JSON данных и отчёт должны быть разными файлами.');
  const stat = await fs.stat(inputPath); if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Нужен JSON-файл не более 10 MiB.');
  let input; try { input = JSON.parse((await fs.readFile(inputPath, 'utf8')).replace(/^\uFEFF/, '')); } catch { throw new Error('Не удалось разобрать JSON.'); }
  const prepared = await prepareBatch(input);
  const lockPath = reportPath + '.lock';
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Этот отчёт занят (.lock). После аварийного завершения проверьте отчёт и убедитесь, что другой импорт не запущен, прежде чем убрать lock-файл.'); throw error; }
  try {
  let previous = null;
  try { const info = await fs.lstat(reportPath); if (info.isSymbolicLink() || !info.isFile()) throw new Error('Отчёт должен быть обычным файлом.'); previous = JSON.parse(await fs.readFile(reportPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && !options.resume) throw new Error('Отчёт уже существует. Выберите новый файл или --resume для неизменённой партии.');
  if (!previous && options.resume) throw new Error('Для --resume нужен существующий отчёт.');
  const report = previous ? resumeReport(prepared, previous) : { version: 1, mode: 'preview', batchHash: prepared.batchHash, target: null, ownerId: null, rows: prepared.rows };
  const checkpoint = value => writeReport(reportPath, value);
  if (!options.apply) { await checkpoint(report); console.log(JSON.stringify(summary(report))); return; }
  if (report.target && report.target !== options.api) throw new Error('Нельзя продолжать эту партию на другом API.');
  const email = env.WORTKARTEN_IMPORT_EMAIL, password = env.WORTKARTEN_IMPORT_PASSWORD;
  if (!email || !password) throw new Error('Укажите WORTKARTEN_IMPORT_EMAIL и WORTKARTEN_IMPORT_PASSWORD в окружении. Не записывайте пароль в JSON/команду.');
  const api = new ImportApi(options.api);
  try {
    await api.login(email, password);
    if (report.ownerId && report.ownerId !== api.ownerId) throw new Error('Нельзя продолжать партию другим аккаунтом.');
    report.mode = 'apply'; report.target = options.api; report.ownerId = api.ownerId;
    await checkpoint(report); await applyBatch(report, api, checkpoint); console.log(JSON.stringify(summary(report)));
    if (report.rows.some(row => ['uncertain', 'in-flight', 'rejected', 'pending'].includes(row.state))) process.exitCode = 1;
  } finally { await api.close().catch(() => { console.error('Не удалось подтвердить выход импортера. Его вход можно завершить в настройках приложения.'); }); }
  } finally { await lock.close(); await fs.unlink(lockPath); }
}
module.exports = { prepareBatch, validateApi, ImportApi, applyBatch, resumeReport, writeReport, main, validator };
if (require.main === module) main().catch(error => { console.error(error instanceof SyntaxError ? 'Некорректный JSON отчёта.' : error.message); process.exitCode = 1; });
