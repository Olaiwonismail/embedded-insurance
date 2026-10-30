// Turns saved paid-order webhooks into policies.
//
// Each event goes through three steps, so no transaction is open while insureOnGo is called:
//   1. Reserve: checks, customer, and a "pending" policy that claims the issuanceKey. Commit.
//   2. Call insureOnGo, outside any transaction.
//   3. Activate: policy "active", quote "accepted", event "processed", in one transaction.
// If the process dies between 1 and 3, the pending policy is still there and the
// next run picks up from step 2. See docs/issuance-worker.md.

import { and, asc, eq, or, sql } from 'drizzle-orm';

import { Db } from '../../db';
import {
  customersTable,
  policiesTable,
  quotesTable,
  storesTable,
  webhookEventsTable,
} from '../../db/schema';
import { InsureongoClient, InsureongoPolicyInput } from '../insureongo';
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

export function paidOrderCondition() {
  return or(
    ...Object.entries(PAID_ORDER_PLATFORMS).map(([platform, { type }]) =>
      and(eq(storesTable.platform, platform), eq(webhookEventsTable.type, type)),
    ),
  );
}

function lockKey(tx: Tx, key: string) {
  return tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
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

// What step 2 needs. Null means the event is finished (processed, failed or ignored).
interface Reserved {
  eventId: number;
  policyId: number;
  quoteId: number;
  issuanceKey: string;
  call: InsureongoPolicyInput;
}

// Step 1. Returns null when there is nothing to issue.
async function reserve(db: Db, eventId: number): Promise<Reserved | null> {
  return db.transaction(async (tx) => {
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

    if (!event) return null;

    const platform = Object.hasOwn(PAID_ORDER_PLATFORMS, event.platform)
      ? PAID_ORDER_PLATFORMS[event.platform]
      : undefined;
    if (!platform || platform.type !== event.type) return null; // not a paid order: ignore

    const extracted = platform.extract(event.payload);
    if ('missing' in extracted) {
      await markFailed(tx, event.id, `missing fields: ${extracted.missing.join(', ')}`);
      return null;
    }
    const { order } = extracted;

    // Second guard against duplicates. Checked before the quote, because once
    // a policy exists its quote is "accepted" and would otherwise fail the checks below.
    const issuanceKey = `${event.storeId}:${order.orderRef}:${order.quoteId}`;
    await lockKey(tx, issuanceKey);

    const [existing] = await tx
      .select()
      .from(policiesTable)
      .where(eq(policiesTable.issuanceKey, issuanceKey))
      .limit(1);

    if (existing && existing.status !== 'pending') {
      await markProcessed(tx, event.id);
      return null;
    }

    if (existing) {
      // An earlier run reserved this order and stopped before it finished. Pick it up.
      const quoteRef = await tx
        .select({ insureongoQuoteId: quotesTable.insureongoQuoteId })
        .from(quotesTable)
        .where(eq(quotesTable.id, existing.quoteId));
      const customer = await tx
        .select()
        .from(customersTable)
        .where(eq(customersTable.id, existing.customerId));
      return {
        eventId: event.id,
        policyId: existing.id,
        quoteId: existing.quoteId,
        issuanceKey,
        call: {
          insureongoQuoteId: quoteRef[0].insureongoQuoteId,
          issuanceKey,
          name: customer[0].name,
          email: customer[0].email,
          ...(customer[0].phone ? { phone: customer[0].phone } : {}),
        },
      };
    }

    const [quote] = await tx
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.id, order.quoteId))
      .for('update')
      .limit(1);

    if (!quote) {
      await markFailed(tx, event.id, `quote not found: ${order.quoteId}`);
      return null;
    }
    if (quote.storeId !== event.storeId) {
      await markFailed(tx, event.id, `quote ${quote.id} belongs to a different store`);
      return null;
    }
    if (quote.status !== 'offered') {
      await markFailed(tx, event.id, `quote ${quote.id} status is ${quote.status}, not offered`);
      return null;
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      await markFailed(tx, event.id, `quote ${quote.id} expired`);
      return null;
    }
    // The quote stays "offered" while its policy is pending, so check for another order using it.
    const [taken] = await tx
      .select({ id: policiesTable.id })
      .from(policiesTable)
      .where(eq(policiesTable.quoteId, quote.id))
      .limit(1);
    if (taken) {
      await markFailed(tx, event.id, `quote ${quote.id} is already used by another order`);
      return null;
    }

    // Find or create the customer by email. The lock stops two orders with
    // the same email from both creating a customer.
    const { name, email, phone } = order.customer;
    await lockKey(tx, `customer:${email}`);

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

    // Claims the issuanceKey (unique) before insureOnGo is called.
    const [pending] = await tx
      .insert(policiesTable)
      .values({
        quoteId: quote.id,
        storeId: event.storeId,
        customerId,
        settlementId: null,
        issuanceKey,
        orderRef: order.orderRef,
        policyNumber: null,
        itemName: quote.itemName,
        itemCategory: quote.itemCategory,
        itemPrice: quote.itemPrice,
        premium: quote.premium,
        commissionAmount: commissionFor(quote.premium, event.commissionRate),
        status: 'pending',
      })
      .returning({ id: policiesTable.id });

    return {
      eventId: event.id,
      policyId: pending.id,
      quoteId: quote.id,
      issuanceKey,
      call: {
        insureongoQuoteId: quote.insureongoQuoteId,
        issuanceKey,
        name,
        email,
        ...(phone !== undefined ? { phone } : {}),
      },
    };
  });
}

// Handles one event. Throws only if the insureOnGo call fails (or the database does);
// the event then stays "received" and the next run tries again.
export async function processWebhookEvent(
  db: Db,
  client: InsureongoClient,
  eventId: number,
): Promise<void> {
  const reserved = await reserve(db, eventId);
  if (!reserved) return;

  // Step 2. No transaction and no row locks are held here.
  let issued;
  try {
    issued = await client.issuePolicy(reserved.call);
  } catch (err) {
    // insureOnGo said no or could not be reached: no policy was issued, so drop the
    // reservation. If this delete never runs (crash), the next run resumes it instead.
    await db
      .delete(policiesTable)
      .where(and(eq(policiesTable.id, reserved.policyId), eq(policiesTable.status, 'pending')));
    throw err;
  }

  // Step 3.
  await db.transaction(async (tx) => {
    await lockKey(tx, reserved.issuanceKey);

    const [policy] = await tx
      .select({ id: policiesTable.id, status: policiesTable.status })
      .from(policiesTable)
      .where(eq(policiesTable.issuanceKey, reserved.issuanceKey))
      .for('update')
      .limit(1);

    // A failed run elsewhere dropped the reservation. Leave the event "received";
    // the retry sends the same issuanceKey, so insureOnGo returns this same policy.
    if (!policy) {
      throw new Error('Pending policy no longer exists');
    }

    if (policy.status === 'pending') {
      await tx
        .update(policiesTable)
        .set({
          status: 'active',
          policyNumber: issued.policyNumber,
          startsAt: issued.startsAt,
          endsAt: issued.endsAt,
        })
        .where(eq(policiesTable.id, policy.id));

      await tx
        .update(quotesTable)
        .set({ status: 'accepted' })
        .where(eq(quotesTable.id, reserved.quoteId));
    }

    await markProcessed(tx, reserved.eventId);
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

