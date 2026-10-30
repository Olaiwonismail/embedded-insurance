// Deletes quotes that expired without being bought.

import { and, eq, inArray, lt, notExists, sql } from 'drizzle-orm';

import { Db } from '../../db';
import { policiesTable, quotesTable } from '../../db/schema';

// Small enough that one round never holds locks on the table for long.
export const CLEANUP_BATCH = 1000;

function hasNoPolicy(db: Db) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(policiesTable)
      .where(eq(policiesTable.quoteId, quotesTable.id)),
  );
}

export async function runQuoteCleanup(db: Db, now: Date): Promise<number> {
  let deleted = 0;

  for (;;) {
    const batch = await db
      .select({ id: quotesTable.id })
      .from(quotesTable)
      .where(and(lt(quotesTable.expiresAt, now), hasNoPolicy(db)))
      .limit(CLEANUP_BATCH);

    if (batch.length === 0) break;

    // The policy check is repeated here on purpose. policies.quoteId has no ON DELETE
    // rule, so a quote that gained a policy since the select above would raise a
    // foreign key error; this skips it instead.
    const removed = await db
      .delete(quotesTable)
      .where(
        and(
          inArray(
            quotesTable.id,
            batch.map((quote) => quote.id),
          ),
          hasNoPolicy(db),
        ),
      )
      .returning({ id: quotesTable.id });

    deleted += removed.length;
    if (removed.length === 0) break;
  }

  console.log(`Quote cleanup removed ${deleted} expired quotes`);
  return deleted;
}
