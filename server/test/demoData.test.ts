import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../src/db';
import {
  customersTable,
  policiesTable,
  quotesTable,
  settlementsTable,
  storesTable,
  webhookEventsTable,
} from '../src/db/schema';
import { createFakeEmailSender } from '../src/lib/email';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import { runWeeklySettlement } from '../src/lib/settlement/weekly';
import {
  assertLocalDatabase,
  DEMO_STORE_NAME,
  removeDemoData,
  seedDemo,
} from '../scripts/demoData';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

let counter = 0;

async function insertStore(name: string, billingEmail: string) {
  counter += 1;
  const [store] = await db
    .insert(storesTable)
    .values({
      name,
      platform: 'custom',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['example.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail,
      status: 'active',
    })
    .returning();
  return store;
}

async function insertPolicy(storeId: number) {
  counter += 1;
  const [quote] = await db
    .insert(quotesTable)
    .values({
      storeId,
      itemName: 'iPhone 15',
      itemCategory: 'phones',
      itemPrice: '900000.00',
      itemCondition: 'new',
      insureongoQuoteId: `iog-${counter}`,
      insurerName: 'Acme Insurance',
      planName: 'Acme Basic Cover',
      premium: '54000.00',
      expiresAt: new Date('2027-12-31T00:00:00Z'),
    })
    .returning();
  const [customer] = await db
    .insert(customersTable)
    .values({ name: 'Buyer', email: `buyer${counter}@example.com` })
    .returning();
  await db.insert(policiesTable).values({
    quoteId: quote.id,
    storeId,
    customerId: customer.id,
    issuanceKey: `key-${counter}`,
    orderRef: `ORDER-${counter}`,
    itemName: 'iPhone 15',
    itemCategory: 'phones',
    itemPrice: '900000.00',
    premium: '54000.00',
    commissionAmount: '5400.00',
    status: 'active',
  });
}

async function clearAll(): Promise<void> {
  await db.execute(sql`truncate table ${policiesTable} restart identity cascade`);
  await db.execute(sql`truncate table ${settlementsTable} restart identity cascade`);
  await db.execute(sql`truncate table ${quotesTable} restart identity cascade`);
  await db.execute(sql`truncate table ${customersTable} restart identity cascade`);
  await db.execute(sql`truncate table ${webhookEventsTable} restart identity cascade`);
  await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
}

const count = async (table: typeof storesTable | typeof policiesTable | typeof customersTable) =>
  (await db.select({ id: table.id }).from(table)).length;

beforeEach(clearAll);

afterAll(async () => {
  await (db.$client as { end(): Promise<void> }).end();
});

describe('assertLocalDatabase', () => {
  it('accepts localhost, 127.0.0.1 and the docker compose database', () => {
    expect(assertLocalDatabase('postgres://u:p@localhost:5432/db')).toBe(
      'postgres://u:p@localhost:5432/db',
    );
    expect(() => assertLocalDatabase('postgres://u:p@127.0.0.1:5432/db')).not.toThrow();
    expect(() => assertLocalDatabase('postgres://u:p@db:5432/db')).not.toThrow();
  });

  it('refuses any other host, and a missing or broken URL', () => {
    expect(() => assertLocalDatabase('postgres://u:p@db.prod.internal:5432/db')).toThrow(
      /Refusing/,
    );
    expect(() => assertLocalDatabase('postgres://u:p@db.example.com:5432/db')).toThrow(/Refusing/);
    expect(() => assertLocalDatabase(undefined)).toThrow(/not set/);
    expect(() => assertLocalDatabase('not a url')).toThrow(/not a valid URL/);
  });
});

describe('seedDemo', () => {
  it('adds two active stores with billed, active policies', async () => {
    const result = await seedDemo(db);

    expect(result).toEqual({ stores: 2, policies: 5, skipped: false });
    const stores = await db.select().from(storesTable);
    expect(stores.map((s) => s.status)).toEqual(['active', 'active']);
    const policies = await db.select().from(policiesTable);
    expect(policies.every((p) => p.status === 'active' && p.settlementId !== null)).toBe(true);
    const settlements = await db.select().from(settlementsTable);
    expect(settlements.map((s) => s.status)).toEqual(['invoiced', 'invoiced']);
  });

  it('prices each policy at 6% of the item', async () => {
    await seedDemo(db);

    const policies = await db.select().from(policiesTable);
    for (const policy of policies) {
      expect(Number(policy.premium)).toBeCloseTo(Number(policy.itemPrice) * 0.06, 2);
    }
  });

  it('does nothing when run a second time', async () => {
    await seedDemo(db);
    const again = await seedDemo(db);

    expect(again.skipped).toBe(true);
    expect(await count(storesTable)).toBe(2);
  });

  it('leaves the bill-run button nothing of its own to bill', async () => {
    await seedDemo(db);

    const result = await runWeeklySettlement(db, createFakeEmailSender(), new Date());

    expect(result.billed).toBe(0);
  });
});

describe('removeDemoData', () => {
  it('removes the seed and Demo Gadgets with their rows, and nothing else', async () => {
    await seedDemo(db);
    const demo = await insertStore(DEMO_STORE_NAME, 'owner@demogadgets.example');
    await insertPolicy(demo.id);
    await db.insert(webhookEventsTable).values({
      storeId: demo.id,
      eventId: 'evt_1',
      type: 'order.paid',
      payload: {},
    });
    const other = await insertStore('Real Shop', 'billing@realshop.example');
    await insertPolicy(other.id);

    const result = await removeDemoData(db);

    expect(result).toEqual({ stores: 3, policies: 6 });
    const left = await db.select().from(storesTable);
    expect(left.map((s) => s.name)).toEqual(['Real Shop']);
    expect(await count(policiesTable)).toBe(1);
    expect(await count(customersTable)).toBe(1);
    expect(await db.select().from(quotesTable).where(eq(quotesTable.storeId, other.id))).toHaveLength(1);
    expect(await db.select().from(webhookEventsTable)).toHaveLength(0);
  });

  it('can be followed by a fresh seed', async () => {
    await seedDemo(db);
    await removeDemoData(db);

    expect(await count(storesTable)).toBe(0);
    expect((await seedDemo(db)).skipped).toBe(false);
  });
});
