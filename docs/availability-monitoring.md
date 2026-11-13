# Мониторинг Wortkarten на VPS/Netlify

## Что проверяем

Монитор запускается на VPS от `wortkarten` каждые пять минут. Он проверяет публичные главную и `/api/v1/health` на `https://deutsch-wortkarten.netlify.app`, живой процесс backend, обновление его локального состояния, серверные HTTP 5xx и частые запуски приложения. Полученный `instanceId` связывает ответ публичного proxy с текущим процессом VPS: ответ старого Render или другого экземпляра не считается успехом.

Backend раз в минуту обновляет приватный `~/.local/state/wortkarten-operations/status.json`. В нём только технические счётчики и даты. `/health` отдаёт `Cache-Control: no-store`, статус, имя сервиса, версию мониторинга и случайный идентификатор экземпляра. В публичном ответе нет PID, счётчиков ошибок и сведений пользователей.

При перехваченной HTTP 5xx приложение записывает безопасное событие `http_server_error`: статус, метод, шаблон маршрута, случайный `requestId` и, при наличии, код Prisma вида P2021. Пароли, cookie, токены, тело запроса, значения параметров, исходное сообщение и SQL в это событие не включаются. Заголовок `X-Request-Id` помогает сопоставить ответ с событием. Обычные 400/401/403/404 не включают тревогу. Это относится к новому обработчику HTTP-ошибок; старые журналы и вывод запуска требуют отдельной осторожности.

Один HTTP 5xx удерживает проверку в состоянии ошибки 15 минут после последнего сбоя; затем возможен автоматический возврат в норму. Более трёх запусков процесса за 15 минут также вызывают тревогу. Монитор ничего не перезапускает автоматически.

Healthchecks получает только сигнал успеха или `/fail`. Если выключится VPS или перестанет запускаться сам монитор, внешний сервис заметит отсутствие сигналов. Для него нужна **отдельная проверка**, не URL ежедневного backup.

### Границы

- Это доступность приложения и контроль серверных ошибок, а не полная готовность БД: `/health` намеренно не делает регулярный SQL-запрос к Neon. Работу с данными подтверждает [приёмка релиза](release-acceptance.md).
- Получение HTML главной не проверяет исполнение JavaScript, Google-popup, озвучку и поведение Safari. Такие ошибки проверяем в браузере; автоматический сбор ошибок браузера пока не подключён.
- Состояние рассчитано на один fork-процесс `wortkarten-api`, не на cluster/несколько серверов.
- Внешние ошибки reverse proxy обнаруживаются проверкой HTTP, хотя не увеличивают внутренний счётчик Nest.

## 1. Обновить backend

Из root перейти в login-shell пользователя приложения:

```bash
sudo -iu wortkarten
cd /home/wortkarten/apps/german-vocab-backend
git status --short
git pull --ff-only
npm ci --include=dev
npm run build
npm run test:operations
```

При ошибке остановиться и разобрать её до перезапуска. Местные изменения не сбрасывать. Новых зависимостей и миграций в этом выпуске нет; `prisma migrate` не выполнять.

После успешных проверок:

```bash
pm2 restart deploy/pm2/ecosystem.config.cjs --only wortkarten-api --update-env
pm2 save
curl --fail --silent --show-error --retry 4 --retry-delay 3 --retry-connrefused \
  https://deutsch-wortkarten.netlify.app/api/v1/health
git rev-parse HEAD
```

Ожидаются `status: ok`, `monitoring: v1`, непустой `instanceId`. Экосистема устанавливает `NODE_ENV=production`, `/usr/bin/node` читает `.env` через `--env-file`. PM2 должен остаться в состоянии online. Команды выполняются только под `wortkarten`; `pm2 restart all` не использовать.

## 2. Создать отдельную проверку Healthchecks

В Healthchecks создать **Wortkarten API**, тип **Simple**, Period **5 minutes**, Grace time **5 minutes**, включить Email integration. Расписание ежедневного backup не менять. Проверить тестовое письмо через интеграцию; если оно уже принято, убедиться, что интеграция подключена и к новой проверке.

Под `wortkarten` сохранить её Ping URL скрытым вводом. URL должен иметь вид `https://hc-ping.com/<UUID>` без `/start` и `/fail`. URL, токены и `.env` в чат не присылать.

```bash
(
set -euo pipefail
umask 077
install -d -m 700 "$HOME/.config/wortkarten"
wk_cfg="$HOME/.config/wortkarten/availability-ping.url"
test ! -e "$wk_cfg"
IFS= read -r -s -p 'API Healthchecks Ping URL (hidden): ' wk_ping
printf '\n'
[[ "$wk_ping" =~ ^https://hc-ping\.com/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$ ]] || { echo INVALID_PING_URL; exit 1; }
printf '%s\n' "$wk_ping" > "$wk_cfg"
chmod 600 "$wk_cfg"
unset wk_ping
/usr/bin/node "$HOME/apps/german-vocab-backend/scripts/check-availability.cjs" --check-config
)
```

Ожидается `Availability configuration ready; no HTTP requests performed.` Проверка конфигурации не отправляет сигнал. Скрипт откажется использовать URL существующего daily backup.

## 3. Установить и проверить systemd

Вернуться в root (`exit`, если вошли через `sudo -iu wortkarten`), затем:

```bash
bash /home/wortkarten/apps/german-vocab-backend/deploy/monitoring/install-availability.sh
systemctl start wortkarten-availability.service
systemctl show wortkarten-availability.service -p Result -p ExecMainStatus
journalctl -u wortkarten-availability.service -n 15 --no-pager
```

Ожидаются `Result=success`, `ExecMainStatus=0` и `{"event":"wortkarten_availability","ok":true,"reasons":[]}`; новая проверка Healthchecks становится зелёной. Только после этого включить расписание:

```bash
systemctl enable --now wortkarten-availability.timer
systemctl is-enabled wortkarten-availability.timer
systemctl list-timers --all wortkarten-availability.timer
```

Через 5–6 минут проверить новую запись журнала и свежий ping Healthchecks. Установщик не перезаписывает существующие одноимённые units и не изменяет backup, cron или другие приложения. Сначала ручной успешный запуск, затем таймер.

Период Simple считается от последнего успеха; grace даёт запас на сеть и выполнение. Явный `/fail` сообщает сбой сразу при очередной проверке, отсутствие сигналов при выключенном VPS — после периода и grace. Письмо зависит от включённой интеграции.

## Разбор тревоги

Из root: `journalctl -u wortkarten-availability.service -n 30 --no-pager`. Под `wortkarten`: `pm2 list`, `pm2 logs wortkarten-api --err --lines 30 --nostream`. Не публиковать весь журнал: перед передачей скрыть секреты; `pm2 env`, `pm2 jlist` и dump конфигурации не нужны.

| Причина | Что проверить |
| --- | --- |
| `api_http_status`, `api_unreachable` | HTTPS, Netlify proxy, доступность VPS/backend. TLS-проверку не отключать. |
| `web_http_status`, `web_unreachable`, `web_unexpected_content` | Netlify deploy и главную сайта. |
| `api_origin_mismatch`, `api_unexpected_version` | Netlify направлен на нужный VPS; актуальный backend действительно перезапущен. |
| `api_cache_policy` | Заголовок no-store проходит через proxy, health не кэшируется. |
| `api_process_missing`, `stale_operations_state` | Процесс online, состояние обновляется, нет зависания/ошибки диска. |
| `recent_http_5xx` | Событие http_server_error и его requestId/код. Устранить причину; возврат в норму через 15 минут без 5xx. |
| `repeated_api_restarts` | Причину завершений, память, корректность конфигурации запуска; не маскировать удалением state. |
| `monitor_configuration`, `operations_state_unavailable`, `invalid_operations_state` | Пользователя/HOME, приватные файлы, режим production. Не затирать повреждённое состояние без сохранения для разбора. |
| `monitor_delivery_failed` | Исходящий HTTPS к Healthchecks и приватную настройку новой проверки. |

При диагностике 13.11 публичный Netlify route отвечал 200. Прямой запрос из локального Node к VPS с настройками TLS по умолчанию завершался handshake error; ограничение TLS 1.2 с сохранённой проверкой сертификата давало 200. Это отдельная совместимость HTTPS: сертификат не объявляем недействительным, глобальные настройки Hestia/Nginx без проверки других сайтов не меняем.

## Приёмка и источники

Код проверяется `npm run test:operations`: реальные локальные Nest/HTTP-ответы и отдельный монитор с подставленным транспортом. Проверяются сохранение 4xx-контрактов, отсутствие секретов в событиях, 5xx, сохранение состояния после рестарта, отказ на устаревший/чужой API, сетевые сбои и недоставленные сигналы. На Windows POSIX-права проверяет только последующий запуск теста на Linux.

Считаем эксплуатационную часть принятой после успешного ручного и автоматического запуска на VPS, зелёной отдельной проверки и включённых Email-уведомлений. Локальные тесты не подменяют этот результат.

Основание: [Healthchecks: расписания и grace](https://healthchecks.io/docs/configuring_checks/), [PM2: управление через ecosystem и --only](https://pm2.keymetrics.io/docs/usage/application-declaration/), [Neon: scale to zero](https://neon.com/docs/introduction/scale-to-zero).
