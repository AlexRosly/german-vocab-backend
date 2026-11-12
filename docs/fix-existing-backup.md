# Исправление существующего backup на VPS — 12.11.2026

## Подтверждённый статус на 12.11 вечером

**Обновление:** владелец подтвердил `SCRIPT_SWITCHED` и полный успешный запуск
через собственный Google-клиент. Последний запуск 12.11 в 21:32:17–21:32:31
Europe/Berlin (в журнале VPS 11:32 UTC−9): dump, архив, upload, ротация,
`Result=success`, `ExecMainStatus=0`; нового предупреждения об общем client_id нет.
Старые предупреждения в journal относятся к прошлому запуску.
Повторять замену REMOTE ниже не нужно — этап пройден.
[Обёртка уведомлений](script-backup-monitoring.md) установлена владельцем:
полный backup и доставка success подтверждены, Healthchecks зелёный.
Расписание Healthchecks также подтверждено скриншотом: Cron `30 3 * * *`,
Europe/Berlin, grace 1 час. Владелец подтвердил получение тестового письма.
Настройка и доставка уведомлений приняты. Остался первый автоматический запуск;
восстановление внешней копии отложено.

- Ручной запуск `wortkarten-script-backup.service`: `Result=success`,
  `ExecMainStatus=0`; журнал подтвердил dump, архив, `Upload finished`, обе
  операции ротации и `Backup completed successfully`.
- `wortkarten-script-backup.timer` включён (`enabled`). Следующий запуск,
  показанный systemd: **13.11.2026 03:30:00 CET**.
- В cron пользователя wortkarten старая строка backup закомментирована.
- Первый автоматический запуск нового timer пока ожидается. Проверка
  содержимого Drive скачиванием и восстановлением также ещё не выполнена.
- Общий Google Client ID заменён собственным Desktop-клиентом в In production.
  В новом запуске предупреждения rclone о retirement нет. Прежнее подключение
  и оригиналы архивов сохранены; четыре архива перенесены со сверкой содержимого.
  Google-вход приложения при переключении резервирования не перенастраивался.

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

## Собственный OAuth-клиент: перенос подтверждён

Владелец перевёл проект Google OAuth в In production, создал отдельный Desktop
client и сохранил новое подключение `wortkarten-drive-own` с `drive.file`.
Проверочный файл прошёл upload → download → `cmp` (`UPLOAD_DOWNLOAD_OK`).
Старые архивы скопированы через приватную папку VPS в
`wortkarten-drive-own:WortkartenBackups-own/production`.
Проверки `rclone check --download` подтвердили **4 matching files, 0 differences**
для старого Drive → локальная копия и локальная копия → новый Drive.
Это проверка содержимого файлов, ещё не восстановление PostgreSQL.

Команды рабочего скрипта проверены: загрузка идёт в `$REMOTE/database` и
`$REMOTE/project`; ротация ограничена этими папками с `--min-age 30d`.
`rmdirs "$REMOTE" --leave-root` убирает пустые вложенные папки этого назначения.
Общий родитель с тестовыми файлами в назначение production не входит.
Исходное подключение и его архивы сохраняются.

### Следующий шаг: заменить только REMOTE

Этот этап **выполнен владельцем** и сохранён ниже как порядок переключения.
На текущем VPS повторять блок не нужно. Для аналогичного переноса выполнять
под пользователем wortkarten только после успешной сверки архивов:

```bash
(
set -euo pipefail
umask 077
wk_script="$HOME/scripts/backup-german-vocab.sh"
test -f "$wk_script"
test ! -L "$wk_script"
test "$(grep -Fxc 'REMOTE="wortkarten-drive:wortkarten-backups"' "$wk_script")" = 1
install -d -m 700 "$HOME/backups/backup-script-config"
wk_before=$(mktemp "$HOME/backups/backup-script-config/before-drive-own.XXXXXXXX.sh")
cat "$wk_script" > "$wk_before"
wk_new=$(mktemp "$HOME/scripts/.backup-remote.XXXXXXXX")
sed 's|^REMOTE="wortkarten-drive:wortkarten-backups"$|REMOTE="wortkarten-drive-own:WortkartenBackups-own/production"|' "$wk_before" > "$wk_new"
bash -n "$wk_new"
test "$(grep -Fxc 'REMOTE="wortkarten-drive-own:WortkartenBackups-own/production"' "$wk_new")" = 1
cmp -s "$wk_script" "$wk_before"
chmod 700 "$wk_new"
mv -T -- "$wk_new" "$wk_script"
echo SCRIPT_SWITCHED
echo "Previous script: $wk_before"
)
```

Блок отказывается заменять неожиданный REMOTE или символическую ссылку,
сохраняет исходный скрипт в приватном файле, проверяет bash-синтаксис новой
версии и отсутствие параллельного изменения оригинала, затем атомарно заменяет
файл. При ошибке остановиться; не запускать следующие команды. Копии БД и
архивов в этом шаге не меняются. Повторять блок после SCRIPT_SWITCHED не нужно.

После `SCRIPT_SWITCHED` из root запустить и проверить новую полную пару:

```bash
systemctl start wortkarten-script-backup.service
systemctl show wortkarten-script-backup.service -p Result -p ExecMainStatus
journalctl -u wortkarten-script-backup.service -n 35 --no-pager
```

Нужны успешный последний запуск, новая пара файлов в destination production
и отсутствие предупреждения об общем Google client_id именно в новом запуске.
Таймер 03:30 Europe/Berlin использует тот же путь скрипта; переустановка или
перезапуск приложения не требуется. В журнале могут оставаться старые запуски
с прежним предупреждением — сверять время последнего запуска.

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

Настройка backup и Healthchecks, совпадение расписаний, успешный полный ручной
запуск, доставка heartbeat и получение тестового письма подтверждены владельцем.
Осталось принять первый автоматический запуск timer и восстановление dump,
скачанного из Drive, в отдельный PostgreSQL (восстановление ранее отложено).

Проверка расписания не подтверждает шифрование существующих файлов на Drive,
правильность ротации или пригодность dump к восстановлению.

Откат расписания: выключить только `wortkarten-script-backup.timer`, затем вернуть
строку backup через `sudo -u wortkarten crontab -e`. Другие cron-задачи и приложения
не менять. Это вернёт прежний PATH/часовой пояс, поэтому откат — временная мера.

Официальная документация: [окружение cron](https://manpages.ubuntu.com/manpages/focal/man5/crontab.5.html),
[календарь systemd](https://manpages.ubuntu.com/manpages/focal/man7/systemd.time.7.html),
[Persistent timer](https://manpages.ubuntu.com/manpages/focal/man5/systemd.timer.5.html).
