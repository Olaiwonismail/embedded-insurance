// Turns saved paid-order webhooks into policies.
// Each event is handled in one transaction, so a crash or an insureOnGo error
// never leaves a policy without its quote and event updated, or the other way round.

import { and, asc, eq, or, sql } from 'drizzle-orm';

import { Db } from '../../db';
import {
  customersTable,
  policiesTable,
  quotesTable,
  storesTable,
  webhookEventsTable,
} from '../../db/schema';
import { InsureongoClient } from '../insureongo';
import { PAID_ORDER_PLATFORMS } from './orders';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// premium (2dp) * rate, rounded half-up to 2dp. Exact decimal math, no floats.
export function commissionFor(premium: string, rate: string): string {
  const toScaled = (value: string, scale: number): bigint => {
    const [whole, frac = ''] = value.trim().split('.');
    return BigInt(whole + frac.padEnd(scale, '0').slice(0, scale));
  };
  const product = toScaled(premium, 2) * toScaled(rate, 4); // scale 6
  const cents = (product + 5000n) / 10000n;
  const str = cents.toString().padStart(3, '0');
  return `${str.slice(0, -2)}.${str.slice(-2)}`;
}

function paidOrderCondition() {
  return or(
    ...Object.entries(PAID_ORDER_PLATFORMS).map(([platform, { type }]) =>
      and(eq(storesTable.platform, platform), eq(webhookEventsTable.type, type)),
    ),
  );
}

async function markFailed(tx: Tx, eventId: number, error: string) {
  await tx
    .update(webhookEventsTable)
    .set({ status: 'failed', error })
    .where(eq(webhookEventsTable.id, eventId));
}

async function markProcessed(tx: Tx, eventId: number) {
  await tx
    .update(webhookEventsTable)
    .set({ status: 'processed', processedAt: new Date() })
    .where(eq(webhookEventsTable.id, eventId));
}

// Handles one event. Throws only if the insureOnGo call fails (or the database does);
// the transaction then rolls back and the event stays "received" for the next run.
export async function processWebhookEvent(
  db: Db,
  client: InsureongoClient,
  eventId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Skip rows another run is already working on.
    const [event] = await tx
      .select({
        id: webhookEventsTable.id,
        storeId: webhookEventsTable.storeId,
        type: webhookEventsTable.type,
        payload: webhookEventsTable.payload,
        platform: storesTable.platform,
        commissionRate: storesTable.commissionRate,
      })
      .from(webhookEventsTable)
      .innerJoin(storesTable, eq(storesTable.id, webhookEventsTable.storeId))
      .where(and(eq(webhookEventsTable.id, eventId), eq(webhookEventsTable.status, 'received')))
      .for('update', { of: webhookEventsTable, skipLocked: true })
      .limit(1);

    if (!event) return;

    const platform = Object.hasOwn(PAID_ORDER_PLATFORMS, event.platform)
      ? PAID_ORDER_PLATFORMS[event.platform]
      : undefined;
    if (!platform || platform.type !== event.type) return; // not a paid order: ignore

    const extracted = platform.extract(event.payload);
    if ('missing' in extracted) {
      await markFailed(tx, event.id, `missing fields: ${extracted.missing.join(', ')}`);
      return;
    }
    const { order } = extracted;

    // Second guard against duplicates. Checked before the quote, because once
    // a policy exists its quote is "accepted" and would otherwise fail the checks below.
    const issuanceKey = `${event.storeId}:${order.orderRef}:${order.quoteId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${issuanceKey}))`);

    const [existing] = await tx
      .select({ id: policiesTable.id })
      .from(policiesTable)
      .where(eq(policiesTable.issuanceKey, issuanceKey))
      .limit(1);
    if (existing) {
      await markProcessed(tx, event.id);
      return;
    }

    const [quote] = await tx
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.id, order.quoteId))
      .for('update')
      .limit(1);

    if (!quote) {
      await markFailed(tx, event.id, `quote not found: ${order.quoteId}`);
      return;
    }
    if (quote.storeId !== event.storeId) {
      await markFailed(tx, event.id, `quote ${quote.id} belongs to a different store`);
      return;
    }
    if (quote.status !== 'offered') {
      await markFailed(tx, event.id, `quote ${quote.id} status is ${quote.status}, not offered`);
      return;
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      await markFailed(tx, event.id, `quote ${quote.id} expired`);
      return;
    }

    // Find or create the customer by email. The lock stops two orders with
    // the same email from both creating a customer.
    const { name, email, phone } = order.customer;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'customer:' + email}))`);

    const [found] = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(sql`lower(${customersTable.email})`, email))
      .orderBy(asc(customersTable.id))
      .limit(1);

    let customerId: number;
    if (found) {
      customerId = found.id;
      // Keep the latest name and phone. A webhook without a phone keeps the old one.
      await tx
        .update(customersTable)
        .set({ name, ...(phone !== undefined ? { phone } : {}) })
        .where(eq(customersTable.id, customerId));
    } else {
      const [created] = await tx
        .insert(customersTable)
        .values({ name, email, phone: phone ?? null })
        .returning({ id: customersTable.id });
      customerId = created.id;
    }

    const issued = await client.issuePolicy({
      insureongoQuoteId: quote.insureongoQuoteId,
      name,
      email,
      ...(phone !== undefined ? { phone } : {}),
    });

    await tx.insert(policiesTable).values({
      quoteId: quote.id,
      storeId: event.storeId,
      customerId,
      settlementId: null,
      issuanceKey,
      orderRef: order.orderRef,
      policyNumber: issued.policyNumber,
      itemName: quote.itemName,
      itemCategory: quote.itemCategory,
      itemPrice: quote.itemPrice,
      premium: quote.premium,
      commissionAmount: commissionFor(quote.premium, event.commissionRate),
      status: 'active',
      startsAt: issued.startsAt,
      endsAt: issued.endsAt,
    });

    await tx
      .update(quotesTable)
      .set({ status: 'accepted' })
      .where(eq(quotesTable.id, quote.id));

    await markProcessed(tx, event.id);
  });
}

// Handles every "received" paid-order event, oldest first.
// One failing event does not stop the rest; it is tried again on the next run.
export async function runIssuanceWorker(db: Db, client: InsureongoClient): Promise<void> {
  const pending = await db
    .select({ id: webhookEventsTable.id })
    .from(webhookEventsTable)
    .innerJoin(storesTable, eq(storesTable.id, webhookEventsTable.storeId))
    .where(and(eq(webhookEventsTable.status, 'received'), paidOrderCondition()))
    .orderBy(asc(webhookEventsTable.id));

  for (const { id } of pending) {
    try {
      await processWebhookEvent(db, client, id);
    } catch (err: any) {
      // Never log err.message: driver errors embed query params (customer details).
      console.error('Policy issuance failed:', id, err?.name, err?.code ?? err?.cause?.code ?? '');
    }
  }
}

// Starts a run in the background without waiting for it. Only one run at a time;
// a start during a run asks for one more run afterwards, so no new event is missed.
let running = false;
let runAgain = false;

export function startIssuanceWorker(db: Db, client: InsureongoClient): void {
  if (running) {
    runAgain = true;
    return;
  }
  running = true;

  void (async () => {
    try {
      do {
        runAgain = false;
        await runIssuanceWorker(db, client);
      } while (runAgain);
    } catch (err: any) {
      console.error('Policy issuance worker failed:', err?.name, err?.code ?? err?.cause?.code ?? '');
    } finally {
      running = false;
    }
  })();
}
