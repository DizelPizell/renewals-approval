# Согласование и выполнение заявок на продление

Fullstack-приложение для управления заявками на продление ресурсов. Стек: TypeScript, React (Vite), NestJS, PostgreSQL.

## Версии инструментов

- Node.js 20+
- npm 10+
- PostgreSQL 16
- Docker + Docker Compose

## Пошаговый запуск

### 1. Поднять базу данных

```bash
npm run db:up          # из корня — запускает PostgreSQL на порту 5433
```

Или вручную: `docker compose up -d postgres`

### 2. Запустить миграции и заполнить данные

```bash
cd backend
cp ../.env.example .env  # настройте если нужно
npm install
npm run migrate          # создаёт таблицы
npm run seed             # заполняет пользователями и ресурсами
```

### 3. Запустить симулятор провайдера

```bash
cd provider
python provider_simulator.py   # стартует на 127.0.0.1:8091
```

### 4. Запустить бэкенд + воркер

```bash
cd backend
npm run start:dev      # NestJS + встроенный воркер на порту 3000
```

### 5. Запустить фронтенд

```bash
cd frontend
npm install
npm run dev            # Vite на порту 5173
```

Откройте http://localhost:5173

---

## Тестовые учётные записи

| Логин | Пароль | Пространство | Права |
|---|---|---|---|
| `initiator-alpha` | `initiator-alpha` | Alpha | create |
| `approver-alpha` | `approver-alpha` | Alpha | approve |
| `initiator-beta` | `initiator-beta` | Beta | create |
| `universal-alpha` | `universal-alpha` | Alpha | create + approve |

---

## API-контракты

| Метод | Путь | Описание |
|---|---|---|
| POST | `/auth/login` | `{username, password}` → `{access_token, user}` |
| GET | `/resources` | Ресурсы пространства пользователя |
| GET | `/renewal-requests` | Заявки пространства |
| POST | `/renewal-requests` | Создать заявку `{resourceId}` |
| POST | `/renewal-requests/:id/approve` | Одобрить |
| POST | `/renewal-requests/:id/reject` | Отклонить `{comment?}` |
| POST | `/renewal-requests/:id/retry` | Повторить (только из NEEDS_ATTENTION) |
| GET | `/renewal-requests/:id/history` | История переходов |
| GET | `/stats?resource_id=...` | `{operation_count}` — кол-во завершённых заявок |

Все запросы кроме `/auth/login` требуют заголовок: `Authorization: Bearer <token>`

Единый формат ошибок: `{ statusCode: N, message: "..." }`

---

## Модель состояний

```
                 ┌─────────┐
                 │  PENDING │
                 └────┬─────┘
           reject ↓   │ approve (другой пользователь)
           ┌──────────┤
      REJECTED         ↓
                  PROCESSING ←── retry (approve-пользователь)
                   ↓    ↓
            COMPLETED  NEEDS_ATTENTION (после 3 неудачных POST)
```

Правила:
- Создатель ≠ согласующий: нельзя одобрить/отклонить/повторить собственную заявку
- Одна активная заявка на ресурс (partial unique index по status IN PENDING/PROCESSING/NEEDS_ATTENTION)
- При одобрении: проверка снимка (old_date + amount_minor должны совпадать с текущим ресурсом)
- При approve: один атомарный запрос — смена статуса + запись в outbox_jobs + история

---

## Обработка неопределённого ответа провайдера

1. POST `/renewals` с `Idempotency-Key` → первый вызов возвращает 503 (операция сохранена)
2. Воркер сохраняет attempt_count++ в БД (crash-safe)
3. Ждёт `PROVIDER_RETRY_DELAY_MS` мс (env, по умолчанию 5000)
4. GET `/renewals/{encodeURIComponent(key)}` — если `status=completed` → COMPLETED
5. Если нет — повторяет POST с тем же ключом
6. После 3 POST без подтверждения → NEEDS_ATTENTION
7. GET не считается в счётчик попыток

### Как воспроизвести сценарий с рестартом

```bash
# При одобренной заявке в PROCESSING
# 1. Убить бэкенд (Ctrl+C)
# 2. Дождаться, пока lease_until < NOW() (60 секунд)
# 3. Запустить бэкенд снова — воркер найдёт PROCESSING-задачу с истёкшим lease
# 4. attempt_count > 0 → воркер сначала делает GET /renewals/{key}
# 5. Если провайдер уже обработал → COMPLETED; иначе новый POST с тем же ключом

# Проверить у провайдера:
# GET http://127.0.0.1:8091/renewals/<encodeURIComponent(idempotency_key)>
# Возвращает {status:"completed", started_count:1, ...}
```

Значение `idempotency_key` берётся из поля в таблице `renewal_requests`.

---

## Защита от дублей

| Угроза | Механизм |
|---|---|
| Дублирующий approve | `UPDATE ... WHERE status='PENDING'` — если 0 строк → 409 |
| Параллельный approve | `SELECT FOR UPDATE` на строке заявки |
| Две активные заявки на ресурс | Partial unique index + перехват `23505` → 409 |
| Дублирующий job в outbox | `ON CONFLICT (request_id) DO NOTHING` |
| Повторная обработка COMPLETED | `UPDATE ... WHERE status='PROCESSING' RETURNING resource_id, new_date` → если 0 строк, ресурс не обновляется |

---

## Запуск тестов

```bash
cd backend
# Убедиться, что PostgreSQL запущен с renewals_test БД
# Тесты сами накатывают миграции и делают seed

npm test
```

Тесты используют:
- Порт 5433 (тестовая PostgreSQL)
- Порт 8092 (fake HTTP-сервер провайдера)
- `PROVIDER_RETRY_DELAY_MS=200` (для быстрых тестов)

---

## Компромиссы и что не сделано

- **Нет регистрации, SSO, уведомлений, брокера** — по условию задания
- **Воркер однопоточный** — `busy` флаг предотвращает параллельный запуск тиков в одном процессе; для масштабирования `SELECT FOR UPDATE SKIP LOCKED` обеспечивает безопасность при нескольких инстансах
- **Polling вместо WebSocket** — фронтенд опрашивает каждые 5 секунд
- **Lease timeout = 60s** — при краше задача подхватывается через минуту
- **Пароли = логин** — только для seed/тестов; в README задокументировано
