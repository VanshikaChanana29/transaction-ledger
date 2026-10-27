import { Prisma, type Transaction } from '@prisma/client';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { toMoney } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import { getAccount } from '../accounts/accounts.service';
import type { AddTransactionBody, ListTransactionsQuery } from './transactions.schemas';

export function toTransactionView(t: Transaction) {
  return {
    id: t.id,
    account_id: t.accountId,
    type: t.type,
    amount: toMoney(t.amount),
    description: t.description,
    reference_id: t.referenceId,
    created_at: t.createdAt,
  };
}

const duplicate = (existing: Transaction) =>
  conflict(
    'DUPLICATE_TRANSACTION',
    `A transaction with reference_id "${existing.referenceId}" already exists for this account. No new transaction was created.`,
    { transaction: toTransactionView(existing) },
  );

const findByReference = (accountId: string, referenceId: string) =>
  prisma.transaction.findUnique({ where: { accountId_referenceId: { accountId, referenceId } } });

/**
 * Records a transaction and moves the balance in one database transaction:
 * either both happen or neither does.
 *
 * Concurrency:
 * - The balance change is a single conditional UPDATE (`... WHERE balance >= amount`
 *   for debits). Postgres locks the account row for it, so concurrent writes to one
 *   account queue up and each re-checks the balance after the previous one commits.
 *   Two debits can never both spend the same money.
 * - Duplicate reference_ids are caught by the unique index, not just the pre-check,
 *   so two identical requests racing each other still produce one transaction. The
 *   loser's balance change is rolled back with it.
 */
export async function addTransaction(accountId: string, input: AddTransactionBody) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const account = await tx.account.findUnique({ where: { id: accountId }, select: { id: true } });
        if (!account) throw notFound('Account');

        const existing = await tx.transaction.findUnique({
          where: { accountId_referenceId: { accountId, referenceId: input.referenceId } },
        });
        if (existing) throw duplicate(existing);

        const { count } =
          input.type === 'credit'
            ? await tx.account.updateMany({
                where: { id: accountId },
                data: { balance: { increment: input.amount } },
              })
            : await tx.account.updateMany({
                where: { id: accountId, balance: { gte: input.amount } },
                data: { balance: { decrement: input.amount } },
              });

        if (count === 0) {
          const { balance } = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { balance: true } });
          throw unprocessable('INSUFFICIENT_BALANCE', 'Insufficient balance. The transaction was rejected and the balance is unchanged.', {
            balance: toMoney(balance),
            amount: toMoney(input.amount),
          });
        }

        const transaction = await tx.transaction.create({
          data: {
            accountId,
            type: input.type,
            amount: input.amount,
            description: input.description,
            referenceId: input.referenceId,
          },
        });
        const { balance } = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { balance: true } });
        return { transaction: toTransactionView(transaction), balance: toMoney(balance) };
      },
      // Writes to one account are serialised, so a burst of them may queue briefly.
      { maxWait: 10_000, timeout: 10_000 },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await findByReference(accountId, input.referenceId);
      if (existing) throw duplicate(existing);
    }
    throw err;
  }
}

export async function listTransactions(accountId: string, q: ListTransactionsQuery) {
  await getAccount(accountId); // 404 for unknown accounts instead of an empty list

  const where: Prisma.TransactionWhereInput = { accountId, ...(q.type && { type: q.type }) };
  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      // Latest first. seq breaks ties between rows created in the same millisecond.
      orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
  ]);

  return {
    data: rows.map(toTransactionView),
    pagination: {
      page: q.page,
      limit: q.limit,
      total_records: total,
      total_pages: Math.ceil(total / q.limit),
    },
  };
}

export async function getTransaction(accountId: string, transactionId: string) {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.accountId !== accountId) throw notFound('Transaction');
  return toTransactionView(transaction);
}
