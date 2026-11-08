# Вход через Google и привязка существующего аккаунта

Реализовано 08.11.2026. Локальные auth-тесты проверяют серверную верификацию,
одноразовые запросы входа, создание USER, сохранение существующего пользователя
и явную привязку Google. После восстановления production миграция применена,
Google включён на Render. Владелец подтвердил: привязка через Настройки, выход и
реальный Google-вход успешны; ADMIN и785 слов сохранились. Чтением БД подтверждены
тот же userId, EMAIL и GOOGLE accounts, роль ADMIN и785 личных карточек.
Новый отдельный Google-пользователь на Render пока проверен только тестами.

Используется Google Identity Services popup и ID token; backend проверяет его
официальной google-auth-library. Client Secret и Google access/refresh token
для этого способа не нужны. Prisma остаётся 6.19.3, Node — 22.

## Поэтапное включение

1. Восстановить доступ к правильной ветке Neon. Перед сменой DATABASE_URL проверить
   наличие прежних пользователей/слов/прогресса в новой ветке. Название ветки само
   по себе не подтверждает наличие данных. Не применять изменения к основной БД
   без согласования и проверки SQL/резервной копии.
2. Обновить backend, оставив GOOGLE_AUTH_ENABLED отсутствующим или false. Даже
   уже заданный GOOGLE_CLIENT_ID не включает Google до отдельного переключения.
   Обычный email-вход не обращается к новой таблице.
3. Проверить migrate status и pending SQL. Единственная миграция этого этапа:
   `20261108120000_add_google_auth_challenges`; она создаёт таблицу одноразовых
   challenge с индексом и FK users, не переписывает слова или прогресс. Применить
   только проверенный набор через migrate deploy, отдельно от build/start.
4. Установить backend GOOGLE_CLIENT_ID равным публичному Web application Client ID
   из Google Cloud. В Authorized JavaScript origins должен быть точный frontend
   origin, сейчас `https://german-vocab-frontend.onrender.com`, без пути.
5. Установить backend GOOGLE_AUTH_ENABLED=true, перезапустить backend и обновить
   frontend. GET `/api/v1/auth/google/config` должен вернуть enabled:true и публичный
   clientId. При выключенной функции ответ enabled:false; это не ошибка сервиса.
6. Проверить настоящий вход/привязку по сценарию ниже. При смене frontend хостинга
   добавить новый origin в Google Cloud и обновить FRONTEND_ORIGIN backend.

FRONTEND_ORIGIN должен точно совпадать с origin frontend. Refresh и nonce cookie
передаются через существующий same-origin `/api/v1` proxy; в production это
HttpOnly, Secure, SameSite=Lax, Path=/api/v1/auth. Не ослаблять Origin Guard/CORS.
Во frontend нет секретного Google-ключа или прямой строки подключения к БД.

## Контракт

| Endpoint под /api/v1 | Назначение |
| --- | --- |
| GET /auth/google/config | Публичное состояние функции, no-store |
| POST /auth/google/challenge | Случайный nonce для входа и HttpOnly cookie |
| POST /auth/google | credential: проверенный Google ID token; обычная сессия приложения |
| GET /auth/google/account | connected:true/false для текущего пользователя, нужен bearer |
| POST /auth/google/link-challenge | nonce для привязки, связан с текущим userId |
| POST /auth/google/link | credential и текущий пароль приложения, нужен bearer |

Nonce хранится в БД только в виде SHA-256, срок 10 минут, потребляется ровно один
раз. Проверяются подпись, issuer, audience, expiry, sub, email_verified, email,
nonce и соответствие cookie/purpose/userId. Истёкший или заменённый nonce требует
новой попытки. Несколько окон Google могут заменить общую nonce cookie; повторить
вход в одном окне. Одновременно начатые account mutations проходят через auth lock.

Новый Google-пользователь всегда USER. Повторный вход определяется по provider=sub,
сохраняя userId, роль, словарь и настройки, даже если Google email изменился.
Существующий email не приводит к автоматической склейке аккаунтов: возвращается 409.
Для привязки нужно войти старым способом и подтвердить пароль в Настройках.
Чужую Google-привязку перенести нельзя; заменить уже подключённый другой Google
профиль тоже нельзя. Отвязывание, установка пароля Google-пользователю и восстановление
пароля не входят в этот этап.

Неверный пароль/Google credential при привязке возвращает 403: это не инвалидирует
текущую сессию приложения. Истёкший bearer по-прежнему 401 и обновляется клиентом
один раз; при смене пользователя старый ответ не применяется к новому аккаунту.
Ответ привязки содержит только connected:true и не может заменить роль/identity.
Google ID token не хранится в БД/логах/localStorage, сессии приложения используют
существующие случайные токены с хешированием в auth_sessions.

## Проверка на Render после включения

Для существующего ADMIN: обычный email-вход → Настройки → текущий пароль →
Подключить Google → выбрать свой Google аккаунт → сообщение о подключении.
Выйти и войти кнопкой Google: роль ADMIN, словарь и прогресс должны сохраниться.
Попытка Google-входа существующим email до привязки должна предложить обычный вход,
а не создавать второй аккаунт. Отмена popup не должна отправлять мутацию.

Отдельный новый Google аккаунт получает USER, пустой личный словарь и не видит
модерацию/чужие личные данные. Проверить reload/refresh, выход и истёкшую попытку.
Локальные тесты с подменой verifier/persistence не заменяют этот сценарий.

Источники:
[Google: проверка ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[Google: JS API, nonce и callback](https://developers.google.com/identity/gsi/web/reference/js-reference),
[Google: настройка Client ID](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
