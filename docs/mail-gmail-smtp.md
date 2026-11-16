# Почта Wortkarten: первый запуск через отдельный Gmail

Решение владельца от 16.11.2026: пока нет своего домена, используется отдельный Gmail-ящик через SMTP. Перенос на собственный домен и Resend описан в [ТЗ](mail-resend-plan.md).

## Что готово

- `MailModule`/`MailService`, драйвер `gmail-smtp`, фиксированный `smtp.gmail.com`, TLS 465 либо обязательный STARTTLS 587, проверка сертификата и ограниченные таймауты.
- Отдельный пароль приложения читается из приватного файла вне проекта. Отправитель совпадает с Gmail-аккаунтом; письма без вложений, без произвольных заголовков и без загрузки файлов/URL транспортом. SMTP-диагностика не пишет адреса, токены, пароль, текст письма или сырой ответ Google.
- `scripts/check-mail.cjs`: проверка конфигурации без сети, проверка соединения без письма и отдельная явная отправка одного теста только в ящик отправителя. Публичного HTTP-endpoint для произвольной отправки нет.
- По умолчанию `MAIL_ENABLED=false`: существующая авторизация работает без SMTP-настроек. Включённая некорректная конфигурация отклоняется до старта приложения; сначала выполните CLI-проверку.

Это подключение почтового транспорта. Форма «Забыли пароль», одноразовые токены, подтверждение email и смена пароля остаются следующими задачами R07–R08; их нельзя считать готовыми после одного тестового письма. Миграций и изменений пользователей/паролей в этом этапе нет.

## 1. Подготовить ящик

1. Создать отдельный Gmail для Wortkarten; не использовать основной личный ящик как служебный.
2. Включить двухэтапную аутентификацию. В [паролях приложений Google](https://myaccount.google.com/apppasswords) создать пароль «Wortkarten VPS». Google требует включённую 2SV; в некоторых типах аккаунтов эта функция недоступна — [официальная справка](https://support.google.com/mail/answer/185833?hl=ru).
3. Адрес ящика можно сообщить для настройки. Обычный пароль Gmail, пароль приложения и коды 2SV в чат/репозиторий не присылать.

Google-вход в Wortkarten и собственный OAuth-клиент для резервных копий никак не заменяют SMTP-настройку. Для SMTP не нужны разрешения Drive и не используется OAuth Client Secret входа пользователей.

## 2. Обновить код на VPS

Под пользователем `wortkarten`:

```bash
(
  set -e
  cd /home/wortkarten/apps/german-vocab-backend
  git pull --ff-only
  npm ci --include=dev
  npm run build
)
```

Пока нет конфигурации и проверенного письма, не включать восстановление пароля в интерфейсе. Этот релиз не добавляет соответствующих кнопок.

## 3. Сохранить пароль приложения вне проекта

В Bash на VPS, **под пользователем `wortkarten`**, не из root. Команда не показывает введённый секрет и не перезаписывает существующий файл:

```bash
(
  set -euo pipefail
  umask 077
  wk_mail_dir="$HOME/.config/wortkarten"
  install -d -m 700 "$wk_mail_dir"
  wk_mail_file="$wk_mail_dir/smtp-app-password"
  test ! -e "$wk_mail_file" || { echo 'SMTP_PASSWORD_FILE_ALREADY_EXISTS'; exit 1; }
  IFS= read -r -s -p 'Gmail app password (hidden): ' wk_mail_password
  printf '\n'
  wk_mail_password="${wk_mail_password// /}"
  [[ "$wk_mail_password" =~ ^[A-Za-z0-9]{16}$ ]] || { echo 'INVALID_APP_PASSWORD'; exit 1; }
  wk_mail_tmp=$(mktemp "$wk_mail_dir/.smtp-password.XXXXXXXX")
  trap 'rm -f -- "$wk_mail_tmp"' EXIT
  printf '%s\n' "$wk_mail_password" > "$wk_mail_tmp"
  chmod 600 "$wk_mail_tmp"
  ln -- "$wk_mail_tmp" "$wk_mail_file"
  unset wk_mail_password
  echo 'SMTP_PASSWORD_SAVED'
)
```

Пароль не находится в `.env`/Git/PM2 env. На Linux файл должен принадлежать запускающему пользователю и не иметь прав доступа группы/остальных; ссылки и каталоги не принимаются. При переносе сервера пароль можно заново выпустить в Google и сохранить на новом VPS. Файл вне архива проекта; не отправлять его в обычные логи или отчёты.

## 4. Настроить `.env`

Открыть `/home/wortkarten/apps/german-vocab-backend/.env` и добавить/обновить по одному экземпляру этих параметров. **Остальные строки, особенно DATABASE_URL и Google-вход, не менять.** Вместо примера указать реальный отдельный ящик в обоих полях:

```dotenv
MAIL_ENABLED=true
MAIL_PROVIDER=gmail-smtp
MAIL_FROM_NAME=Wortkarten
MAIL_FROM_ADDRESS=YOUR_DEDICATED_ACCOUNT@gmail.com
SMTP_USERNAME=YOUR_DEDICATED_ACCOUNT@gmail.com
SMTP_PORT=465
SMTP_PASSWORD_FILE=/home/wortkarten/.config/wortkarten/smtp-app-password
```

Не использовать обычный пароль Gmail. Порт 587 допускается, но шифрование STARTTLS остаётся обязательным; проверка сертификата не отключается. Произвольные SMTP-host/отправители этим драйвером не поддерживаются. Для другого провайдера нужен отдельный проверенный адаптер.

## 5. Проверить до перезапуска API

Из каталога backend, под `wortkarten`:

```bash
node --env-file=.env scripts/check-mail.cjs --check-config
node --env-file=.env scripts/check-mail.cjs --verify
node --env-file=.env scripts/check-mail.cjs --send-test
```

- `--check-config`: ожидается `enabled:true`, `configurationValid:true`, `network:false`, `sent:false`; соединения и письма нет.
- `--verify`: проверяет DNS/TCP/TLS/аутентификацию, не отправляет письмо. SMTP-доступ может быть ограничен VPS-провайдером или Google — ошибка возвращается безопасным кодом.
- `--send-test`: только после успешной verify отправляет одно письмо на MAIL_FROM_ADDRESS. `sent:true` означает принятие SMTP-сервером; вручную проверить Inbox/Spam. Успешная авторизация сама по себе не доказывает доставку — [контракт Nodemailer verify](https://nodemailer.com/smtp#verifying-the-configuration).

Повторных автоматических отправок после таймаута нет: SMTP мог уже принять письмо. Коды `mail_authentication_failed`, `mail_connection_failed`, `mail_delivery_failed`, `mail_configuration_invalid` можно сообщать при диагностике. Сырые ответы/файлы с паролями присылать не нужно.

После успешного теста:

```bash
pm2 restart wortkarten-api --update-env
pm2 status wortkarten-api
```

Чтобы временно выключить отправку, установить `MAIL_ENABLED=false` и перезапустить только Wortkarten. Gmail имеет ограничения и может блокировать непривычные входы; массовые рассылки через этот этап не предусмотрены. Публичный сервис позже переводится на домен/Resend.

## Приёмка

- Код: 10 тестов конфигурации/транспорта/модуля + 4 теста CLI; без реального Google и писем, mock SMTP. Проверяются изоляция секретов, TLS, одиночный получатель, запрет инъекций и вложений, отсутствие автоматических повторов, безопасные ошибки.
- Проверка настоящего Gmail с VPS и получение письма ожидают подготовки ящика и действий владельца; пока не подтверждены.
- Восстановление пароля: следующим отдельным этапом после приёмки транспорта, с ограничением частоты, одноразовыми хешированными токенами, сроком действия, отзывом сессий и тестами Google-only аккаунтов. Любая новая production-миграция требует отдельного согласия.
