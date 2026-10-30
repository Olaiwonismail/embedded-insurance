import { readFileSync } from 'fs';
import path from 'path';
import { asc, eq, sql } from 'drizzle-orm';
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
import { createFakeEmailSender, Email, EmailSender } from '../src/lib/email';
import { runWeeklySettlement } from '../src/lib/settlement/weekly';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

// The week being billed: Friday 2026-10-23 00:00 to Friday 2026-10-30 00:00 Lagos.
const PERIOD_END = new Date('2026-10-29T23:00:00Z');
const PERIOD_START_DATE = '2026-10-23';
const PERIOD_END_DATE = '2026-10-30';
const IN_WEEK = new Date('2026-10-26T12:00:00Z');
const BEFORE_WEEK = new Date('2026-10-12T12:00:00Z');
const AFTER_PERIOD_END = new Date('2026-10-30T09:00:00Z');

let storeCounter = 0;

async function insertStore(overrides: Record<string, unknown> = {}) {
  storeCounter += 1;
  const [store] = await db
    .insert(storesTable)
    .values({
      name: `Store ${storeCounter}`,
      platform: 'custom',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['example.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail: `billing${storeCounter}@example.com`,
      status: 'active',
      ...overrides,
    })
    .returning();
  return store;
}

let policyCounter = 0;

async function insertPolicy(
  storeId: number,
  options: { status?: string; createdAt?: Date; premium?: string; commissionAmount?: string } = {},
) {
  policyCounter += 1;
  const [quote] = await db
    .insert(quotesTable)
    .values({
      storeId,
      itemName: `Item ${policyCounter}`,
      itemCategory: 'phones',
      itemPrice: '900000.00',
      itemCondition: 'new',
      insureongoQuoteId: `iog-${policyCounter}`,
      insurerName: 'Acme Insurance',
      planName: 'Screen Protect',
      premium: options.premium ?? '54000.00',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    })
    .returning();

  const [customer] = await db
    .insert(customersTable)
    .values({ name: `Buyer ${policyCounter}`, email: `buyer${policyCounter}@example.com` })
    .returning();

  const [policy] = await db
    .insert(policiesTable)
    .values({
      quoteId: quote.id,
      storeId,
      customerId: customer.id,
      issuanceKey: `key-${policyCounter}`,
      orderRef: `ORDER-${policyCounter}`,
      policyNumber: `POL-${policyCounter}`,
      itemName: `Item ${policyCounter}`,
      itemCategory: 'phones',
      itemPrice: '900000.00',
      premium: options.premium ?? '54000.00',
      commissionAmount: options.commissionAmount ?? '5400.00',
      status: options.status ?? 'active',
      createdAt: options.createdAt ?? IN_WEEK,
    })
    .returning();

  return policy;
}

function throwingSender(): EmailSender & { attempts: number } {
  return {
    attempts: 0,
    async send(_email: Email) {
      this.attempts += 1;
      throw new Error('provider down');
    },
  };
}

async function settlements() {
  return db.select().from(settlementsTable).orderBy(asc(settlementsTable.id));
}

describe('runWeeklySettlement', () => {
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

  it('bills three new policies as one row with the right totals', async () => {
    const store = await insertStore();
    const created = [
      await insertPolicy(store.id, { premium: '54000.00', commissionAmount: '5400.00' }),
      await insertPolicy(store.id, { premium: '10000.50', commissionAmount: '1000.05' }),
      await insertPolicy(store.id, { premium: '72500.50', commissionAmount: '7250.05' }),
    ];
    const sender = createFakeEmailSender();

    const result = await runWeeklySettlement(db, sender, PERIOD_END);

    const rows = await settlements();
    expect(rows).toHaveLength(1);
    expect(rows[0].policyCount).toBe(3);
    expect(rows[0].premiumTotal).toBe('136501.00');
    expect(rows[0].commissionTotal).toBe('13650.10');
    expect(rows[0].periodStart).toBe(PERIOD_START_DATE);
    expect(rows[0].periodEnd).toBe(PERIOD_END_DATE);
    expect(result.billed).toBe(1);

    const stamped = await db
      .select({ id: policiesTable.id, settlementId: policiesTable.settlementId })
      .from(policiesTable)
      .where(eq(policiesTable.storeId, store.id));
    expect(stamped).toHaveLength(3);
    for (const policy of stamped) expect(policy.settlementId).toBe(rows[0].id);
    expect(created).toHaveLength(3);
  });

  it('emails the billing address, lists every policy, and marks the row invoiced', async () => {
    const store = await insertStore();
    await insertPolicy(store.id);
    await insertPolicy(store.id);
    await insertPolicy(store.id);
    const sender = createFakeEmailSender();

    await runWeeklySettlement(db, sender, PERIOD_END);

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe(store.billingEmail);
    for (const number of ['POL-', 'ORDER-']) {
      expect(sender.sent[0].body).toContain(number);
    }
    expect(sender.sent[0].body).toContain('Policies: 3');
    expect(sender.sent[0].body.match(/order ORDER-/g)).toHaveLength(3);
    // No "amount due": who pays whom is not settled yet.
    expect(sender.sent[0].body.toLowerCase()).not.toContain('amount due');

    const [row] = await settlements();
    expect(row.sentAt).not.toBeNull();
    expect(row.status).toBe('invoiced');
  });

  it('skips a store with no new policies', async () => {
    await insertStore();
    const sender = createFakeEmailSender();

    const result = await runWeeklySettlement(db, sender, PERIOD_END);

    expect(await settlements()).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
    expect(result).toEqual({ billed: 0, emailed: 0 });
  });

  it('leaves out pending policies and ones created after the period ends', async () => {
    const store = await insertStore();
    await insertPolicy(store.id, { status: 'pending' });
    await insertPolicy(store.id, { createdAt: AFTER_PERIOD_END });
    const sender = createFakeEmailSender();

    await runWeeklySettlement(db, sender, PERIOD_END);

    expect(await settlements()).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });

  it('catches an unbilled policy left over from an earlier week', async () => {
    const store = await insertStore();
    await insertPolicy(store.id, { createdAt: BEFORE_WEEK });
    const sender = createFakeEmailSender();

    await runWeeklySettlement(db, sender, PERIOD_END);

    const rows = await settlements();
    expect(rows).toHaveLength(1);
    expect(rows[0].policyCount).toBe(1);
  });

  it('gives one row and one email per store when run twice for the same week', async () => {
    const first = await insertStore();
    const second = await insertStore();
    await insertPolicy(first.id);
    await insertPolicy(second.id);
    const sender = createFakeEmailSender();

    await runWeeklySettlement(db, sender, PERIOD_END);
    await runWeeklySettlement(db, sender, PERIOD_END);

    expect(await settlements()).toHaveLength(2);
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent.map((email) => email.to).sort()).toEqual(
      [first.billingEmail, second.billingEmail].sort(),
    );
  });

  it('keeps the row pending when sending fails, then sends once on the next run', async () => {
    const store = await insertStore();
    await insertPolicy(store.id);
    const failing = throwingSender();

    await runWeeklySettlement(db, failing, PERIOD_END);

    let rows = await settlements();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].sentAt).toBeNull();
    expect(failing.attempts).toBe(1);

    // This is the case the brief's own step order could not reach: the policies are
    // already stamped, so a run that looked for unbilled policies first would skip.
    const working = createFakeEmailSender();
    await runWeeklySettlement(db, working, PERIOD_END);

    rows = await settlements();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('invoiced');
    expect(rows[0].sentAt).not.toBeNull();
    expect(working.sent).toHaveLength(1);

    // And not a third time.
    await runWeeklySettlement(db, working, PERIOD_END);
    expect(working.sent).toHaveLength(1);
  });

  it('bills a later week separately', async () => {
    const store = await insertStore();
    await insertPolicy(store.id);
    const sender = createFakeEmailSender();

    await runWeeklySettlement(db, sender, PERIOD_END);
    await insertPolicy(store.id, { createdAt: new Date('2026-11-02T12:00:00Z') });
    await runWeeklySettlement(db, sender, new Date('2026-11-05T23:00:00Z'));

    const rows = await settlements();
    expect(rows).toHaveLength(2);
    expect(rows[1].periodStart).toBe('2026-10-30');
    expect(sender.sent).toHaveLength(2);
  });
});

describe('the job file', () => {
  it('knows nothing about timers, cron or queues', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/lib/settlement/weekly.ts'),
      'utf8',
    );

    for (const forbidden of ['node-cron', 'bullmq', 'setInterval', 'setTimeout', './schedule']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
