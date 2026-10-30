import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
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
import { createFakeEmailSender } from '../src/lib/email';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

const ADMIN_KEY = process.env.ADMIN_API_KEY!;

let counter = 0;

async function insertStore(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const [store] = await db
    .insert(storesTable)
    .values({
      name: `Store ${counter}`,
      platform: 'custom',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['example.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail: `billing${counter}@example.com`,
      status: 'active',
      ...overrides,
    })
    .returning();
  return store;
}

async function insertPolicy(
  storeId: number,
  options: { status?: string; premium?: string; commissionAmount?: string } = {},
) {
  counter += 1;
  const [quote] = await db
    .insert(quotesTable)
    .values({
      storeId,
      itemName: `Item ${counter}`,
      itemCategory: 'phones',
      itemPrice: '900000.00',
      itemCondition: 'new',
      insureongoQuoteId: `iog-${counter}`,
      insurerName: 'Acme Insurance',
      planName: 'Acme Basic Cover',
      premium: options.premium ?? '54000.00',
      expiresAt: new Date('2026-12-31T00:00:00Z'),
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
    policyNumber: `POL-${counter}`,
    itemName: `Item ${counter}`,
    itemCategory: 'phones',
    itemPrice: '900000.00',
    premium: options.premium ?? '54000.00',
    commissionAmount: options.commissionAmount ?? '5400.00',
    status: options.status ?? 'active',
  });
}

const app = () => createApp(db);

async function clearAll(): Promise<void> {
  await db.execute(sql`truncate table ${policiesTable} restart identity cascade`);
  await db.execute(sql`truncate table ${settlementsTable} restart identity cascade`);
  await db.execute(sql`truncate table ${quotesTable} restart identity cascade`);
  await db.execute(sql`truncate table ${customersTable} restart identity cascade`);
  await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
}

beforeEach(clearAll);

afterAll(async () => {
  await (db.$client as { end(): Promise<void> }).end();
});

describe('GET /v1/admin/stores/overview', () => {
  it('refuses a bad admin key', async () => {
    const res = await request(app())
      .get('/v1/admin/stores/overview')
      .set('x-admin-key', 'nope');

    expect(res.status).toBe(401);
  });

  it('adds up sold policies across every store', async () => {
    const first = await insertStore();
    const second = await insertStore();
    await insertPolicy(first.id, { premium: '54000.00', commissionAmount: '5400.00' });
    await insertPolicy(first.id, { premium: '81000.00', commissionAmount: '8100.00' });
    await insertPolicy(second.id, { premium: '13200.00', commissionAmount: '1320.00' });

    const res = await request(app())
      .get('/v1/admin/stores/overview')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      stores: 2,
      activeStores: 2,
      pendingStores: 0,
      policiesSold: 3,
      pendingPolicies: 0,
      premiumTotal: '148200.00',
      commissionTotal: '14820.00',
    });
  });

  it('leaves out unpaid and cancelled policies but counts the unpaid ones separately', async () => {
    const store = await insertStore();
    await insertPolicy(store.id, { status: 'active' });
    await insertPolicy(store.id, { status: 'pending' });
    await insertPolicy(store.id, { status: 'cancelled' });
    await insertPolicy(store.id, { status: 'expired' });

    const res = await request(app())
      .get('/v1/admin/stores/overview')
      .set('x-admin-key', ADMIN_KEY);

    // active + expired count as sold; cancelled counts for nothing.
    expect(res.body.totals.policiesSold).toBe(2);
    expect(res.body.totals.pendingPolicies).toBe(1);
    expect(res.body.totals.premiumTotal).toBe('108000.00');
  });

  it('breaks the same numbers down per store, including a store with none', async () => {
    const busy = await insertStore({ name: 'Busy Store' });
    const quiet = await insertStore({ name: 'Quiet Store', status: 'pending' });
    await insertPolicy(busy.id);

    const res = await request(app())
      .get('/v1/admin/stores/overview')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.body.stores).toHaveLength(2);
    const byName = new Map(res.body.stores.map((row: { name: string }) => [row.name, row]));
    expect(byName.get('Busy Store')).toMatchObject({
      status: 'active',
      policiesSold: 1,
      premiumTotal: '54000.00',
      commissionTotal: '5400.00',
    });
    expect(byName.get('Quiet Store')).toMatchObject({
      status: 'pending',
      policiesSold: 0,
      premiumTotal: '0.00',
      commissionTotal: '0.00',
    });
    expect(res.body.totals.pendingStores).toBe(1);
  });
});

describe('POST /v1/admin/stores/settlements/run', () => {
  it('refuses a bad admin key', async () => {
    const res = await request(app())
      .post('/v1/admin/stores/settlements/run')
      .set('x-admin-key', 'nope');

    expect(res.status).toBe(401);
  });

  // The whole point of the route: policies created moments ago must be billed. The
  // scheduled run bills up to the last Friday, which would miss them entirely.
  it('bills policies created just now', async () => {
    const store = await insertStore();
    await insertPolicy(store.id);
    const sender = createFakeEmailSender();

    const res = await request(createApp(db, () => {}, sender))
      .post('/v1/admin/stores/settlements/run')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.billed).toBe(1);
    expect(res.body.emailed).toBe(1);
    expect(res.body.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const rows = await db.select().from(settlementsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].policyCount).toBe(1);
    expect(rows[0].status).toBe('invoiced');
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe(store.billingEmail);
  });

  it('is safe to click twice', async () => {
    const store = await insertStore();
    await insertPolicy(store.id);
    const sender = createFakeEmailSender();
    const built = createApp(db, () => {}, sender);

    const first = await request(built)
      .post('/v1/admin/stores/settlements/run')
      .set('x-admin-key', ADMIN_KEY);
    const second = await request(built)
      .post('/v1/admin/stores/settlements/run')
      .set('x-admin-key', ADMIN_KEY);

    expect(first.body.billed).toBe(1);
    expect(second.body.billed).toBe(0);
    expect(await db.select().from(settlementsTable)).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
  });

  it('bills nothing when there are no new policies', async () => {
    await insertStore();
    const sender = createFakeEmailSender();

    const res = await request(createApp(db, () => {}, sender))
      .post('/v1/admin/stores/settlements/run')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.body).toMatchObject({ billed: 0, emailed: 0 });
    expect(await db.select().from(settlementsTable)).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });
});
