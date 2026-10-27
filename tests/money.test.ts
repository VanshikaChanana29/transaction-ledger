import { describe, expect, it } from 'vitest';
import '../src/lib/zodConfig';
import { amountSchema } from '../src/lib/money';

describe('amountSchema', () => {
  it.each([50, '50', 0.01, '19.99', 1_000_000_000])('accepts %s', (value) => {
    expect(amountSchema.safeParse(value).success).toBe(true);
  });

  it.each([0, -5, '-5', 1.234, 'abc', '', 1e21, 1_000_000_000.01, null, true])('rejects %s', (value) => {
    expect(amountSchema.safeParse(value).success).toBe(false);
  });

  it('keeps exact decimals (no floating point drift)', () => {
    const a = amountSchema.parse(0.1);
    const b = amountSchema.parse(0.2);
    expect(a.plus(b).toString()).toBe('0.3');
  });
});
