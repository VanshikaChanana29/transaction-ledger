import type { Request, Response } from 'express';
import { parseId } from '../../lib/ids';
import { createAccountBody } from './accounts.schemas';
import * as service from './accounts.service';

// Controllers only translate HTTP <-> service calls. Validation errors thrown by
// zod's .parse() are turned into 400 responses by the central error handler.

export async function create(req: Request, res: Response) {
  const account = await service.createAccount(createAccountBody.parse(req.body ?? {}));
  res.status(201).location(`/api/accounts/${account.id}`).json(account);
}

export async function get(req: Request<{ accountId: string }>, res: Response) {
  const account = await service.getAccount(parseId(req.params.accountId, 'Account'));
  res.json(service.toAccountView(account));
}

export async function balance(req: Request<{ accountId: string }>, res: Response) {
  res.json(await service.getBalance(parseId(req.params.accountId, 'Account')));
}
