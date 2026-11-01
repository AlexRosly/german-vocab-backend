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

german-vocab-backend/
├── dist/ # Скомпилированные файлы (TypeScript -> JavaScript)
├── node_modules/ # Зависимости Node.js
├── prisma/ # Работа с БД через Prisma ORM
│ ├── migrations/ # История миграций базы данных
│ └── schema.prisma # Схема базы данных (модели Prisma)
├── src/ # Исходный код приложения (NestJS)
│ ├── study/ # Модуль обучения (study.module.ts и сопутствующие)
│ │ └── study.module.ts [cite: 2]
│ ├── words/ # Модуль слов и примеров
│ │ ├── dto/ # Data Transfer Objects (валидация данных)
│ │ │ ├── create-word-example.dto.ts
│ │ │ ├── create-word.dto.ts
│ │ │ ├── update-word-example.dto.ts
│ │ │ └── update-word.dto.ts
│ │ ├── word-examples.controller.ts
│ │ ├── word-examples.service.ts
│ │ ├── words.controller.ts
│ │ └── words.service.ts
│ ├── app.module.ts # Корневой модуль приложения
│ ├── health.controller.ts # Контроллер проверки работоспособности (Health Check)
│ ├── main.ts # Точка входа в приложение (запуск сервера)
│ └── prisma.service.ts # Сервис для подключения к Prisma/БД
├── .env # Переменные окружения (конфиденциальные данные)
├── .gitignore # Исключения для Git
└── docker-compose.yml # Конфигурация Docker (например, для запуска БД)
