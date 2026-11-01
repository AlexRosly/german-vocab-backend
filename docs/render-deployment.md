# Демо на Render: backend

Обновлено 01.11.2026. Backend размещён пользователем:
https://german-vocab-backend-pxp3.onrender.com.
Frontend: https://german-vocab-frontend.onrender.com.
Эта конфигурация не применяет миграции при build/start.

| Поле | Значение |
| --- | --- |
| Repository | AlexRosly/german-vocab-backend |
| Branch / Region / Plan | main / Frankfurt / Free |
| Build | `npm ci --include=dev && npm run prisma:generate && npm run build` |
| Start | `node dist/main.js` |
| Health check | `/api/v1/health` |
| NODE_VERSION / NODE_ENV | `22` / `production` |
| DATABASE_URL | секрет подключения к согласованной демо/тестовой базе Neon |
| FRONTEND_ORIGIN | точный HTTPS origin frontend, без слеша в конце |

Render передаёт PORT; NestJS уже читает его. Prisma Client генерируется из текущей
схемы, Prisma остаётся 6.19.3. NODE_ENV=production включает Secure refresh cookie.
`npm ci --include=dev` нужен для сборочных инструментов Nest/TypeScript/Prisma.

01.11.2026 в подтверждённой пользователем ветке Neon «миграцион» применена
`20261031120000_add_auth_sessions`. До операции проверено, что она единственная
ожидающая; после подтверждены история миграции, чтение AuthSession и сохранность
количеств старых слов/примеров/связей/переводов/тренировок/прогресса.
Публичные backend и proxy возвращают health 200, неизвестная сессия — 401.
Пользователь подтвердил регистрацию; с отдельного согласия назначен один ADMIN.
Основная ветка main не менялась. Полный smoke-тест двух пользователей ещё нужен.
Для нового подключения всегда заново проверять историю миграций выбранной базы:
успешный health сам по себе не доказывает готовность регистрации и входа.

Не использовать `migrate reset` или `db push`. Не добавлять migrate deploy в
build/start. Применение проверенных миграций выполняется отдельной операцией после
выбора базы, проверки копии/резервной копии и явного согласия пользователя.

Для демонстрации создать отдельный USER и отдельно согласовать назначение ADMIN.
Роль нельзя назначить через регистрацию. Старый legacy-owner не получает пароль
автоматически. Пароли и DATABASE_URL не передавать в GitHub или шпаргалку.

Frontend обращается к API через свой Next.js proxy. API_PROXY_ORIGIN во frontend
должен содержать публичный HTTPS URL API: Free web service не принимает private
network traffic. Auth Origin должен оставаться origin frontend. На демо за proxy
лимит auth по IP может оказаться общим для посетителей; для публичного запуска
нужна отдельная настройка доверия proxy и хранилища лимитов, не отключение guard.

Health `/api/v1/health` уже реализован. Доступна документация `/docs`.
Настройки `render.yaml` не создают новую БД; auto-deploy выключен до отдельного
включения. После push в GitHub публичное демо само не изменится.

Источники: [Render Node](https://render.com/docs/deploy-node-express-app),
[Render Free](https://render.com/docs/free), [Blueprint](https://render.com/docs/blueprint-spec).
