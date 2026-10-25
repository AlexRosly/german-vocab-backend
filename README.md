# german-vocab-backend

Backend-репозиторий: NestJS + PostgreSQL + Prisma + REST/OpenAPI.

## Требования
- Node.js 20+
- Docker Desktop или PostgreSQL 16+

## Запуск локально
```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run start:dev
```

API: http://localhost:3001/api/v1  
Swagger: http://localhost:3001/docs  
Health: http://localhost:3001/api/v1/health

## Первые endpoints
- `GET /api/v1/health`
- `GET /api/v1/words`
- `POST /api/v1/words`
- `GET /api/v1/words/:id`
- `DELETE /api/v1/words/:id`

## Важное ограничение стартового каркаса
Этот первый вертикальный срез предназначен для локального прототипа и пока не включает аутентификацию/изоляцию карточек по пользователям, полноценное редактирование, интервальное повторение и production hardening. Не публикуйте его в интернет до внедрения авторизации и серверной проверки доступа.

## Git
```bash
git init
git add .
git commit -m "chore: initialize backend"
```
