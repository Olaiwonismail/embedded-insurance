// Bills each store for its new policies, one bill per store per week.
//
// The row is found or created first and sending is its own step, so a bill whose email
// failed is sent by the next run. Selecting unbilled policies first would not do: by
// then they already carry a settlementId, so the store would look like it had nothing
// to bill and the unsent bill would never go out.

import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import { Db } from '../../db';
import { policiesTable, settlementsTable, storesTable } from '../../db/schema';
import { EmailSender } from '../email';
import { lagosDate, previousWeekBoundary } from '../lagos';

type Settlement = typeof settlementsTable.$inferSelect;

export interface WeeklySettlementResult {
  billed: number;
  emailed: number;
}

interface BillablePolicy {
  id: number;
  policyNumber: string | null;
  orderRef: string;
  itemName: string;
  premium: string;
  commissionAmount: string;
}

function addDecimals(values: string[]): string {
  // Kobo as integers, so no floating point is involved.
  const total = values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0);
  return (total / 100).toFixed(2);
}

async function billablePolicies(db: Db, storeId: number, before: Date): Promise<BillablePolicy[]> {
  return db
    .select({
      id: policiesTable.id,
      policyNumber: policiesTable.policyNumber,
      orderRef: policiesTable.orderRef,
      itemName: policiesTable.itemName,
      premium: policiesTable.premium,
      commissionAmount: policiesTable.commissionAmount,
    })
    .from(policiesTable)
    .where(
      and(
        eq(policiesTable.storeId, storeId),
        eq(policiesTable.status, 'active'),
        isNull(policiesTable.settlementId),
        lt(policiesTable.createdAt, before),
      ),
    )
    .orderBy(asc(policiesTable.id));
}

async function policiesOnBill(db: Db, settlementId: number): Promise<BillablePolicy[]> {
  return db
    .select({
      id: policiesTable.id,
      policyNumber: policiesTable.policyNumber,
      orderRef: policiesTable.orderRef,
      itemName: policiesTable.itemName,
      premium: policiesTable.premium,
      commissionAmount: policiesTable.commissionAmount,
    })
    .from(policiesTable)
    .where(eq(policiesTable.settlementId, settlementId))
    .orderBy(asc(policiesTable.id));
}

export function billEmail(
  storeName: string,
  periodStart: string,
  periodEnd: string,
  settlement: Settlement,
  policies: BillablePolicy[],
): { subject: string; body: string } {
  const lines = policies.map(
    (policy) =>
      `  ${policy.policyNumber ?? '(no number yet)'}  order ${policy.orderRef}  ` +
      `${policy.itemName}  premium ${policy.premium}  commission ${policy.commissionAmount}`,
  );

  return {
    subject: `insureOnGo statement for ${periodStart} to ${periodEnd}`,
    body: [
      `Statement for ${storeName}`,
      `Week: ${periodStart} to ${periodEnd}`,
      '',
      `Policies: ${settlement.policyCount}`,
      `Premium total: ${settlement.premiumTotal}`,
      `Commission total: ${settlement.commissionTotal}`,
      '',
      'Policies on this statement:',
      ...lines,
    ].join('\n'),
  };
}

// periodEnd is the Friday 00:00 Lagos instant that closed the week being billed.
export async function runWeeklySettlement(
  db: Db,
  sender: EmailSender,
  periodEnd: Date,
): Promise<WeeklySettlementResult> {
  const periodStart = lagosDate(previousWeekBoundary(periodEnd));
  const periodEndDate = lagosDate(periodEnd);

  const stores = await db
    .select({
      id: storesTable.id,
      name: storesTable.name,
      billingEmail: storesTable.billingEmail,
    })
    .from(storesTable)
    .orderBy(asc(storesTable.id));

  const result: WeeklySettlementResult = { billed: 0, emailed: 0 };

  for (const store of stores) {
    let [settlement] = await db
      .select()
      .from(settlementsTable)
      .where(
        and(eq(settlementsTable.storeId, store.id), eq(settlementsTable.periodStart, periodStart)),
      )
      .limit(1);

    if (!settlement) {
      const policies = await billablePolicies(db, store.id, periodEnd);
      if (policies.length === 0) continue;

      settlement = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(settlementsTable)
          .values({
            storeId: store.id,
            periodStart,
            periodEnd: periodEndDate,
            policyCount: policies.length,
            premiumTotal: addDecimals(policies.map((p) => p.premium)),
            commissionTotal: addDecimals(policies.map((p) => p.commissionAmount)),
            status: 'pending',
          })
          .onConflictDoNothing()
          .returning();

        // Another run inserted it between the read and this insert; use theirs.
        if (!created) {
          const [existing] = await tx
            .select()
            .from(settlementsTable)
            .where(
              and(
                eq(settlementsTable.storeId, store.id),
                eq(settlementsTable.periodStart, periodStart),
              ),
            )
            .limit(1);
          return existing;
        }

        await tx
          .update(policiesTable)
          .set({ settlementId: created.id })
          .where(
            and(
              inArray(
                policiesTable.id,
                policies.map((p) => p.id),
              ),
              isNull(policiesTable.settlementId),
            ),
          );

        return created;
      });

      result.billed += 1;
    }

    if (settlement.sentAt) continue;

    const onBill = await policiesOnBill(db, settlement.id);
    const { subject, body } = billEmail(
      store.name,
      settlement.periodStart,
      settlement.periodEnd,
      settlement,
      onBill,
    );

    try {
      await sender.send({ to: store.billingEmail, subject, body });
    } catch {
      // Leave the row pending and unsent; the next run tries again.
      continue;
    }

    await db
      .update(settlementsTable)
      .set({ sentAt: sql`now()`, status: 'invoiced' })
      .where(and(eq(settlementsTable.id, settlement.id), isNull(settlementsTable.sentAt)));

    result.emailed += 1;
  }

  return result;
}
