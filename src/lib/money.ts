import { Prisma } from '@prisma/client';
import { z } from 'zod';

/** Largest amount accepted in a single transaction. */
export const MAX_AMOUNT = new Prisma.Decimal('1000000000');
const AMOUNT_FORMAT = /^\d+(\.\d{1,2})?$/;

/**
 * Amounts arrive as JSON numbers (or numeric strings) and become exact decimals
 * straight away, so no balance arithmetic ever happens in floating point.
 */
export const amountSchema = z
  .union([z.number(), z.string().trim()], {
    error: (issue) => (issue.input === undefined ? 'This field is required' : 'Amount must be a number'),
  })
  .transform((value, ctx) => {
    const text = String(value);
    if (!AMOUNT_FORMAT.test(text)) {
      ctx.addIssue({ code: 'custom', message: 'Amount must be a positive number with at most 2 decimal places' });
      return z.NEVER;
    }
    const amount = new Prisma.Decimal(text);
    if (amount.lte(0)) {
      ctx.addIssue({ code: 'custom', message: 'Amount must be greater than 0' });
      return z.NEVER;
    }
    if (amount.gt(MAX_AMOUNT)) {
      ctx.addIssue({ code: 'custom', message: `Amount cannot exceed ${MAX_AMOUNT.toString()}` });
      return z.NEVER;
    }
    return amount;
  });

/** Decimal(18,2) -> JSON number. Values stay within the safe-integer range for 2 decimal places. */
export const toMoney = (value: Prisma.Decimal) => value.toNumber();
