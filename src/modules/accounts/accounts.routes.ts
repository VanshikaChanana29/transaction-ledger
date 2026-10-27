import { Router } from 'express';
import * as tx from '../transactions/transactions.controller';
import * as c from './accounts.controller';

export const accountsRouter = Router();

accountsRouter.post('/', c.create);
accountsRouter.get('/:accountId', c.get);
accountsRouter.get('/:accountId/balance', c.balance);

accountsRouter.route('/:accountId/transactions').get(tx.list).post(tx.create);
accountsRouter
  .route('/:accountId/transactions/:transactionId')
  .get(tx.get)
  .put(tx.immutable)
  .patch(tx.immutable)
  .delete(tx.immutable);
