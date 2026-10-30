// Seeding and removing the data the demo runs against. Only rows that can be
// identified as demo data are ever touched: stores whose billing email is on
// SEED_EMAIL_DOMAIN, and the store the demo signs up live as DEMO_STORE_NAME.

import { and, eq, inArray, like, notExists, or } from 'drizzle-orm';

import { Db } from '../src/db';
import {
  customersTable,
  policiesTable,
  quotesTable,
  settlementsTable,
  storesTable,
  webhookEventsTable,
} from '../src/db/schema';
import { FAKE_BASIC_RATE } from '../src/lib/insureongo';
import { commissionFor } from '../src/lib/issuance/worker';
import { generatePublicKey, generateSecretKey, generateWebhookSecret, hashSecretKey } from '../src/lib/keys';
import { lagosDate, previousWeekBoundary, weekBoundaryAtOrBefore } from '../src/lib/lagos';
import { encryptSecret } from '../src/lib/secrets';

export const SEED_EMAIL_DOMAIN = 'seed.demo';
export const DEMO_STORE_NAME = 'Demo Gadgets';

// "db" is the docker compose database, for when the scripts run inside the api container.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'db'];
const DAY_MS = 24 * 60 * 60 * 1000;

// Refuses anything but a database on this machine, so a production DATABASE_URL
// left in .env can never be seeded or wiped.
export function assertLocalDatabase(url: string | undefined): string {
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to touch the database at "${host}". The demo scripts only run against ` +
        `localhost, 127.0.0.1 or the docker compose database "db", for example ` +
        `DATABASE_URL=postgres://user:pass@localhost:5432/insurance`,
    );
  }
  return url;
}

interface SeedPolicy {
  itemName: string;
  itemCategory: string;
  itemPrice: number;
  customer: { name: string; email: string; phone: string };
}

interface SeedStore {
  name: string;
  domain: string;
  categories: string[];
  commissionRate: string;
  policies: SeedPolicy[];
}

const SEED_STORES: SeedStore[] = [
  {
    name: 'Lekki Phone Hub',
    domain: 'lekkiphonehub.ng',
    categories: ['phones', 'tablets'],
    commissionRate: '0.1000',
    policies: [
      {
        itemName: 'Samsung Galaxy S24',
        itemCategory: 'phones',
        itemPrice: 780000,
        customer: { name: 'Adaeze Okafor', email: 'adaeze@example.com', phone: '+2348031234567' },
      },
      {
        itemName: 'iPhone 14',
        itemCategory: 'phones',
        itemPrice: 650000,
        customer: { name: 'Tunde Bakare', email: 'tunde@example.com', phone: '+2348057654321' },
      },
      {
        itemName: 'iPad 10th Gen',
        itemCategory: 'tablets',
        itemPrice: 480000,
        customer: { name: 'Ngozi Eze', email: 'ngozi@example.com', phone: '+2348091112233' },
      },
    ],
  },
  {
    name: 'Ikeja Laptop Store',
    domain: 'ikejalaptops.ng',
    categories: ['laptops'],
    commissionRate: '0.1200',
    policies: [
      {
        itemName: 'Dell XPS 13',
        itemCategory: 'laptops',
        itemPrice: 1250000,
        customer: { name: 'Ibrahim Musa', email: 'ibrahim@example.com', phone: '+2348024445566' },
      },
      {
        itemName: 'HP EliteBook 840',
        itemCategory: 'laptops',
        itemPrice: 980000,
        customer: { name: 'Funmi Adeyemi', email: 'funmi@example.com', phone: '+2348067778899' },
      },
    ],
  },
];

const money = (value: number) => value.toFixed(2);

function premiumFor(itemPrice: number): string {
  return money(Math.round(itemPrice * FAKE_BASIC_RATE * 100) / 100);
}

function addMoney(values: string[]): string {
  const kobo = values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0);
  return (kobo / 100).toFixed(2);
}

async function seedStoreIds(db: Db): Promise<number[]> {
  const rows = await db
    .select({ id: storesTable.id })
    .from(storesTable)
    .where(like(storesTable.billingEmail, `%@${SEED_EMAIL_DOMAIN}`));
  return rows.map((row) => row.id);
}

export interface SeedResult {
  stores: number;
  policies: number;
  skipped: boolean;
}

// Two active stores, each with a few active policies already billed on a bill from two
// weeks ago. Billing them keeps "Run weekly bill now" in the demo down to the one store
// signed up on stage. Two weeks rather than one, so the seeded bill's week never
// collides with the week that button bills.
export async function seedDemo(db: Db, now: Date = new Date()): Promise<SeedResult> {
  if ((await seedStoreIds(db)).length > 0) {
    return { stores: 0, policies: 0, skipped: true };
  }

  const periodEnd = previousWeekBoundary(weekBoundaryAtOrBefore(now));
  const periodStart = previousWeekBoundary(periodEnd);

  let policyCount = 0;

  await db.transaction(async (tx) => {
    for (const [storeIndex, seed] of SEED_STORES.entries()) {
      const slug = seed.domain.split('.')[0];
      const [store] = await tx
        .insert(storesTable)
        .values({
          name: seed.name,
          status: 'active',
          platform: 'custom',
          publicKey: generatePublicKey(),
          secretKeyHash: hashSecretKey(generateSecretKey()),
          webhookSecret: encryptSecret(generateWebhookSecret()),
          allowedDomains: [seed.domain],
          enabledCategories: seed.categories,
          commissionRate: seed.commissionRate,
          settlementFrequency: 'weekly',
          billingEmail: `${slug}@${SEED_EMAIL_DOMAIN}`,
          createdAt: new Date(periodStart.getTime() - 14 * DAY_MS),
        })
        .returning();

      const premiums: string[] = [];
      const commissions: string[] = [];
      const policyIds: number[] = [];

      for (const [index, item] of seed.policies.entries()) {
        // Spread across the billed week, a day apart, from midday Saturday.
        const soldAt = new Date(periodStart.getTime() + (index + 1) * DAY_MS + 12 * 60 * 60 * 1000);
        const premium = premiumFor(item.itemPrice);
        const commissionAmount = commissionFor(premium, seed.commissionRate);
        const ref = `${storeIndex + 1}${String(index + 1).padStart(3, '0')}`;

        const [customer] = await tx
          .insert(customersTable)
          .values({ ...item.customer, createdAt: soldAt })
          .returning({ id: customersTable.id });

        const [quote] = await tx
          .insert(quotesTable)
          .values({
            storeId: store.id,
            storeItemRef: `SKU-${ref}`,
            itemName: item.itemName,
            itemCategory: item.itemCategory,
            itemPrice: money(item.itemPrice),
            itemCondition: 'new',
            insureongoQuoteId: `seed-quote-${slug}-${ref}`,
            insurerName: 'Acme Insurance',
            planName: 'Acme Basic Cover',
            premium,
            status: 'accepted',
            expiresAt: new Date(soldAt.getTime() + 30 * DAY_MS),
            createdAt: soldAt,
          })
          .returning({ id: quotesTable.id });

        const [policy] = await tx
          .insert(policiesTable)
          .values({
            quoteId: quote.id,
            storeId: store.id,
            customerId: customer.id,
            issuanceKey: `seed-${slug}-${ref}`,
            orderRef: `ORD-${ref}`,
            policyNumber: `ACME-SEED-${ref}`,
            itemName: item.itemName,
            itemCategory: item.itemCategory,
            itemPrice: money(item.itemPrice),
            premium,
            commissionAmount,
            status: 'active',
            startsAt: soldAt,
            endsAt: new Date(soldAt.getTime() + 365 * DAY_MS),
            createdAt: soldAt,
          })
          .returning({ id: policiesTable.id });

        premiums.push(premium);
        commissions.push(commissionAmount);
        policyIds.push(policy.id);
      }

      const [settlement] = await tx
        .insert(settlementsTable)
        .values({
          storeId: store.id,
          periodStart: lagosDate(periodStart),
          periodEnd: lagosDate(periodEnd),
          policyCount: policyIds.length,
          premiumTotal: addMoney(premiums),
          commissionTotal: addMoney(commissions),
          status: 'invoiced',
          sentAt: periodEnd,
          createdAt: periodEnd,
        })
        .returning({ id: settlementsTable.id });

      await tx
        .update(policiesTable)
        .set({ settlementId: settlement.id })
        .where(inArray(policiesTable.id, policyIds));

      policyCount += policyIds.length;
    }
  });

  return { stores: SEED_STORES.length, policies: policyCount, skipped: false };
}

export interface RemoveResult {
  stores: number;
  policies: number;
}

// Deletes the seeded stores and any store named DEMO_STORE_NAME, with everything that
// points at them. Never truncates; every delete is limited to those stores' rows.
export async function removeDemoData(db: Db): Promise<RemoveResult> {
  return db.transaction(async (tx) => {
    const stores = await tx
      .select({ id: storesTable.id })
      .from(storesTable)
      .where(
        or(
          like(storesTable.billingEmail, `%@${SEED_EMAIL_DOMAIN}`),
          eq(storesTable.name, DEMO_STORE_NAME),
        ),
      );
    const storeIds = stores.map((store) => store.id);
    if (storeIds.length === 0) {
      return { stores: 0, policies: 0 };
    }

    // Policies point at quotes, customers and settlements, so they go first.
    const policies = await tx
      .delete(policiesTable)
      .where(inArray(policiesTable.storeId, storeIds))
      .returning({ customerId: policiesTable.customerId });

    const customerIds = [...new Set(policies.map((policy) => policy.customerId))];
    if (customerIds.length > 0) {
      // Customers have no store of their own. Remove the ones these policies used,
      // unless a policy of some other store still points at them.
      await tx.delete(customersTable).where(
        and(
          inArray(customersTable.id, customerIds),
          notExists(
            tx
              .select({ id: policiesTable.id })
              .from(policiesTable)
              .where(eq(policiesTable.customerId, customersTable.id)),
          ),
        ),
      );
    }

    await tx.delete(settlementsTable).where(inArray(settlementsTable.storeId, storeIds));
    await tx.delete(quotesTable).where(inArray(quotesTable.storeId, storeIds));
    await tx.delete(webhookEventsTable).where(inArray(webhookEventsTable.storeId, storeIds));
    // Dashboard sessions go with the store (ON DELETE CASCADE).
    await tx.delete(storesTable).where(inArray(storesTable.id, storeIds));

    return { stores: storeIds.length, policies: policies.length };
  });
}
