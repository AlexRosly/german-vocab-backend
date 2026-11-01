# Демо на Render: backend

Подготовлено 01.11.2026. Публичное размещение и подключение выбранной демо-БД
выполняются отдельно. Эта конфигурация не применяет миграции при build/start.

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

Перед размещением проверить историю миграций именно выбранной базы. Имеется
новая миграция `20261031120000_add_auth_sessions`, применение которой в живой
базе этой работой не подтверждено. Если таблицы отсутствуют, успешный health
не доказывает работоспособность регистрации и входа. Нужен реальный smoke-тест.

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
