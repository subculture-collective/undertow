import { eq } from 'drizzle-orm';
import { user } from '../db/auth-schema.js';
import { db } from '../db/index.js';
import { fail } from './problem.js';

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs a count-then-create under a lock on the owner's row, so parallel
 * requests can't each see room under a plan limit and all insert. NO KEY
 * UPDATE doesn't block the foreign-key checks of other inserts for this user.
 */
export function withOwnerLock<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('no key update');
    if (!owner) fail(401);
    return fn(tx);
  });
}
