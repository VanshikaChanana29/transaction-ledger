import type { Account } from '@prisma/client';
import { notFound } from '../../lib/errors';
import { toMoney } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import type { CreateAccountBody } from './accounts.schemas';

export function toAccountView(a: Account) {
  return { id: a.id, name: a.name, balance: toMoney(a.balance), created_at: a.createdAt };
}

export async function createAccount(input: CreateAccountBody) {
  // Only the name comes from the client; id, balance (0) and created_at are defaults.
  const account = await prisma.account.create({ data: { name: input.name } });
  return toAccountView(account);
}

export async function getAccount(id: string) {
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) throw notFound('Account');
  return account;
}

export async function getBalance(id: string) {
  const account = await getAccount(id);
  return { account_id: account.id, balance: toMoney(account.balance) };
}
