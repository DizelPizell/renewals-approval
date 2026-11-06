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

Воркер не использует `sleep()`. Задержка хранится в БД в поле `outbox_jobs.next_attempt_at`.

Цикл попытки:
1. POST `/renewals` с `Idempotency-Key` → первый вызов возвращает 503 (операция сохранена провайдером)
2. Воркер обновляет outbox_job: `attempt_count++`, `status=PENDING`, `next_attempt_at=NOW()+PROVIDER_RETRY_DELAY_MS`, `lease_until=NULL` — и завершает тик
3. По истечении `next_attempt_at` следующий тик подхватывает job
4. `attempt_count > 0` → сначала GET `/renewals/{key}` — если `status=completed` → COMPLETED
5. Если GET вернул 404 — повторный POST с тем же ключом
6. После 3 POST без подтверждения через GET → NEEDS_ATTENTION

Преимущество перед `sleep` внутри тика: воркер не блокируется; при краше между шагами 1 и 2 job остаётся в PROCESSING с `lease_until`, и другой экземпляр подхватит его после 60 секунд.

### Как воспроизвести сценарий с рестартом

```bash
# 1. Запустить симулятор и бэкенд с увеличенной задержкой:
python provider/provider_simulator.py &
PROVIDER_RETRY_DELAY_MS=15000 npm run start:dev

# 2. Создать и одобрить заявку (через UI или curl ниже)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"initiator-alpha","password":"initiator-alpha"}' | \
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).access_token))")

REQ=$(curl -s -X POST http://localhost:3000/renewal-requests \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"resourceId":"res-a-01"}')
RID=$(echo $REQ | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
IKEY=$(echo $REQ | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).idempotencyKey))")

ATOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"approver-alpha","password":"approver-alpha"}' | \
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).access_token))")
curl -s -X POST "http://localhost:3000/renewal-requests/$RID/approve" \
  -H "Authorization: Bearer $ATOKEN"

# 3. Через 5-7 секунд воркер сделал POST→503 и выпустил job обратно в PENDING
#    (attempt_count=1, next_attempt_at=NOW()+15s, lease_until=NULL)
sleep 7
# Убить бэкенд (Ctrl+C или kill)

# 4. Запустить бэкенд снова:
PROVIDER_RETRY_DELAY_MS=15000 npm run start:dev
# Воркер найдёт PENDING-job, дождётся next_attempt_at (~8 секунд),
# сделает GET /renewals/{key} → {status:"completed"} → COMPLETED

# 5. Проверить у провайдера (started_count=1 → второго POST не было):
curl http://127.0.0.1:8091/renewals/$(node -e "process.stdout.write(encodeURIComponent('$IKEY'))")
# → {"operation_id":"...","status":"completed","started_count":1,"resource_id":"res-a-01",...}

# 6. Статистика:
curl -s http://localhost:3000/stats?resource_id=res-a-01 -H "Authorization: Bearer $TOKEN"
# → {"operation_count":1}
curl -s http://localhost:3000/stats?resource_id=res-b-01 -H "Authorization: Bearer $TOKEN"
# → {"operation_count":0}
```

**Значение `idempotency_key`** берётся из поля `idempotencyKey` в ответе на POST /renewal-requests.

### Результат контрольного прогона (06.11.2026)

```
Pre-flight: DB сброшен — res-a-01 expiryDate = 2027-03-01

GET /resources → res-a-01 expiryDate: 2027-03-01   ← BEFORE

POST /renewal-requests → oldDate=2027-03-01, newDate=2027-03-31 (snapshot)
POST /approve          → PROCESSING

t+7s:   KILL backend
        outbox_job: status=PENDING, attempt_count=1,
                    next_attempt_at ≈ approve_time+15s, lease_until=NULL

restart → worker ждёт next_attempt_at → GET /renewals/{key} → {status:"completed"}
t+2s:   COMPLETED  (started_count=1 — повторного POST не было)

GET /resources → res-a-01 expiryDate: 2027-03-31   ← AFTER ✓

GET /renewal-requests/:id/history:
  null→PENDING (create) → PENDING→PROCESSING (approve) → PROCESSING→COMPLETED (worker)

GET /renewals/{key} (simulator):
  {"status":"completed","started_count":1,"resource_id":"res-a-01"}

GET /stats?resource_id=res-a-01 (backend) → {"operation_count":1}
GET /stats?resource_id=res-b-01 (backend) → {"operation_count":0}
```

Прежнее значение 2027-04-30 было ошибкой грязной БД (psql не нашёлся в PATH и reset-команда молча провалилась). Логика корректна: `expiryDate` берётся из снимка `new_date` заявки, который создаётся при POST /renewal-requests из `oldDate + 30 дней`.

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

### Интеграционные (20 тестов, fake provider)

```bash
cd backend
# PostgreSQL на :5433 с БД renewals_test обязателен
npm test
```

Используют: PostgreSQL :5433/renewals_test, fake HTTP-провайдер на :8092, `PROVIDER_RETRY_DELAY_MS=200`.

### E2E против реального симулятора (4 теста)

```bash
# 1. Запустить симулятор:
python provider/provider_simulator.py

# 2. В другом терминале:
cd backend
npx jest --testPathPattern e2e-real-provider --runInBand
```

E2E-тесты проверяют: health, POST→503→GET→completed, конфликт ключей идемпотентности, полный flow create→approve→COMPLETED с проверкой даты ресурса и статистики симулятора.

---

## Компромиссы и что не сделано

- **Нет регистрации, SSO, уведомлений, брокера** — по условию задания
- **Воркер однопоточный** — `busy` флаг предотвращает параллельный запуск тиков в одном процессе; для масштабирования `SELECT FOR UPDATE SKIP LOCKED` обеспечивает безопасность при нескольких инстансах
- **Нет `sleep` в воркере** — задержка между попытками хранится в `outbox_jobs.next_attempt_at`; воркер не блокируется; crash recovery при убитом процессе занимает время до следующего `next_attempt_at` плюс lease timeout (60s) как крайний случай
- **Polling вместо WebSocket** — фронтенд опрашивает каждые 5 секунд
- **Lease timeout = 60s** — если процесс убит в момент обращения к провайдеру (до освобождения job обратно в PENDING), задача подхватится через 60 секунд
- **Пароли = логин** — только для seed/тестов; в README задокументировано
