# Уведомления о резервировании Wortkarten

## Текущее подтверждение

12.11 владелец переключил REMOTE на
`wortkarten-drive-own:WortkartenBackups-own/production`. Полный запуск сервиса
завершился `Result=success`, `ExecMainStatus=0`: dump, архив, upload и ротация
прошли, предупреждения об общем Google Client ID в новом запуске нет.
Четыре старых архива ранее перенесены с полной сверкой содержимого.
13.11 владелец подтвердил успешный ночной запуск по расписанию и прислал
скриншот нового архива в production/project: `project-2026-11-12_17-30-00.tar.gz`,
время изменения 03:30. Имя содержит время сервера UTC−9: 12.11 17:30 соответствует
13.11 03:30 Europe/Berlin. Приёмка запуска по расписанию выполнена по
подтверждению владельца; новый journal/ночной heartbeat отдельно не запрашивались.

## Обёртка установлена: доставка подтверждена

Владелец подтвердил следующий реальный запуск 12.11 в **21:51:21–21:51:35
Europe/Berlin** (VPS journal 11:51 UTC−9): dump, архив, upload и ротация прошли,
в журнале есть `Backup success delivered to Healthchecks.`, Result=success,
ExecMainStatus=0. На присланном скриншоте Healthchecks зелёный: «This check is up».
Установку конфигурации/override и полный ручной backup повторять не требуется.

Следующим скриншотом владелец подтвердил исправленное расписание Healthchecks:
**Cron Expression `30 3 * * *`, Time Zone `Europe/Berlin`, Grace Time `1 hour`**.
Таким образом, расписания timer и Healthchecks совпадают; прежний Period 1 day
больше не используется. При отсутствии успешного запуска примерно к 04:30
Berlin проверка должна сообщить о просрочке (при работающей Email integration).
Владелец отдельно подтвердил получение тестового письма из Email integration.
Доставка статуса в Healthchecks и тестового уведомления на почту принята.
Первый автоматический запуск 13.11 принят по подтверждению владельца
и скриншоту свежего архива. Проверка восстановления внешней копии остаётся отложенной.

Для последующих проверок автоматического запуска (в root):

```bash
TZ=Europe/Berlin systemctl list-timers --all wortkarten-script-backup.timer
TZ=Europe/Berlin journalctl -u wortkarten-script-backup.service --since today --no-pager
```

Нужны LAST около 03:30, журнал именно автоматического запуска, успешный backup,
доставленный heartbeat и свежая пара файлов в новой папке Drive. Старое ручное
Result=success само по себе не подтверждает ночной запуск.

## 1. Проверка Healthchecks

Владелец подтвердил создание проверки. Настройки должны быть:

- название `Wortkarten backup`;
- расписание Cron `30 3 * * *`, часовой пояс `Europe/Berlin`;
- Grace time: один час;
- Email integration подключена к этой проверке; отправить тест уведомления и
  убедиться, что письмо пришло. Письмо о сбое и пропущенном запуске отправляет
  сам Healthchecks: локальный VPS не сможет сообщить о собственном отключении.

Бесплатного плана достаточно для одной проверки. В Healthchecks передаются
только статусы, время запросов и технические данные соединения VPS. Содержимое
копий, SQL, журналы, email пользователей и строки подключения не отправляются.
Ping URL позволяет подделывать статус этой проверки, поэтому хранить его
приватно и не вставлять в чат, Git, аргументы команд или systemd Environment.

## 2. Сохранить Ping URL на VPS

Из root войти в пользователя приложения и обновить checkout (сборка не нужна):

```bash
sudo -iu wortkarten
git -C /home/wortkarten/apps/german-vocab-backend pull --ff-only
```

Затем одним блоком. В появившийся скрытый запрос вставить **базовый Ping URL**
из Healthchecks вида `https://hc-ping.com/<uuid>`, без `/start` или `/fail`:

```bash
(
set -euo pipefail
umask 077
install -d -m 700 "$HOME/.config/wortkarten"
wk_cfg="$HOME/.config/wortkarten/backup-ping.url"
test ! -e "$wk_cfg"
IFS= read -r -s -p 'Healthchecks Ping URL (hidden): ' wk_ping
printf '\n'
[[ "$wk_ping" =~ ^https://hc-ping\.com/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$ ]] || { echo INVALID_PING_URL; exit 1; }
printf '%s\n' "$wk_ping" > "$wk_cfg"
chmod 600 "$wk_cfg"
unset wk_ping
bash "$HOME/apps/german-vocab-backend/deploy/backup/run-monitored-script.sh" --check-config
)
```

`--check-config` не запускает backup и не отправляет ping. Проверяет формат URL,
владельца, приватные права файла/каталога и наличие curl. Установщик проверит
это повторно от пользователя wortkarten с ограниченным окружением.
Если файл уже есть, блок останавливается: не перезаписывать его вслепую.

## 3. Подключить к существующему сервису

Вернуться в root (`exit`, если входили через sudo -iu), затем:

```bash
bash /home/wortkarten/apps/german-vocab-backend/deploy/backup/install-script-monitor.sh
systemctl start wortkarten-script-backup.service
systemctl show wortkarten-script-backup.service -p Result -p ExecMainStatus
journalctl -u wortkarten-script-backup.service -n 25 --no-pager
```

Установщик добавляет только override
`/etc/systemd/system/wortkarten-script-backup.service.d/monitor.conf`.
Он проверяет пользователя, исходный unit и отсутствие других overrides,
не заменяет существующие overrides и не меняет таймер или PM2. Во время
работающего backup устанавливать override нельзя. В systemd остаются прежние
HOME, PATH, WorkingDirectory, UMask, ExecStartPre и TimeoutStartSec.

Обёртка посылает `/start`, запускает прежний `~/scripts/backup-german-vocab.sh`,
а затем success или `/fail` по его коду завершения. Ошибка start ping не мешает
созданию копий. Недоступный/испорченный конфиг также не отменяет попытку backup,
но сервис завершится ошибкой мониторинга. Недоставленный success даёт код 75;
небезопасный/невалидный конфиг — 78; ошибка backup сохраняет исходный код.
Для доставки нужен HTTP 200; redirects не принимаются и не выполняются.
URL передаётся curl через stdin; пользовательский .curlrc отключён.

Проверить `Backup success delivered to Healthchecks.` в последнем журнале,
зелёный статус и события Start/Success в Healthchecks. Затем подтвердить
первый автоматический запуск и доставку тестового письма. Не считать
мониторинг принятым только по локальному exit 0.

## Проверки и остаток

9 автономных интеграционных проверок с подставными curl/backup: успех, ошибка
backup, ошибка start, ошибка success, HTTP redirect, ошибка fail, незащищённый
конфиг, неправильный host и отсутствие побочных действий check-config.
Запуск: `bash test/script-backup-monitor.test.sh`. В Windows имитируются только
результаты stat для POSIX-прав; настоящие 0600/0700 проверяются на VPS установщиком.
Реальные Healthchecks URL и данные БД в тестах не используются.

Настройка, доставка уведомлений и первый запуск по расписанию приняты.
Для полного закрытия R02 остаётся восстановление копии, скачанной из Drive,
в отдельный PostgreSQL.
Проверка восстановления ранее отложена владельцем. Не восстанавливать поверх
рабочей Neon. Этот мониторинг не заменяет uptime-мониторинг API (R04).

Источники: [Healthchecks cron monitoring](https://healthchecks.io/docs/monitoring_cron_jobs/),
[ping API](https://healthchecks.io/docs/http_api/),
[notifications](https://healthchecks.io/docs/configuring_notifications/).
