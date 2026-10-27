/**
 * Integration tests against a real Postgres (the `ledger_test` database).
 * Run `npm run db:local` in another terminal first. Tables are emptied before the run.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

const app = createApp();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
let refCounter = 0;

beforeAll(async () => {
  // TRUNCATE doesn't fire the row-level immutability trigger, so it can reset test data.
  await prisma.$executeRawUnsafe('TRUNCATE transactions, accounts');
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createAccount(name = 'Test Account') {
  const res = await request(app).post('/api/accounts').send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function addTx(accountId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/accounts/${accountId}/transactions`)
    .send({ description: 'Test transaction', reference_id: `ref-${++refCounter}`, ...body });
}

async function balanceOf(accountId: string) {
  const res = await request(app).get(`/api/accounts/${accountId}/balance`);
  expect(res.status).toBe(200);
  return res.body.balance as number;
}

describe('create account', () => {
  it('creates an account with a system id, zero balance and timestamp', async () => {
    const res = await request(app).post('/api/accounts').send({ name: '  Asha Rao  ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Asha Rao',
      balance: 0,
      created_at: expect.any(String),
    });
    expect(res.headers.location).toBe(`/api/accounts/${res.body.id}`);
  });

  it('gives every account a unique id', async () => {
    const [a, b] = await Promise.all([createAccount('A'), createAccount('B')]);
    expect(a).not.toBe(b);
  });

  it('requires a name', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }]) {
      const res = await request(app).post('/api/accounts').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toHaveProperty('name');
    }
  });

  it('does not let the client set the initial balance, id or created_at', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .send({ name: 'Rich', balance: 1_000_000, id: UNKNOWN_ID, created_at: '2020-01-01' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details).sort()).toEqual(['balance', 'created_at', 'id']);
    expect(await prisma.account.count({ where: { name: 'Rich' } })).toBe(0);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app).post('/api/accounts').set('Content-Type', 'application/json').send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('transactions', () => {
  it('credit increases the balance (100 + 50 = 150)', async () => {
    const id = await createAccount();
    await addTx(id, { type: 'credit', amount: 100 });
    const res = await addTx(id, { type: 'credit', amount: 50, description: 'Salary', reference_id: 'salary-oct' });
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(150);
    expect(res.body.transaction).toEqual({
      id: expect.any(String),
      account_id: id,
      type: 'credit',
      amount: 50,
      description: 'Salary',
      reference_id: 'salary-oct',
      created_at: expect.any(String),
    });
  });

  it('debit decreases the balance (100 - 30 = 70)', async () => {
    const id = await createAccount();
    await addTx(id, { type: 'credit', amount: 100 });
    const res = await addTx(id, { type: 'debit', amount: 30 });
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(70);
    expect(await balanceOf(id)).toBe(70);
  });

  it('rejects a debit larger than the balance and leaves the balance unchanged', async () => {
    const id = await createAccount();
    await addTx(id, { type: 'credit', amount: 100 });
    const res = await addTx(id, { type: 'debit', amount: 150 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_BALANCE', details: { balance: 100, amount: 150 } });
    expect(await balanceOf(id)).toBe(100);
    expect(await prisma.transaction.count({ where: { accountId: id } })).toBe(1); // rejected debit not stored
  });

  it('allows a debit of exactly the balance', async () => {
    const id = await createAccount();
    await addTx(id, { type: 'credit', amount: 42.5 });
    const res = await addTx(id, { type: 'debit', amount: 42.5 });
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(0);
  });

  it('handles decimal amounts exactly', async () => {
    const id = await createAccount();
    await addTx(id, { type: 'credit', amount: 0.1 });
    await addTx(id, { type: 'credit', amount: 0.2 });
    expect(await balanceOf(id)).toBe(0.3);
  });

  it('validates the request body', async () => {
    const id = await createAccount();
    const res = await request(app)
      .post(`/api/accounts/${id}/transactions`)
      .send({ type: 'refund', amount: -5, description: '', reference_id: '' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details).sort()).toEqual(['amount', 'description', 'reference_id', 'type']);
  });

  it.each([0, -10, 12.345, 'ten'])('rejects amount %s', async (amount) => {
    const id = await createAccount();
    const res = await addTx(id, { type: 'credit', amount });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('amount');
    expect(await balanceOf(id)).toBe(0);
  });

  it('accepts type case-insensitively', async () => {
    const id = await createAccount();
    const res = await addTx(id, { type: 'CREDIT', amount: 10 });
    expect(res.status).toBe(201);
    expect(res.body.transaction.type).toBe('credit');
  });

  it('returns 404 for an unknown or malformed account id', async () => {
    for (const accountId of [UNKNOWN_ID, 'not-a-uuid']) {
      const res = await addTx(accountId, { type: 'credit', amount: 10 });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('duplicate reference_id', () => {
  it('does not create a second transaction or change the balance', async () => {
    const id = await createAccount();
    const first = await addTx(id, { type: 'credit', amount: 100, reference_id: 'INV-1' });
    expect(first.status).toBe(201);

    const again = await addTx(id, { type: 'credit', amount: 100, reference_id: 'INV-1' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(again.body.error.details.transaction.id).toBe(first.body.transaction.id);

    // Even with a different type/amount, the reference is what identifies the transaction.
    const different = await addTx(id, { type: 'debit', amount: 5, reference_id: 'INV-1' });
    expect(different.status).toBe(409);

    expect(await balanceOf(id)).toBe(100);
    expect(await prisma.transaction.count({ where: { accountId: id } })).toBe(1);
  });

  it('allows the same reference_id on different accounts', async () => {
    const a = await createAccount();
    const b = await createAccount();
    expect((await addTx(a, { type: 'credit', amount: 10, reference_id: 'SHARED' })).status).toBe(201);
    expect((await addTx(b, { type: 'credit', amount: 20, reference_id: 'SHARED' })).status).toBe(201);
    expect(await balanceOf(a)).toBe(10);
    expect(await balanceOf(b)).toBe(20);
  });

  it('a rejected debit does not reserve its reference_id', async () => {
    const id = await createAccount();
    expect((await addTx(id, { type: 'debit', amount: 10, reference_id: 'RETRY' })).status).toBe(422);
    await addTx(id, { type: 'credit', amount: 10 });
    expect((await addTx(id, { type: 'debit', amount: 10, reference_id: 'RETRY' })).status).toBe(201);
  });
});

describe('concurrency', () => {
  it('parallel debits never overdraw the account', async () => {
    const id = await createAccount();
    await addTx(id, { type: 'credit', amount: 100 });

    const results = await Promise.all(Array.from({ length: 10 }, () => addTx(id, { type: 'debit', amount: 30 })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 422)).toHaveLength(7);
    expect(await balanceOf(id)).toBe(10);
  });

  it('parallel requests with the same reference_id create exactly one transaction', async () => {
    const id = await createAccount();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => addTx(id, { type: 'credit', amount: 25, reference_id: 'RACE' })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(await balanceOf(id)).toBe(25);
  });
});

describe('balance', () => {
  it('returns account_id and balance', async () => {
    const id = await createAccount();
    const res = await request(app).get(`/api/accounts/${id}/balance`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ account_id: id, balance: 0 });
  });

  it('returns 404 for an unknown account', async () => {
    const res = await request(app).get(`/api/accounts/${UNKNOWN_ID}/balance`);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Account not found.' });
  });

  it('always equals the sum of its transactions (spec example: 100 + 50 - 30 - 20 = 100)', async () => {
    const id = await createAccount();
    await addTx(id, { type: 'credit', amount: 100 });
    await addTx(id, { type: 'credit', amount: 50 });
    await addTx(id, { type: 'debit', amount: 30 });
    await addTx(id, { type: 'debit', amount: 20 });
    await addTx(id, { type: 'debit', amount: 500 }); // rejected, must not count
    expect(await balanceOf(id)).toBe(100);
  });

  it('every account balance matches its transaction history', async () => {
    const mismatches = await prisma.$queryRaw<unknown[]>`
      SELECT a.id
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      GROUP BY a.id, a.balance
      HAVING a.balance <> COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0)`;
    expect(mismatches).toEqual([]);
  });
});

describe('transaction history', () => {
  let id: string;

  beforeAll(async () => {
    id = await createAccount('History');
    // 7 transactions in a known order: c1 c2 d1 c3 d2 c4 c5
    const plan: [string, number][] = [
      ['credit', 100], ['credit', 200], ['debit', 10], ['credit', 300], ['debit', 20], ['credit', 400], ['credit', 500],
    ];
    for (const [i, [type, amount]] of plan.entries()) {
      const res = await addTx(id, { type, amount, reference_id: `h-${i + 1}` });
      expect(res.status).toBe(201);
    }
  });

  it('returns latest first with pagination info', async () => {
    const res = await request(app).get(`/api/accounts/${id}/transactions?page=1&limit=3`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { reference_id: string }) => t.reference_id)).toEqual(['h-7', 'h-6', 'h-5']);
    expect(res.body.pagination).toEqual({ page: 1, limit: 3, total_records: 7, total_pages: 3 });
  });

  it('pages through every record exactly once', async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await request(app).get(`/api/accounts/${id}/transactions?page=${page}&limit=3`);
      seen.push(...res.body.data.map((t: { reference_id: string }) => t.reference_id));
    }
    expect(seen).toEqual(['h-7', 'h-6', 'h-5', 'h-4', 'h-3', 'h-2', 'h-1']);
  });

  it('filters by type', async () => {
    const credits = await request(app).get(`/api/accounts/${id}/transactions?type=credit`);
    expect(credits.body.data.every((t: { type: string }) => t.type === 'credit')).toBe(true);
    expect(credits.body.pagination.total_records).toBe(5);

    const debits = await request(app).get(`/api/accounts/${id}/transactions?type=debit`);
    expect(debits.body.data.map((t: { reference_id: string }) => t.reference_id)).toEqual(['h-5', 'h-3']);
    expect(debits.body.pagination).toEqual({ page: 1, limit: 10, total_records: 2, total_pages: 1 });
  });

  it('returns both types when no filter is given', async () => {
    const res = await request(app).get(`/api/accounts/${id}/transactions`);
    expect(res.body.pagination.total_records).toBe(7);
  });

  it('returns an empty page past the end', async () => {
    const res = await request(app).get(`/api/accounts/${id}/transactions?page=99&limit=3`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total_pages).toBe(3);
  });

  it('validates query parameters', async () => {
    for (const qs of ['type=refund', 'page=0', 'limit=0', 'limit=1000', 'page=abc']) {
      const res = await request(app).get(`/api/accounts/${id}/transactions?${qs}`);
      expect(res.status).toBe(400);
    }
  });

  it('returns 404 for an unknown account', async () => {
    const res = await request(app).get(`/api/accounts/${UNKNOWN_ID}/transactions`);
    expect(res.status).toBe(404);
  });

  it('a new account has an empty history', async () => {
    const fresh = await createAccount();
    const res = await request(app).get(`/api/accounts/${fresh}/transactions`);
    expect(res.body).toEqual({ data: [], pagination: { page: 1, limit: 10, total_records: 0, total_pages: 0 } });
  });
});

describe('immutability', () => {
  it('transactions cannot be edited or deleted through the API', async () => {
    const id = await createAccount();
    const { body } = await addTx(id, { type: 'credit', amount: 100 });
    const url = `/api/accounts/${id}/transactions/${body.transaction.id}`;

    for (const method of ['put', 'patch', 'delete'] as const) {
      const res = await request(app)[method](url).send({ amount: 1 });
      expect(res.status).toBe(405);
      expect(res.body.error.code).toBe('TRANSACTION_IMMUTABLE');
    }

    const after = await request(app).get(url);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(body.transaction);
    expect(await balanceOf(id)).toBe(100);
  });

  it('the database itself rejects updates and deletes', async () => {
    const id = await createAccount();
    const { body } = await addTx(id, { type: 'credit', amount: 100 });
    const where = { id: body.transaction.id };

    await expect(prisma.transaction.update({ where, data: { amount: 1 } })).rejects.toThrow(/immutable/);
    await expect(prisma.transaction.delete({ where })).rejects.toThrow(/immutable/);
    expect((await prisma.transaction.findUniqueOrThrow({ where })).amount.toNumber()).toBe(100);
  });

  it('the database rejects a negative balance', async () => {
    const id = await createAccount();
    await expect(prisma.account.update({ where: { id }, data: { balance: -1 } })).rejects.toThrow(
      /accounts_balance_non_negative/,
    );
  });

  it("can't read another account's transaction through a different account's URL", async () => {
    const a = await createAccount();
    const b = await createAccount();
    const { body } = await addTx(a, { type: 'credit', amount: 10 });
    const res = await request(app).get(`/api/accounts/${b}/transactions/${body.transaction.id}`);
    expect(res.status).toBe(404);
  });
});
