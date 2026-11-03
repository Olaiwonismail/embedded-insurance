// One store's sales totals and recent policies, bills and events. The merchant
// dashboard shows it for the signed-in store; the admin store page for any store.

import { desc, eq, sql } from 'drizzle-orm';

import { Db } from '../db';
import { policiesTable, settlementsTable, webhookEventsTable } from '../db/schema';

const RECENT_LIMIT = 10;

// Policies count as sold once paid; cancelled ones and unpaid (pending) ones do not.
const SOLD = ['active', 'expired'];

export async function getStoreActivity(db: Db, storeId: number) {
  const isSold = sql`${policiesTable.status} in (${sql.join(
    SOLD.map((s) => sql`${s}`),
    sql`, `,
  )})`;

  const [[sales], recentPolicies, settlements, webhookEvents] = await Promise.all([
    db
      .select({
        policiesSold: sql<number>`count(*) filter (where ${isSold})::int`,
        pendingPolicies: sql<number>`count(*) filter (where ${policiesTable.status} = 'pending')::int`,
        premiumTotal: sql<string>`coalesce(sum(${policiesTable.premium}) filter (where ${isSold}), 0)::numeric(14, 2)::text`,
        commissionTotal: sql<string>`coalesce(sum(${policiesTable.commissionAmount}) filter (where ${isSold}), 0)::numeric(14, 2)::text`,
      })
      .from(policiesTable)
      .where(eq(policiesTable.storeId, storeId)),

    db
      .select({
        id: policiesTable.id,
        policyNumber: policiesTable.policyNumber,
        orderRef: policiesTable.orderRef,
        itemName: policiesTable.itemName,
        itemCategory: policiesTable.itemCategory,
        itemPrice: policiesTable.itemPrice,
        premium: policiesTable.premium,
        commissionAmount: policiesTable.commissionAmount,
        status: policiesTable.status,
        createdAt: policiesTable.createdAt,
      })
      .from(policiesTable)
      .where(eq(policiesTable.storeId, storeId))
      .orderBy(desc(policiesTable.createdAt), desc(policiesTable.id))
      .limit(RECENT_LIMIT),

    db
      .select({
        id: settlementsTable.id,
        periodStart: settlementsTable.periodStart,
        periodEnd: settlementsTable.periodEnd,
        policyCount: settlementsTable.policyCount,
        premiumTotal: settlementsTable.premiumTotal,
        commissionTotal: settlementsTable.commissionTotal,
        status: settlementsTable.status,
      })
      .from(settlementsTable)
      .where(eq(settlementsTable.storeId, storeId))
      .orderBy(desc(settlementsTable.periodStart))
      .limit(RECENT_LIMIT),

    // The event payload is left out: it can hold customer details.
    db
      .select({
        id: webhookEventsTable.id,
        eventId: webhookEventsTable.eventId,
        type: webhookEventsTable.type,
        status: webhookEventsTable.status,
        receivedAt: webhookEventsTable.receivedAt,
        processedAt: webhookEventsTable.processedAt,
      })
      .from(webhookEventsTable)
      .where(eq(webhookEventsTable.storeId, storeId))
      .orderBy(desc(webhookEventsTable.receivedAt), desc(webhookEventsTable.id))
      .limit(RECENT_LIMIT),
  ]);

  return { sales, recentPolicies, settlements, webhookEvents };
}
