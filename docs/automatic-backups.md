# Автоматические копии Wortkarten → Google Drive

> **Фактическая настройка VPS на 12.11:** владелец использует отдельный скрипт
> `backup-german-vocab.sh` (Docker pg_dump + архив проекта + rclone), а не restic
> из этого документа. Cron запустился, но upload завершился ошибкой
> `rclone: command not found`. Исправление PATH и переход существующего скрипта
> на 03:30 Europe/Berlin: [инструкция](fix-existing-backup.md).
> Сбой PATH исправлен: ручной systemd-запуск с upload завершился успешно.
> Владелец включил таймер на 03:30 Europe/Berlin (следующий запуск 13.11)
> и отключил старую cron-строку. Два варианта расписания одновременно не включать.
> Собственный Google OAuth-клиент подключён, архивы перенесены со сверкой,
> полный запуск с новым клиентом подтверждён владельцем. Первый автоматический
> запуск, [приёмка уведомлений](script-backup-monitoring.md) и внешнее
> восстановление ещё предстоят.

Подготовлено 11.11.2026. Backend работает от **wortkarten** в
`~/apps/german-vocab-backend`; приложение обновляется вручную через Git.
Этот этап не меняет PM2, данные БД или миграции. Код готов; Google Drive, пароль,
уведомления и расписание владелец подключает на VPS один раз.

## Что делает задача

1. Проверяет конкретный host текущей БД, приватные права файлов, Google Drive
   remote и закреплённый ID restic-хранилища. Одновременные запуски блокируются.
2. Снимает согласованную READ ONLY копию всех 19 таблиц приложения вместе с SQL,
   аккаунтами, переводами, примерами, связями и прогрессом.
3. Проверяет SHA-256 файлов и содержимого всех таблиц. Упаковывает четыре файла
   в JSON-контейнер, шифрует restic и отправляет через rclone в Google Drive.
4. Скачивает **точно созданный snapshot**, проверяет побайтовое совпадение.
   При разрешённой политике сохраняет 14 дневных, 8 недельных, 6 месячных точек
   этого job (группировка по host/tags, без удаления чужих групп), затем restic check.
5. Удаляет только собственную временную расшифрованную копию после успеха,
   сохраняет `last-success.json` и отправляет heartbeat, если подключён.

При сбое удалённое хранение не считается успешным. До проверки скачивания старые
точки не удаляются; локальная копия неуспешного запуска остаётся приватной.
В логах нет SQL, DATABASE_URL, OAuth-токенов, паролей и сырых ошибок rclone/restic.
`databaseRestoreTested:false` в отчёте означает именно отсутствие автоматического
SQL-восстановления: проверка архива и проверка реальной БД — разные проверки.

## 1. Обновить backend и установить инструменты

Выполнять **от wortkarten**, не в root-PM2:

```bash
cd ~/apps/german-vocab-backend
git pull --ff-only origin main
read -r WORTKARTEN_NODE < "$HOME/.config/wortkarten/node22.path"
export PATH="$HOME/.local/bin:$(dirname "$WORTKARTEN_NODE"):$PATH"
node --version
npm ci --include=dev
bash deploy/backup/install-tools.sh
```

Нужны curl, unzip, bzip2, sha256sum и openssl. При отсутствии root может установить
пакеты `curl unzip bzip2 coreutils openssl`. Установщик берёт restic **0.19.1** и
rclone **1.76.0** из официальных источников, сверяет SHA-256 и ставит только
`~/.local/bin/restic` и `~/.local/bin/rclone`. Существующие файлы не заменяет.
Временные проверенные скачивания оставляет с указанным путём.
Системный Node и процессы других приложений не меняются. Релиз приложения для
работы этих скриптов не требуется; dev-зависимость Prisma CLI нужна для SQL.

## 2. Приватные настройки и пароль

```bash
umask 077
mkdir -p "$HOME/.config/wortkarten" "$HOME/.config/rclone" "$HOME/.local/state/wortkarten-backup"
chmod 700 "$HOME/.config/wortkarten" "$HOME/.config/rclone" "$HOME/.local/state/wortkarten-backup"
if test ! -e "$HOME/.config/wortkarten/backup.env"; then
  cp deploy/backup/backup.env.example "$HOME/.config/wortkarten/backup.env"
else
  echo 'backup.env уже существует — сохраняем его'
fi
chmod 600 "$HOME/.config/wortkarten/backup.env"
```

Если backup.env уже существует, редактировать его, а не копировать поверх.
Создать пароль **только если файла ещё нет**:

```bash
if test -e "$HOME/.config/wortkarten/restic-password"; then
  echo 'Пароль уже существует — не заменять'
else
  openssl rand -base64 48 > "$HOME/.config/wortkarten/restic-password"
  chmod 600 "$HOME/.config/wortkarten/restic-password"
fi
nano "$HOME/.config/wortkarten/backup.env"
```

Сохранить пароль **также в собственном менеджере паролей вне VPS**. Без него
зашифрованную копию не восстановить. В чат/Git пароль и конфиги не отправлять.
В backup.env указать hostname той же рабочей Neon из app `.env`, без логина и
пароля. Текущая известная цель —
`ep-billowing-boat-b9g661nk-pooler.c-7.eu-central-1.aws.neon.tech`.
**DATABASE_URL не менять и не дублировать:** задача берёт её из существующего
app `.env`. Пути в env-файле должны быть полными: Node не подставляет `$HOME`.

## 3. Подключить Google Drive один раз

```bash
export RCLONE_CONFIG="$HOME/.config/rclone/rclone.conf"
rclone config
```

Создать remote **wortkarten-drive**, тип **drive**. Можно оставить client_id и
client_secret пустыми — Google-клиент Wortkarten для входа пользователей здесь
не используется. Scope выбрать **drive.file**: доступ к файлам, которые создаёт
rclone. Не выбирать read-only. Advanced config — обычно no, Shared Drive — no,
если используется обычный личный Google Drive.

На вопрос об открытии браузера на VPS ответить **n**. Rclone покажет команду
`rclone authorize ...`: её выполнить **на своём ПК с браузером**, используя
ту же версию rclone. [Windows rclone 1.76.0](https://downloads.rclone.org/v1.76.0/rclone-v1.76.0-windows-amd64.zip).
Войти в свой Google-аккаунт, выдать выбранный доступ и перенести результат только
в приглашение `config_token` в своей SSH-сессии. OAuth-токен в чат не присылать.
При непустом client_id выполнять **ровно команду, показанную конфигуратором**.

```bash
chmod 600 "$RCLONE_CONFIG"
rclone lsd wortkarten-drive:
```

При scope drive.file прежние файлы из веб-интерфейса Drive не обязаны отображаться.
Нужную папку создаст сам restic/rclone, вручную готовить её в браузере не нужно.
Не применять `rclone sync`, `purge` или очистку всей папки Drive.

## 4. Создать отдельное шифрованное хранилище

Загрузить **только backup.env**, не source-ить app `.env` как shell-скрипт:

```bash
set -a
. "$HOME/.config/wortkarten/backup.env"
set +a
restic init
restic cat config
```

`init` выполняется один раз для НОВОЙ выделенной папки
`WortkartenBackups/production`. Если хранилище уже существует, не создавать его
повторно и не менять пароль вслепую. Из `cat config` скопировать поле `id` (64 hex)
в `WORTKARTEN_BACKUP_REPOSITORY_ID` внутри backup.env.
Настройки `RETENTION=false` и пустой heartbeat на первый пробный запуск оставить.

## 5. Первый запуск и приёмка

```bash
bash deploy/backup/run-backup.sh
```

Успех — exit 0, `encryptedArchiveUploadedAndDownloaded:true`,
`filesAndTableHashesVerified:true`. Результат также в
`~/.local/state/wortkarten-backup/last-success.json`.
Флаг `databaseRestoreTested:false` нормален: процесс никогда не восстанавливает
данные в рабочую БД. Это не подтверждение SQL-восстановления.

Прочитать отдельную копию из Drive и распаковать в **новый** каталог:

```bash
set -a
. "$HOME/.config/wortkarten/backup.env"
set +a
wk_snapshot=$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.env.WORTKARTEN_BACKUP_ROOT+"/last-success.json")).snapshotId)')
wk_restore=$(mktemp -d "$HOME/.local/state/wortkarten-restore.XXXXXX")
restic dump "$wk_snapshot" /wortkarten-db.json > "$wk_restore/bundle.json"
node scripts/backup-unpack.cjs --input "$wk_restore/bundle.json" --directory "$wk_restore/extracted" --expect-host "$WORTKARTEN_BACKUP_EXPECT_HOST"
```

SQL и JSON содержат auth-хеши: не открывать доступ из web-каталога и не отправлять
их в чат. `backup-unpack` **не подключается к БД**. Для полной приёмки нужно
восстановить SQL в отдельную новую пустую тестовую PostgreSQL БД и сверить все
18 таблиц и CHECK/partial unique. Рабочую Neon для теста не использовать.
Повторять такую проверку после изменения схемы и периодически (например ежемесячно).
До полного теста восстановления не считать R02 закрытым.

## 6. Уведомления о сбое и пропуске запуска

Создать в [Healthchecks](https://healthchecks.io/) check для резервной копии:
OnCalendar `*-*-* 03:15:00 Europe/Berlin`, grace **60 минут**. Подключить свои
email/другой выбранный канал уведомлений и проверить тестовое уведомление.
Приватный ping URL `https://hc-ping.com/…` сохранить только в backup.env, поле
`WORTKARTEN_BACKUP_HEARTBEAT_URL`. Скрипт посылает start, success или fail,
без данных карточек/аккаунтов. Если VPS выключен, внешний сервис замечает
пропущенный success; локальный systemd сам о выключенном VPS сообщить не может.

После приёмки полного восстановления разрешить политику хранения:
`WORTKARTEN_BACKUP_RETENTION=true`. Перезапустить задачу вручную, проверить
`retentionApplied:true`, `heartbeatConfigured:true`, `heartbeatDelivered:true`
и зелёный check. Если heartbeat не указан, копия создаётся, но оповещение
не настроено — R02 остаётся частичным.

## 7. Включить ежедневное расписание

Из папки backend под wortkarten:

```bash
sudo env WORTKARTEN_BACKUP_USER="$(id -un)" WORTKARTEN_BACKUP_REPO="$PWD" bash deploy/backup/install-timer.sh
```

Если у wortkarten нет sudo, передать администратору команду с двумя явными
значениями: `wortkarten` и `/home/wortkarten/apps/german-vocab-backend`.
Установщик подставляет пользователя/домашний каталог/путь, проверяет unit-файлы,
создаёт **только** wortkarten-backup.service/timer и перечитывает systemd.
Существующие unit-файлы не заменяет, расписание сам **не включает**.

После принятого первого запуска:

```bash
sudo systemctl enable --now wortkarten-backup.timer
systemctl list-timers wortkarten-backup.timer
sudo systemctl start wortkarten-backup.service
sudo journalctl -u wortkarten-backup.service -n 30 --no-pager
```

Расписание: ежедневно 03:15–03:30 Europe/Berlin; Persistent выполняет пропущенную
задачу после включения VPS. Сверить первый автоматический запуск и heartbeat.
Выводить только статус/exit code/этап — сырые конфиги и токены не нужны.

## Разбор сбоев и остановка

- `last-failure.json` показывает этап: repository/export/validate/upload/
  download_verify/retention/cleanup/heartbeat. Старая last-success.json — последний
  успешный запуск, поэтому сравнивать времена обоих файлов и внешний check.
- На upload/download_verify не включать удаление старых точек. Приватный run-каталог
  остаётся на VPS; смотреть свободное место, если сбой повторяется много дней.
- При обрыве процесса/timeout может остаться `.running/owner.json`. Сначала
  убедиться через systemctl/ps, что задачи уже нет, затем администратор убирает
  **только этот** stale-lock, сохраняя run-копию. Автозахвата lock нет.
- Не менять app DATABASE_URL/ветку и не выполнять миграции для устранения ошибки
  backup. Не запускать restic init поверх рабочего хранилища, не стирать пароль.
- Остановить расписание: `sudo systemctl disable --now wortkarten-backup.timer`.
  Это не останавливает API/PM2 и не удаляет копии на Drive.

## Проверено разработчиком / что ещё требуется на VPS

17 тестов backup, включая совместимость старых архивов; реальный restic 0.19.1: синтетический export →
зашифрованное локальное хранилище → точный download → retention/check → unpack →
SQL restore в пустую PGlite БД, совпали хеши всех 18 таблиц. Bash-синтаксис проверен.
Рабочая Neon в этих тестах не менялась; Google OAuth и systemd на VPS не запускались.

R02 закрываем **после** реального upload/download Drive, SQL restore из его копии,
принятого расписания, успешного автоматического запуска и уведомления.
Мониторинг backup не заменяет отдельный uptime/readiness/error-мониторинг API (R04).

Официальные инструкции: [restic+rclone](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#other-services-via-rclone),
[restic retention](https://restic.readthedocs.io/en/stable/060_forget.html),
[Drive scopes](https://rclone.org/drive/#scopes), [headless OAuth](https://rclone.org/remote_setup/),
[heartbeat](https://healthchecks.io/docs/monitoring_cron_jobs/).
