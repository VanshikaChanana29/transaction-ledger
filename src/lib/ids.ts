import { z } from 'zod';
import { notFound } from './errors';

const idSchema = z.guid();

/**
 * A malformed id can't match any row, so it gets the same 404 as an unknown one
 * (rather than a Postgres "invalid input syntax for type uuid" 500).
 */
export function parseId(value: string, resource: string) {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw notFound(resource);
  return parsed.data;
}
