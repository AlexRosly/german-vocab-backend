# Исправление существующего backup на VPS — 12.11.2026

## Подтверждённый статус на 12.11 вечером

- Ручной запуск `wortkarten-script-backup.service`: `Result=success`,
  `ExecMainStatus=0`; журнал подтвердил dump, архив, `Upload finished`, обе
  операции ротации и `Backup completed successfully`.
- `wortkarten-script-backup.timer` включён (`enabled`). Следующий запуск,
  показанный systemd: **13.11.2026 03:30:00 CET**.
- В cron пользователя wortkarten старая строка backup закомментирована.
- Первый автоматический запуск нового timer пока ожидается. Проверка
  содержимого Drive скачиванием и восстановлением также ещё не выполнена.
- Rclone v1.76.0 предупреждает о прекращении работы общего Google Client ID
  в течение 2026 года. Следующий этап — отдельный OAuth-клиент для rclone,
  сохранение доступа к прежним копиям и повторная проверка upload/download.
  Существующий Google-вход приложения для этого не перенастраивается.

Для перехода нужно знать текущий scope, а не присылать секретный конфиг:

```bash
sudo -iu wortkarten /home/wortkarten/.local/bin/rclone config redacted wortkarten-drive | sed -n '/^scope =/p'
```

Владелец подтвердил: **`scope = drive.file`**. Эти права ограничивают доступ
файлами приложения. Существующий `wortkarten-drive` пока не переподключать:
новый OAuth-клиент подготовить в отдельном remote. Сначала скачать старые копии
через прежнее подключение и проверить загрузку/скачивание через новое;
при необходимости перенести файлы через локальную приватную папку в новую
папку Drive, созданную новым клиентом. После этого переключить backup-скрипт.
Папку прежних копий и старое подключение сохранить до проверки переноса.
Настройки доступа и root folder не менять попутно. Старый конфиг перед
авторизацией сохраняется приватно на VPS. Client Secret и OAuth token
в чат не передаются.
Не оставлять постоянный backup-клиент в Testing: grant придётся обновлять
еженедельно. Шаги подготовки собственного клиента описаны в
[официальной инструкции rclone](https://rclone.org/drive/#making-your-own-client-id).
Ограничения `drive.file`: [документация Google](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Подтверждённая причина

Cron пользователя `wortkarten` запустился 12.11 в 03:30 по серверу (13:30
Europe/Berlin), создал PostgreSQL dump через Docker postgres:18 и архив проекта.
Загрузка остановилась на `rclone: command not found`. Установленный rclone:
`/home/wortkarten/.local/bin/rclone`; его каталог отсутствует в стандартном PATH cron.

Ниже используется **существующий** `/home/wortkarten/scripts/backup-german-vocab.sh`.
Его dump, архив проекта, Google Drive и ротация остаются в этом скрипте.
Сценарий restic из `automatic-backups.md` — отдельный вариант, его не включать параллельно.
Содержимое существующего скрипта разработчиком пока не проверено: успешный exit code
нужно сопоставлять с логом и фактическими файлами на Drive.

## 1. Установить и проверить запуск

Команды из `root`:

```bash
sudo -iu wortkarten git -C /home/wortkarten/apps/german-vocab-backend pull --ff-only
bash /home/wortkarten/apps/german-vocab-backend/deploy/backup/install-script-timer.sh
systemctl start wortkarten-script-backup.service
systemctl show wortkarten-script-backup.service -p Result -p ExecMainStatus
journalctl -u wortkarten-script-backup.service -n 50 --no-pager
```

Установщик проверяет пользователя, пути, доступность rclone с ограниченным окружением,
синтаксис существующего скрипта, календарь и unit-файлы. Отказывается перезаписывать
существующие units или устанавливать второй таймер рядом с `wortkarten-backup`.
Приложение и PM2 перезапускать не требуется. Cron пока остаётся без изменений,
новый timer не включается автоматически. Ручная проверка создаст новую полную пару
копий и выполнит настроенную в существующем скрипте ротацию.

Нужны `Result=success`, `ExecMainStatus=0`, успешная загрузка в журнале и новая пара
файлов на Google Drive. Если команда завершилась ошибкой, остановиться на этом шаге:
не выключать старое расписание и не включать новый timer.

## 2. Переключить расписание после успешной проверки

Сначала сохранить cron (в нём могут находиться другие задачи), затем закомментировать
**только** строку запуска `/home/wortkarten/scripts/backup-german-vocab.sh`:

```bash
install -d -m 700 /root/wortkarten-backup-config
(umask 077; sudo -u wortkarten crontab -l > /root/wortkarten-backup-config/crontab.before-systemd)
sudo -u wortkarten crontab -e
```

Строка после редактирования:

```cron
# 30 3 * * * /home/wortkarten/scripts/backup-german-vocab.sh >> /home/wortkarten/backups/german-vocab-backend/cron.log 2>&1
```

Убедиться, что именно эта строка закомментирована, а другие задачи сохранены:

```bash
sudo -u wortkarten crontab -l
systemctl enable --now wortkarten-script-backup.timer
systemctl list-timers --all wortkarten-script-backup.timer
systemctl is-enabled wortkarten-script-backup.timer
```

Новый запуск — ежедневно **03:30 Europe/Berlin**, включая переход летнего/зимнего
времени. Системный часовой пояс не меняется. `Persistent=true` позволяет выполнить
пропущенный запуск после включения VPS. Вывод `list-timers` может показывать время
в часовом поясе сервера: зимой берлинские 03:30 — предыдущий день 17:30 UTC−9,
летом — предыдущий день 16:30 UTC−9. Нельзя одновременно оставлять два расписания.

Следующее утро проверить журнал с берлинским отображением времени:

```bash
TZ=Europe/Berlin journalctl -u wortkarten-script-backup.service --since '24 hours ago' --no-pager
systemctl show wortkarten-script-backup.service -p Result -p ExecMainStatus
```

Новые логи находятся в journal, прежний `cron.log` остаётся историей старого запуска.

## Что ещё нужно для закрытия R02

Принять первый автоматический запуск timer; заменить общий Google Client ID; независимое уведомление
при ошибке/пропуске backup; скачивание пары из Drive и восстановление dump в отдельный
PostgreSQL (не в рабочую Neon). Для настройки проверки/уведомлений сначала нужен
существующий скрипт с удалёнными секретами, чтобы проверять успех после обоих upload
и не слать ложный success после подавленной ошибки.

Проверка расписания не подтверждает шифрование существующих файлов на Drive,
правильность ротации или пригодность dump к восстановлению.

Откат расписания: выключить только `wortkarten-script-backup.timer`, затем вернуть
строку backup через `sudo -u wortkarten crontab -e`. Другие cron-задачи и приложения
не менять. Это вернёт прежний PATH/часовой пояс, поэтому откат — временная мера.

Официальная документация: [окружение cron](https://manpages.ubuntu.com/manpages/focal/man5/crontab.5.html),
[календарь systemd](https://manpages.ubuntu.com/manpages/focal/man7/systemd.time.7.html),
[Persistent timer](https://manpages.ubuntu.com/manpages/focal/man5/systemd.timer.5.html).
