# Transaction Ledger API

A backend API for a simple ledger: create accounts, post credit and debit transactions, and read balances and transaction history.

**Stack:** Node 20, TypeScript, Express 5, PostgreSQL, Prisma, Zod, Vitest + Supertest.

- **API docs (Swagger):** http://localhost:4100/api/docs (the spec is in [openapi.yaml](openapi.yaml))

---

## Running locally

Requirements: Node 20+. **You don't need to install Postgres:** `npm run db:local` downloads and runs one through npm.

```bash
npm install
cp .env.example .env
npm run db:local      # terminal 1: Postgres on :5434 (leave running)
npm run db:migrate    # terminal 2: create the tables
npm run dev           # API on http://localhost:4100
```

| Command | What it does |
|---|---|
| `npm test` | 54 tests: unit tests for amount parsing, plus integration tests against a real Postgres (its own `ledger_test` database, migrated automatically) |
| `npm run build && npm start` | Production build |

To use your own Postgres instead, set `DATABASE_URL` in `.env` (and `TEST_DATABASE_URL` for tests).

---

## API

All routes are under `/api`. Request and response fields use snake_case, as in the brief.

| Method | Route | Description |
|---|---|---|
| `POST` | `/accounts` | Create an account. Body: `{ "name" }`. Balance starts at 0 |
| `GET` | `/accounts/:id` | Account details |
| `GET` | `/accounts/:id/balance` | `{ account_id, balance }` |
| `POST` | `/accounts/:id/transactions` | Add a transaction. Body: `{ type, amount, description, reference_id }` |
| `GET` | `/accounts/:id/transactions?type=&page=&limit=` | History, latest first, paginated |
| `GET` | `/accounts/:id/transactions/:txId` | One transaction |
| `PUT` `PATCH` `DELETE` | `/accounts/:id/transactions/:txId` | Always `405`: transactions are immutable |

### Example

```bash
# Create an account
curl -s -X POST localhost:4100/api/accounts -H 'Content-Type: application/json' -d '{"name":"Asha Rao"}'
# {"id":"3f0c…","name":"Asha Rao","balance":0,"created_at":"2026-10-27T08:30:00.000Z"}

# Credit 100
curl -s -X POST localhost:4100/api/accounts/3f0c…/transactions -H 'Content-Type: application/json' \
  -d '{"type":"credit","amount":100,"description":"Opening deposit","reference_id":"dep-1"}'
# 201 {"transaction":{…},"balance":100}

# Debit 150: rejected
# 422 {"error":{"code":"INSUFFICIENT_BALANCE","message":"…","details":{"balance":100,"amount":150}}}

# Same reference_id again: nothing changes
# 409 {"error":{"code":"DUPLICATE_TRANSACTION","message":"…","details":{"transaction":{…the original…}}}}

# History
curl -s 'localhost:4100/api/accounts/3f0c…/transactions?type=credit&page=1&limit=10'
# {"data":[…],"pagination":{"page":1,"limit":10,"total_records":1,"total_pages":1}}
```

### Status codes

| Code | When |
|---|---|
| `201` | Account or transaction created |
| `400 VALIDATION_ERROR` | Missing or invalid fields; `details` lists them per field. Also returned if the client tries to set `balance`, `id` or `created_at` |
| `404 NOT_FOUND` | Account (or transaction) doesn't exist. A malformed id also gets 404, since it can't exist |
| `405 TRANSACTION_IMMUTABLE` | Attempt to edit or delete a transaction |
| `409 DUPLICATE_TRANSACTION` | `reference_id` already used on this account. The original transaction is returned in `details` |
| `422 INSUFFICIENT_BALANCE` | Debit larger than the balance. Current balance is returned in `details` |

---

## Design decisions

### Balance consistency

The balance is stored on the account and updated **in the same database transaction** as the insert into `transactions`, so the two can never disagree: either both are committed or neither is. A rejected or failed transaction rolls back completely.

A test checks the invariant directly in SQL for every account: `balance = sum(credits) − sum(debits)`.

### Concurrency (no double spending)

A naive "read balance, check, write balance" lets two debits both see 100 and both succeed. Instead, the debit is a single conditional statement:

```sql
UPDATE accounts SET balance = balance - :amount WHERE id = :id AND balance >= :amount
```

Postgres locks the account row for the update. Concurrent writes to the same account queue up, and each one re-checks `balance >= amount` against the committed value. If no row was updated, the debit is rejected. A test fires 10 parallel debits of 30 at a balance of 100: exactly 3 succeed and the balance ends at 10.

As a backstop, a `CHECK (balance >= 0)` constraint makes a negative balance impossible at the database level.

### Duplicate transactions (idempotency)

A unique index on `(account_id, reference_id)` enforces the rule, so the same `reference_id` is allowed on different accounts. The service checks for an existing reference first to give a clean `409`. If two identical requests race past that check, the index rejects the second insert, its balance change is rolled back with it, and it also gets `409`. A test sends 8 parallel requests with the same reference: one transaction is created and the balance moves once.

A debit rejected for insufficient balance does **not** use up its `reference_id`, so the client can retry it with the same reference after topping up.

### Immutability, at three levels

1. **API:** there are no update or delete routes; `PUT`/`PATCH`/`DELETE` return `405`.
2. **Code:** the service only ever inserts into `transactions`.
3. **Database:** a trigger rejects every `UPDATE` and `DELETE` on `transactions`, so even a manual query or a future bug can't rewrite history. Accounts with transactions can't be deleted either (`ON DELETE RESTRICT`).

### Money

Amounts are stored as `DECIMAL(18,2)` and handled as exact decimals in code, so there is no floating-point drift (`0.1 + 0.2` is exactly `0.3`, which is tested). The API accepts positive amounts with up to 2 decimal places, up to 1,000,000,000 per transaction.

### Ordering and pagination

History is sorted by `created_at` descending. Two transactions can share a millisecond, so an internal insertion sequence (`seq`) breaks ties. This keeps page boundaries stable, so no row appears twice or goes missing while paging. An index on `(account_id, created_at DESC, seq DESC)` serves both the filter and the sort.

### Out of scope

The brief doesn't ask for authentication, so the API is open. In production it would sit behind auth, with each account owned by a user. Other things left out: currencies, transfers between accounts, and listing all accounts.

## Project structure

```
prisma/
  schema.prisma          accounts + transactions
  migrations/0001_init   tables, CHECK constraints, immutability trigger
src/
  app.ts                 Express app, Swagger UI, error handling
  lib/                   errors, money (amount parsing), ids, prisma client
  middleware/            central error handler -> { error: { code, message, details } }
  modules/accounts/      routes -> controller -> service
  modules/transactions/  controller, schemas, service (ledger logic lives here)
tests/
  ledger.test.ts         integration tests (real Postgres)
  money.test.ts          unit tests
scripts/localDb.ts       embedded Postgres for local dev
openapi.yaml             API spec
```
