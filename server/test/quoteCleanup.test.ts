import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../src/db';
import {
  customersTable,
  policiesTable,
  quotesTable,
  settlementsTable,
  storesTable,
} from '../src/db/schema';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import { CLEANUP_BATCH, runQuoteCleanup } from '../src/lib/quotes/cleanup';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

const NOW = new Date('2026-10-30T12:00:00Z');
const EXPIRED = new Date('2026-10-01T00:00:00Z');
const STILL_GOOD = new Date('2026-12-01T00:00:00Z');

async function insertStore() {
  const [store] = await db
    .insert(storesTable)
    .values({
      name: 'Cleanup Store',
      platform: 'custom',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['example.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail: 'billing@example.com',
      status: 'active',
    })
    .returning();
  return store;
}

let counter = 0;

function quoteValues(storeId: number, expiresAt: Date) {
  counter += 1;
  return {
    storeId,
    itemName: `Item ${counter}`,
    itemCategory: 'phones',
    itemPrice: '900000.00',
    itemCondition: 'new',
    insureongoQuoteId: `iog-${counter}`,
    insurerName: 'Acme Insurance',
    planName: 'Screen Protect',
    premium: '54000.00',
    expiresAt,
  };
}

async function insertQuote(storeId: number, expiresAt: Date) {
  const [quote] = await db.insert(quotesTable).values(quoteValues(storeId, expiresAt)).returning();
  return quote;
}

async function attachPolicy(storeId: number, quoteId: number) {
  counter += 1;
  const [customer] = await db
    .insert(customersTable)
    .values({ name: 'Buyer', email: `buyer${counter}@example.com` })
    .returning();

  await db.insert(policiesTable).values({
    quoteId,
    storeId,
    customerId: customer.id,
    issuanceKey: `key-${counter}`,
    orderRef: `ORDER-${counter}`,
    itemName: 'Item',
    itemCategory: 'phones',
    itemPrice: '900000.00',
    premium: '54000.00',
    commissionAmount: '5400.00',
    status: 'active',
  });
}

async function remainingQuoteIds(): Promise<number[]> {
  const rows = await db.select({ id: quotesTable.id }).from(quotesTable);
  return rows.map((row) => row.id);
}

describe('runQuoteCleanup', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table ${policiesTable} restart identity cascade`);
    await db.execute(sql`truncate table ${settlementsTable} restart identity cascade`);
    await db.execute(sql`truncate table ${quotesTable} restart identity cascade`);
    await db.execute(sql`truncate table ${customersTable} restart identity cascade`);
    await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
  });

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  it('deletes an expired quote nothing points to', async () => {
    const store = await insertStore();
    await insertQuote(store.id, EXPIRED);

    expect(await runQuoteCleanup(db, NOW)).toBe(1);
    expect(await remainingQuoteIds()).toEqual([]);
  });

  it('keeps an expired quote that became a policy', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id, EXPIRED);
    await attachPolicy(store.id, quote.id);

    expect(await runQuoteCleanup(db, NOW)).toBe(0);
    expect(await remainingQuoteIds()).toEqual([quote.id]);
  });

  it('keeps a quote that has not expired', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id, STILL_GOOD);

    expect(await runQuoteCleanup(db, NOW)).toBe(0);
    expect(await remainingQuoteIds()).toEqual([quote.id]);
  });

  it('deletes 2,500 expired quotes in rounds of 1,000', async () => {
    const store = await insertStore();
    const rows = Array.from({ length: 2500 }, () => quoteValues(store.id, EXPIRED));
    for (let at = 0; at < rows.length; at += 500) {
      await db.insert(quotesTable).values(rows.slice(at, at + 500));
    }

    // Counted at the driver, because drizzle's db is a proxy that cannot be spied on.
    const client = db.$client as { query: (...args: unknown[]) => unknown };
    const realQuery = client.query.bind(client);
    const statements: string[] = [];

    client.query = (...args: unknown[]) => {
      const first = args[0];
      const text =
        typeof first === 'string' ? first : String((first as { text?: string })?.text ?? '');
      statements.push(text.trim().toLowerCase());
      return realQuery(...args);
    };

    let deleted: number;
    try {
      deleted = await runQuoteCleanup(db, NOW);
    } finally {
      client.query = realQuery;
    }

    expect(CLEANUP_BATCH).toBe(1000);
    expect(deleted).toBe(2500);
    // 1000 + 1000 + 500, then the next select comes back empty.
    expect(statements.filter((text) => text.startsWith('delete from "quotes"'))).toHaveLength(3);
    expect(await remainingQuoteIds()).toEqual([]);
  });

  it('does nothing and does not fail on a second run', async () => {
    const store = await insertStore();
    await insertQuote(store.id, EXPIRED);

    expect(await runQuoteCleanup(db, NOW)).toBe(1);
    expect(await runQuoteCleanup(db, NOW)).toBe(0);
  });

  it('keeps going when only some of the expired quotes are free', async () => {
    const store = await insertStore();
    const free = await insertQuote(store.id, EXPIRED);
    const sold = await insertQuote(store.id, EXPIRED);
    await attachPolicy(store.id, sold.id);

    expect(await runQuoteCleanup(db, NOW)).toBe(1);
    expect(await remainingQuoteIds()).toEqual([sold.id]);
    expect(free.id).not.toBe(sold.id);
  });
});

describe('the job file', () => {
  it('knows nothing about timers, cron or queues', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const source = readFileSync(
      path.resolve(__dirname, '../src/lib/quotes/cleanup.ts'),
      'utf8',
    );

    for (const forbidden of ['node-cron', 'bullmq', 'setInterval', 'setTimeout', './schedule']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
