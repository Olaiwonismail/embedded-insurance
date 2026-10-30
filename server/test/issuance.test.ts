import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { createDb } from '../src/db';
import {
  customersTable,
  policiesTable,
  quotesTable,
  storesTable,
  webhookEventsTable,
} from '../src/db/schema';
import { InsureongoClient, fakeInsureongoClient } from '../src/lib/insureongo';
import { commissionFor, runIssuanceWorker } from '../src/lib/issuance/worker';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function insertStore(overrides: Partial<typeof storesTable.$inferInsert> = {}) {
  const [store] = await db
    .insert(storesTable)
    .values({
      name: 'Test Store',
      platform: 'custom',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['example.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1250',
      billingEmail: `billing-${Date.now()}-${Math.random()}@example.com`,
      status: 'active',
      ...overrides,
    })
    .returning();
  return store;
}

async function insertQuote(storeId: number, overrides: Partial<typeof quotesTable.$inferInsert> = {}) {
  const [quote] = await db
    .insert(quotesTable)
    .values({
      storeId,
      itemName: 'iPhone 15',
      itemCategory: 'phones',
      itemPrice: '999.99',
      itemCondition: 'new',
      insureongoQuoteId: `ig-${Math.random().toString(36).slice(2)}`,
      insurerName: 'Acme Insurance',
      planName: 'Acme Basic Cover',
      premium: '12.35',
      status: 'offered',
      expiresAt: new Date(Date.now() + 86_400_000),
      ...overrides,
    })
    .returning();
  return quote;
}

let eventCounter = 0;

async function insertEvent(storeId: number, type: string, payload: unknown) {
  const [event] = await db
    .insert(webhookEventsTable)
    .values({ storeId, eventId: `evt_${++eventCounter}`, type, payload, status: 'received' })
    .returning();
  return event;
}

function customBody(quoteId: number, overrides: Record<string, unknown> = {}) {
  return {
    eventId: `cust_${quoteId}`,
    type: 'order.paid',
    orderRef: 'ord_1001',
    quoteId,
    customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '+2348000000001' },
    ...overrides,
  };
}

async function getEvent(id: number) {
  const [row] = await db.select().from(webhookEventsTable).where(eq(webhookEventsTable.id, id));
  return row;
}

async function getQuote(id: number) {
  const [row] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
  return row;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('policy issuance worker', () => {
  beforeEach(async () => {
    await db.execute(
      sql`truncate table ${policiesTable}, ${customersTable}, ${quotesTable}, ${webhookEventsTable}, ${storesTable} restart identity cascade`,
    );
  });

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  it('creates one policy and one customer for a valid paid order', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    await insertEvent(store.id, 'order.paid', customBody(quote.id));

    await runIssuanceWorker(db, fakeInsureongoClient);

    expect(await db.select().from(policiesTable)).toHaveLength(1);
    const customers = await db.select().from(customersTable);
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+2348000000001',
    });
  });

  it('saves premium, commission, status, issuance key and item from the quote', async () => {
    const store = await insertStore({ commissionRate: '0.1250' });
    const quote = await insertQuote(store.id, { premium: '12.35' });
    await insertEvent(store.id, 'order.paid', customBody(quote.id));

    await runIssuanceWorker(db, fakeInsureongoClient);

    const [policy] = await db.select().from(policiesTable);
    expect(policy).toMatchObject({
      quoteId: quote.id,
      storeId: store.id,
      premium: '12.35',
      commissionAmount: '1.54', // 12.35 * 0.125 = 1.54375
      status: 'active',
      issuanceKey: `${store.id}:ord_1001:${quote.id}`,
      orderRef: 'ord_1001',
      policyNumber: `POL-${quote.insureongoQuoteId}`,
      itemName: quote.itemName,
      itemCategory: quote.itemCategory,
      itemPrice: quote.itemPrice,
      settlementId: null,
    });
    expect(policy.startsAt).toBeInstanceOf(Date);
    expect(policy.endsAt!.getTime()).toBeGreaterThan(policy.startsAt!.getTime());
  });

  it('moves the quote to accepted and the event to processed', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const event = await insertEvent(store.id, 'order.paid', customBody(quote.id));

    await runIssuanceWorker(db, fakeInsureongoClient);

    expect((await getQuote(quote.id)).status).toBe('accepted');
    const saved = await getEvent(event.id);
    expect(saved.status).toBe('processed');
    expect(saved.processedAt).toBeInstanceOf(Date);
    expect(saved.error).toBeNull();
  });

  it('creates only one policy when the same event is processed twice', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const event = await insertEvent(store.id, 'order.paid', customBody(quote.id));

    await runIssuanceWorker(db, fakeInsureongoClient);
    // As if the event were picked up again
    await db
      .update(webhookEventsTable)
      .set({ status: 'received', processedAt: null })
      .where(eq(webhookEventsTable.id, event.id));
    await runIssuanceWorker(db, fakeInsureongoClient);

    expect(await db.select().from(policiesTable)).toHaveLength(1);
    const saved = await getEvent(event.id);
    expect(saved.status).toBe('processed');
    expect(saved.processedAt).toBeInstanceOf(Date);
  });

  it('creates only one policy for two events with the same orderRef and quoteId', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const first = await insertEvent(store.id, 'order.paid', customBody(quote.id));
    const second = await insertEvent(store.id, 'order.paid', customBody(quote.id));

    await runIssuanceWorker(db, fakeInsureongoClient);

    expect(await db.select().from(policiesTable)).toHaveLength(1);
    expect((await getEvent(first.id)).status).toBe('processed');
    expect((await getEvent(second.id)).status).toBe('processed');
  });

  it('fails an event missing quoteId and names the field', async () => {
    const store = await insertStore();
    const { quoteId: _omit, ...body } = customBody(1);
    const event = await insertEvent(store.id, 'order.paid', body);

    await runIssuanceWorker(db, fakeInsureongoClient);

    const saved = await getEvent(event.id);
    expect(saved.status).toBe('failed');
    expect(saved.error).toBe('missing fields: quoteId');
    expect(await db.select().from(policiesTable)).toHaveLength(0);
  });

  it('names every missing field', async () => {
    const store = await insertStore();
    const event = await insertEvent(store.id, 'order.paid', {
      orderRef: 'ord_1',
      customer: { name: 'Jane' },
    });

    await runIssuanceWorker(db, fakeInsureongoClient);

    expect((await getEvent(event.id)).error).toBe('missing fields: quoteId, customer.email');
  });

  it('fails an event whose quote has expired', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id, { expiresAt: new Date(Date.now() - 1000) });
    const event = await insertEvent(store.id, 'order.paid', customBody(quote.id));

    await runIssuanceWorker(db, fakeInsureongoClient);

    const saved = await getEvent(event.id);
    expect(saved.status).toBe('failed');
    expect(saved.error).toMatch(/expired/);
    expect(await db.select().from(policiesTable)).toHaveLength(0);
    expect((await getQuote(quote.id)).status).toBe('offered');
  });

  it("fails an event whose quote belongs to another store", async () => {
    const store = await insertStore();
    const otherStore = await insertStore();
    const quote = await insertQuote(otherStore.id);
    const event = await insertEvent(store.id, 'order.paid', customBody(quote.id));

    await runIssuanceWorker(db, fakeInsureongoClient);

    const saved = await getEvent(event.id);
    expect(saved.status).toBe('failed');
    expect(saved.error).toMatch(/different store/);
    expect(await db.select().from(policiesTable)).toHaveLength(0);
  });

  it('fails an event whose quote does not exist', async () => {
    const store = await insertStore();
    const event = await insertEvent(store.id, 'order.paid', customBody(9999));

    await runIssuanceWorker(db, fakeInsureongoClient);

    const saved = await getEvent(event.id);
    expect(saved.status).toBe('failed');
    expect(saved.error).toMatch(/not found/);
  });

  it('leaves the event received when insureOnGo throws, then issues on the next run', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const event = await insertEvent(store.id, 'order.paid', customBody(quote.id));

    const failing: InsureongoClient = {
      ...fakeInsureongoClient,
      issuePolicy: vi.fn().mockRejectedValue(new Error('insureOnGo is down')),
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runIssuanceWorker(db, failing);
    errorLog.mockRestore();

    expect(failing.issuePolicy).toHaveBeenCalledTimes(1);
    let saved = await getEvent(event.id);
    expect(saved.status).toBe('received');
    expect(saved.error).toBeNull();
    expect(await db.select().from(policiesTable)).toHaveLength(0);
    expect((await getQuote(quote.id)).status).toBe('offered');

    await runIssuanceWorker(db, fakeInsureongoClient);

    saved = await getEvent(event.id);
    expect(saved.status).toBe('processed');
    expect(await db.select().from(policiesTable)).toHaveLength(1);
  });

  it('reuses a customer with the same email and keeps the latest details', async () => {
    const store = await insertStore();
    const firstQuote = await insertQuote(store.id);
    const secondQuote = await insertQuote(store.id);
    await insertEvent(store.id, 'order.paid', customBody(firstQuote.id, { orderRef: 'ord_1' }));
    await insertEvent(
      store.id,
      'order.paid',
      customBody(secondQuote.id, {
        orderRef: 'ord_2',
        customer: { name: 'Jane Smith', email: 'JANE@example.com', phone: '+2348000000002' },
      }),
    );

    await runIssuanceWorker(db, fakeInsureongoClient);

    const customers = await db.select().from(customersTable);
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ name: 'Jane Smith', phone: '+2348000000002' });
    const policies = await db.select().from(policiesTable);
    expect(policies).toHaveLength(2);
    expect(policies.every((p) => p.customerId === customers[0].id)).toBe(true);
  });

  // The receiver no longer issues anything itself; it hands the new row id over to be
  // queued. What the queue then does with it is covered in test/queue.test.ts.
  it('hands each newly saved event id over once, and nothing on a repeat', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const body = JSON.stringify(customBody(quote.id));
    const signature = crypto.createHmac('sha256', 'whsec_test').update(body).digest('hex');

    const queued: number[] = [];
    const app = createApp(db, (eventId) => queued.push(eventId));
    const send = () =>
      request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', signature)
        .set('X-InsureOnGo-Timestamp', String(Math.floor(Date.now() / 1000)))
        .send(body);

    expect((await send()).status).toBe(200);

    const [event] = await db.select().from(webhookEventsTable);
    expect(queued).toEqual([event.id]);

    // The same eventId saves no second row, so there is nothing new to queue.
    expect((await send()).status).toBe(200);
    expect(await db.select().from(webhookEventsTable)).toHaveLength(1);
    expect(queued).toEqual([event.id]);
  });

  it('holds no transaction or row locks while insureOnGo is called', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const event = await insertEvent(store.id, 'order.paid', customBody(quote.id));

    const checks: string[] = [];
    const client: InsureongoClient = {
      ...fakeInsureongoClient,
      async issuePolicy(input) {
        // Another connection: NOWAIT errors at once if a lock is still held.
        await db.select().from(quotesTable).where(eq(quotesTable.id, quote.id)).for('update', { noWait: true });
        await db.select().from(webhookEventsTable).where(eq(webhookEventsTable.id, event.id)).for('update', { noWait: true });
        // The reservation is already committed, so other runs can see it.
        const [policy] = await db.select().from(policiesTable);
        checks.push(policy.status);
        return fakeInsureongoClient.issuePolicy(input);
      },
    };

    await runIssuanceWorker(db, client);

    expect(checks).toEqual(['pending']);
    const [policy] = await db.select().from(policiesTable);
    expect(policy.status).toBe('active');
    expect((await getEvent(event.id)).status).toBe('processed');
  });

  it('picks up a pending policy left by a crash and finishes it', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const event = await insertEvent(store.id, 'order.paid', customBody(quote.id));
    const issuanceKey = `${store.id}:ord_1001:${quote.id}`;

    // What step 1 leaves behind if the process dies before step 3
    const [customer] = await db
      .insert(customersTable)
      .values({ name: 'Jane Doe', email: 'jane@example.com', phone: '+2348000000001' })
      .returning();
    await db.insert(policiesTable).values({
      quoteId: quote.id,
      storeId: store.id,
      customerId: customer.id,
      issuanceKey,
      orderRef: 'ord_1001',
      itemName: quote.itemName,
      itemCategory: quote.itemCategory,
      itemPrice: quote.itemPrice,
      premium: quote.premium,
      commissionAmount: '1.54',
      status: 'pending',
    });

    const client = { ...fakeInsureongoClient, issuePolicy: vi.fn(fakeInsureongoClient.issuePolicy) };
    await runIssuanceWorker(db, client);

    expect(client.issuePolicy).toHaveBeenCalledTimes(1);
    expect(client.issuePolicy).toHaveBeenCalledWith({
      insureongoQuoteId: quote.insureongoQuoteId,
      issuanceKey,
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+2348000000001',
    });
    const policies = await db.select().from(policiesTable);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({ status: 'active', policyNumber: `POL-${quote.insureongoQuoteId}` });
    expect((await getQuote(quote.id)).status).toBe('accepted');
    expect((await getEvent(event.id)).status).toBe('processed');
    expect(await db.select().from(customersTable)).toHaveLength(1);
  });

  it('fails a second order for a quote that already has a pending policy', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const [customer] = await db
      .insert(customersTable)
      .values({ name: 'Jane Doe', email: 'jane@example.com' })
      .returning();
    await db.insert(policiesTable).values({
      quoteId: quote.id,
      storeId: store.id,
      customerId: customer.id,
      issuanceKey: `${store.id}:ord_A:${quote.id}`,
      orderRef: 'ord_A',
      itemName: quote.itemName,
      itemCategory: quote.itemCategory,
      itemPrice: quote.itemPrice,
      premium: quote.premium,
      commissionAmount: '1.54',
      status: 'pending',
    });
    const event = await insertEvent(store.id, 'order.paid', customBody(quote.id, { orderRef: 'ord_B' }));

    await runIssuanceWorker(db, fakeInsureongoClient);

    const saved = await getEvent(event.id);
    expect(saved.status).toBe('failed');
    expect(saved.error).toMatch(/already used/);
    expect(await db.select().from(policiesTable)).toHaveLength(1);
  });

  it('ignores events that are not paid orders', async () => {
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const event = await insertEvent(store.id, 'order.refunded', customBody(quote.id));

    await runIssuanceWorker(db, fakeInsureongoClient);

    expect((await getEvent(event.id)).status).toBe('received');
    expect(await db.select().from(policiesTable)).toHaveLength(0);
  });
});

describe('commissionFor', () => {
  it('rounds premium times rate to 2 decimal places', () => {
    expect(commissionFor('12.35', '0.1250')).toBe('1.54');
    expect(commissionFor('4.99', '0.1000')).toBe('0.50');
    expect(commissionFor('10.05', '0.1000')).toBe('1.01'); // 1.005 rounds up
    expect(commissionFor('0.01', '0.1000')).toBe('0.00');
    expect(commissionFor('1000.00', '0.0525')).toBe('52.50');
  });
});
