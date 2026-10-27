import type { Request, Response } from 'express';
import { parseId } from '../../lib/ids';
import { addTransactionBody, listTransactionsQuery } from './transactions.schemas';
import * as service from './transactions.service';

type AccountParams = { accountId: string };
type TransactionParams = AccountParams & { transactionId: string };

export async function create(req: Request<AccountParams>, res: Response) {
  const accountId = parseId(req.params.accountId, 'Account');
  const result = await service.addTransaction(accountId, addTransactionBody.parse(req.body ?? {}));
  res.status(201).location(`/api/accounts/${accountId}/transactions/${result.transaction.id}`).json(result);
}

export async function list(req: Request<AccountParams>, res: Response) {
  const accountId = parseId(req.params.accountId, 'Account');
  res.json(await service.listTransactions(accountId, listTransactionsQuery.parse(req.query)));
}

export async function get(req: Request<TransactionParams>, res: Response) {
  const accountId = parseId(req.params.accountId, 'Account');
  const transactionId = parseId(req.params.transactionId, 'Transaction');
  res.json(await service.getTransaction(accountId, transactionId));
}

/** Transactions are append-only: editing or deleting one is never allowed. */
export function immutable(_req: Request, res: Response) {
  res
    .status(405)
    .set('Allow', 'GET')
    .json({ error: { code: 'TRANSACTION_IMMUTABLE', message: 'Transactions cannot be edited or deleted.' } });
}
