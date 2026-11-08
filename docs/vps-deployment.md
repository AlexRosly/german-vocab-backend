# Перенос Wortkarten backend на VPS с Hestia и PM2

Инструкция от 08.11.2026 для существующего VPS Ubuntu/Hestia: 3 CPU, 4 GB RAM.
Новый сервер приложения продолжит использовать **ту же рабочую production БД Neon**.
Переносить/создавать базу для смены хостинга не требуется. Пароли и DATABASE_URL
заполняются на сервере, в Git их нет. Команды выполняет владелец через SSH.

Используем отдельного Linux-пользователя `wortkarten`, отдельный PM2 и порт 3011.
Это позволяет сохранить работающие Blog-Api/Main-Api и другие приложения.
Публичный API-домен — ранее выбранный `ypbooking.chost.com.ua`, **если он выделен
для Wortkarten**. Если там нужен существующий сайт, выберите другой поддомен
и замените домен в шагах ниже. Hestia-панель на 8083 остаётся отдельным сервисом.

## 1. До переноса

В текущем backend сохраните свежую копию вне репозитория:

```bash
node --env-file=.env scripts/backup-database.cjs --expect-host YOUR_CURRENT_NEON_HOST --directory /private/backups/wortkarten-before-vps
```

Вместо HOST — hostname из актуального Connect в Neon, без пароля. Проверьте
manifest и восстановление в отдельной пустой БД. Приватную копию храните также
вне VPS. Не выбирайте другую ветку Neon только из-за её названия: после такого
переключения могут отсутствовать слова, аккаунты и прогресс.

На VPS под root проверьте ресурсы и занятые порты:

```bash
free -h
df -h
ss -ltnp
pm2 list
id wortkarten
```

Если пользователя ещё нет:

```bash
adduser --disabled-password --gecos "" wortkarten
sudo -iu wortkarten
```

Дальше шаги 2–4 выполняются от `wortkarten`. Если порт 3011 занят, выберите свободный
и одинаково измените PORT в .env и upstream в обоих Hestia-шаблонах.
Другие PM2-процессы останавливать/удалять для переноса не требуется.

## 2. Код и отдельный Node 22

```bash
mkdir -p "$HOME/apps"
git clone https://github.com/AlexRosly/german-vocab-backend.git "$HOME/apps/german-vocab-backend"
cd "$HOME/apps/german-vocab-backend"
bash deploy/pm2/install-node22.sh
export WORTKARTEN_NODE="$(cat "$HOME/.config/wortkarten/node22.path")"
export PATH="$(dirname "$WORTKARTEN_NODE"):$PATH"
node --version
npm --version
npm ci --include=dev
npm run build
npm install --global pm2
```

Помощник скачивает официальный Linux-дистрибутив последнего Node 22, проверяет
SHA-256 и устанавливает его в домашний каталог этого пользователя. Системный
Node не заменяется. Нужны curl, tar с xz и sha256sum; при отсутствии root может
установить пакеты `curl xz-utils ca-certificates`. Источник —
[официальные дистрибутивы Node 22](https://nodejs.org/dist/latest-v22.x/).
При уже подходящем Node 22 можно вместо установки указать его абсолютный путь
в WORTKARTEN_NODE. Не удаляйте этот дистрибутив после настройки PM2.

Зависимости Prisma остаются по lockfile, версия 6.19.3. Dev-зависимости нужны
для сборки и ручного backup-скрипта; не запускайте audit fix --force.

## 3. Окружение и запуск

```bash
cp deploy/pm2/backend.env.example .env
chmod 600 .env
nano .env
```

Заполните:

| Переменная | Значение |
| --- | --- |
| NODE_ENV | production |
| HOST | 127.0.0.1 — Node доступен через локальный Nginx |
| PORT | 3011 или выбранный свободный порт |
| DATABASE_URL | **Текущая** рабочая production Neon, та же, что сейчас у приложения |
| FRONTEND_ORIGIN | точный будущий основной адрес Netlify, например https://YOUR-SITE.netlify.app, без завершающего слеша |
| GOOGLE_AUTH_ENABLED | true |
| GOOGLE_CLIENT_ID | существующий Web Client ID приложения; уже указан в примере |

Имя Netlify-сайта выберите заранее: оно нужно для FRONTEND_ORIGIN. API-домен сюда
не подставлять. Секрет Google для текущего popup-входа не используется.
Node загружает .env через `--env-file`; сам Nest автоматически файл не читает.

Проверка истории **той же** БД:

```bash
npx prisma migrate status
```

Ожидается актуальная схема без pending. Не выполнять migrate reset/db push/migrate dev.
Если появились новые ожидающие миграции, отдельно проверить SQL и копию, согласовать
применение; миграции не включены в build/start. После согласования используется
`npx prisma migrate deploy`, а не команда разработки.

```bash
pm2 start deploy/pm2/ecosystem.config.cjs --only wortkarten-api
pm2 logs wortkarten-api --lines 60
curl --fail http://127.0.0.1:3011/api/v1/health
pm2 save
pm2 startup
```

У `pm2 startup` выполните именно показанную им sudo-команду для пользователя
wortkarten. Так сохраняется его отдельный процесс после перезагрузки, без изменения
PM2 root. Проверить автозапуск можно через `systemctl status pm2-wortkarten`.
[PM2: ecosystem](https://pm2.keymetrics.io/docs/usage/application-declaration/),
[PM2: startup/save](https://pm2.keymetrics.io/docs/usage/startup/).

## 4. Домен, Hestia и HTTPS

DNS A-запись выбранного API-домена должна указывать на 84.246.80.254. Удалите старую
AAAA-запись только если она направляет именно этот домен на другой сервер и IPv6
для него не используется. Через Hestia создайте/выберите **выделенный API-домен**.

В репозитории есть два шаблона: `deploy/hestia/wortkarten-api.tpl` и `.stpl`.
В них стандартные внешние 80/443 проксируются на 127.0.0.1:3011. Сохранены Hestia
include-файлы для принудительного HTTPS, ACME и доменных настроек.

Root копирует файлы из checkout пользователя в каталог шаблонов:

- Nginx + Apache: `/usr/local/hestia/data/templates/web/nginx/`, в Hestia выбрать
  Proxy template `wortkarten-api`;
- Nginx-only: `/usr/local/hestia/data/templates/web/nginx/php-fpm/`, выбрать
  Web template `wortkarten-api`.

Перед копированием проверить, нет ли уже своих файлов с этими именами. Стандартные
`default.tpl/.stpl` не перезаписывать. Например, для Nginx + Apache:

```bash
ls /usr/local/hestia/data/templates/web/nginx/wortkarten-api.*
cp /home/wortkarten/apps/german-vocab-backend/deploy/hestia/wortkarten-api.tpl /usr/local/hestia/data/templates/web/nginx/
cp /home/wortkarten/apps/german-vocab-backend/deploy/hestia/wortkarten-api.stpl /usr/local/hestia/data/templates/web/nginx/
nginx -t
```

В панели назначьте шаблон **только API-домену**, включите SSL и Let's Encrypt,
затем принудительный HTTPS. После изменения ещё раз `nginx -t`; reload выполняется
панелью или `systemctl reload nginx` только при успешной проверке. Hestia-сгенерированные
конфиги вручную не заменять: rebuild домена их перезапишет.
[Hestia: собственные шаблоны](https://hestiacp.com/docs/server-administration/web-templates),
[домены и SSL](https://hestiacp.com/docs/user-guide/web-domains).

```bash
curl --fail https://ypbooking.chost.com.ua/api/v1/health
```

При 401 на защищённых маршрутах без входа сервис доступен; HTML существующего сайта
вместо JSON означает, что выбран не тот домен/шаблон. 502 при работающем локальном
health — проверить порт/upstream. Для сертификата не обходить HTTPS-предупреждения.

## 5. Подключить Netlify и проверить

Во frontend Netlify задать NEXT_PUBLIC_API_URL=/api/v1,
API_PROXY_ORIGIN=https://ypbooking.chost.com.ua. Подробности — инструкция frontend
`docs/netlify-deployment.md`. В Google Cloud сохранить прежний Client ID и добавить
точный основной Netlify origin к Authorized JavaScript origins.

Проверить через Netlify: health, вход паролем, Google-вход, reload сессии, выход,
ADMIN/модерацию, свой словарь и число карточек, новую карточку с примером,
тренировку и сохранение результата. Cookies идут через frontend proxy;
FRONTEND_ORIGIN/CORS не заменять на `*`. За несколькими proxy IP-лимит auth может
оказаться общим для посетителей: настройка доверенных proxy — отдельная работа,
не повод отключать защиту или доверять любому X-Forwarded-For.

Render оставить доступным до проверки. Перенос на тот же Neon сохраняет записи
Google и словарь; на другом frontend-домене пользователю потребуется новый вход.

## 6. Последующие обновления и откат

От wortkarten, с тем же Node 22:

```bash
cd "$HOME/apps/german-vocab-backend"
export WORTKARTEN_NODE="$(cat "$HOME/.config/wortkarten/node22.path")"
export PATH="$(dirname "$WORTKARTEN_NODE"):$PATH"
git status --short
git rev-parse HEAD
git pull --ff-only origin main
npm ci --include=dev
npm run build
pm2 restart deploy/pm2/ecosystem.config.cjs --only wortkarten-api --update-env
curl --fail http://127.0.0.1:3011/api/v1/health
pm2 save
```

До pull запомнить предыдущий commit. При неуспешной сборке работающий PM2 не
перезапускать; восстановить предыдущую версию в отдельном каталоге либо вернуть
frontend API_PROXY_ORIGIN на Render и пересобрать frontend. Не восстанавливать
старую БД поверх новых пользовательских данных ради отката кода. Новые миграции
всегда рассматриваются отдельно. Регулярные копии должны уходить за пределы VPS;
этот документ не означает, что расписание уже настроено.

Статус: конфигурация подготовлена локально. SSH/Hestia/PM2/DNS на VPS этой работой
не менялись; `nginx -t` с реальной конфигурацией должен выполнить оператор на VPS.
