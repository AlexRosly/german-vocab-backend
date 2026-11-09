# german-vocab-backend

Backend-репозиторий: NestJS + PostgreSQL + Prisma + REST/OpenAPI.

## Текущий статус — 09.11.2026

Реализованы авторизация email/Google, USER/ADMIN, личный словарь и общая библиотека, мультиязычные слова и примеры, модерация и предложения исправлений, персональные тренировки/SRS/история, личные материалы, книги и массовое добавление из библиотеки. Рабочая схема содержит 18 таблиц и 15 миграций; последнее применение проверено 09.11.2026.

**[Roadmap: что готово, что осталось и как принимаем результат](docs/roadmap.md)**.

Основной backend размещён на VPS по сообщению владельца; БД — Neon. Выпуск последней функции на фактических хостах отмечается отдельно от готовности кода. Инструкции: [VPS](docs/vps-deployment.md), [предложения исправлений](docs/correction-suggestions.md), [резервные копии](docs/database-backups.md).


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

Этот раздел относился к исходному прототипу. Авторизация, серверная изоляция данных, редактирование и персональное повторение уже реализованы; актуальная готовность и оставшиеся эксплуатационные задачи перечислены в [roadmap](docs/roadmap.md).

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
