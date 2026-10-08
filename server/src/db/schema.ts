import {
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";


export const insurersTable = pgTable("insurers", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  status: varchar({ length: 20 }).notNull().default("active"),
  contactEmail: varchar({ length: 255 }).notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});

export const insurancePlansTable = pgTable("insurance_plans", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  insurerId: integer()
    .notNull()
    .references(() => insurersTable.id),
  name: varchar({ length: 255 }).notNull(),
  status: varchar({ length: 20 }).notNull().default("active"),

  // Eligibility rules
  categories: text().array().notNull().default(sql`'{}'::text[]`),
  minItemPrice: numeric({ precision: 12, scale: 2 }).notNull(),
  maxItemPrice: numeric({ precision: 12, scale: 2 }).notNull(),
  maxItemAgeMonths: integer().notNull(),

  // Premium = item price x rate
  premiumRate: numeric({ precision: 5, scale: 4 }).notNull(),

  createdAt: timestamp().notNull().defaultNow(),
});

export const storesTable = pgTable("stores", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  status: varchar({ length: 255 }).notNull().default("pending"),

  platform: varchar({ length: 50 }).notNull(),
  publicKey: varchar({ length: 255 }).notNull().unique(),
  secretKeyHash: varchar({ length: 255 }).notNull(),
  webhookSecret: text().notNull(), // encrypt this column; it must be readable to verify signatures
  allowedDomains: text().array().notNull().default(sql`'{}'::text[]`),

  commissionRate: numeric({ precision: 5, scale: 4 }).notNull(),
  settlementFrequency: varchar({ length: 20 }).notNull().default("daily"),
  billingEmail: varchar({ length: 255 }).notNull(),

  enabledCategories: text().array().notNull().default(sql`'{}'::text[]`),

  createdAt: timestamp().notNull().defaultNow(),
});


export const customersTable = pgTable("customers", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull(),
  phone: varchar({ length: 30 }),
  createdAt: timestamp().notNull().defaultNow(),
});

// What we offered for one item. Honored for 30 days
export const quotesTable = pgTable("quotes", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer()
    .notNull()
    .references(() => storesTable.id),
  planId: integer()
    .notNull()
    .references(() => insurancePlansTable.id),

  // Snapshot of the item at quote time
  storeItemRef: varchar({ length: 255 }), // the store's own id for the product
  itemName: varchar({ length: 255 }).notNull(),
  itemCategory: varchar({ length: 100 }).notNull(),
  itemPrice: numeric({ precision: 12, scale: 2 }).notNull(),
  itemAgeMonths: integer().notNull().default(0),

  premium: numeric({ precision: 12, scale: 2 }).notNull(),
  status: varchar({ length: 20 }).notNull().default("offered"), // offered, accepted, expired
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});

// Every event the store's platform sends us. The unique pair makes repeats harmless.
export const webhookEventsTable = pgTable(
  "webhook_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    storeId: integer()
      .notNull()
      .references(() => storesTable.id),
    eventId: varchar({ length: 255 }).notNull(), // the platform's id for the event
    type: varchar({ length: 100 }).notNull(),
    payload: jsonb().notNull(),
    status: varchar({ length: 20 }).notNull().default("received"), // received, processed, failed
    receivedAt: timestamp().notNull().defaultNow(),
    processedAt: timestamp(),
  },
  (t) => [uniqueIndex("webhook_events_store_event_uq").on(t.storeId, t.eventId)],
);

// One row per store per day. Totals are worked out from policies when the daily job runs,
// then frozen here so the invoice never changes afterwards.
export const settlementsTable = pgTable(
  "settlements",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    storeId: integer()
      .notNull()
      .references(() => storesTable.id),
    settlementDate: date().notNull(),
    policyCount: integer().notNull(),
    premiumTotal: numeric({ precision: 14, scale: 2 }).notNull(),
    commissionTotal: numeric({ precision: 14, scale: 2 }).notNull(),
    status: varchar({ length: 20 }).notNull().default("pending"), // pending, invoiced, paid
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("settlements_store_date_uq").on(t.storeId, t.settlementDate)],
);

// Issued cover. Active only once the premium is paid.
export const policiesTable = pgTable("policies", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),

  // One quote can only ever become one policy
  quoteId: integer()
    .notNull()
    .unique()
    .references(() => quotesTable.id),
  storeId: integer()
    .notNull()
    .references(() => storesTable.id),
  planId: integer()
    .notNull()
    .references(() => insurancePlansTable.id),
  customerId: integer()
    .notNull()
    .references(() => customersTable.id),
  settlementId: integer().references(() => settlementsTable.id), // set once billed, stops double billing

  // Stops the same purchase being issued twice
  issuanceKey: varchar({ length: 255 }).notNull().unique(),
  orderRef: varchar({ length: 255 }).notNull(), // the store's order id
  policyNumber: varchar({ length: 100 }), // from the insurer, once issued

  // Snapshot of the item and money at issue time
  itemName: varchar({ length: 255 }).notNull(),
  itemCategory: varchar({ length: 100 }).notNull(),
  itemPrice: numeric({ precision: 12, scale: 2 }).notNull(),
  serialNumber: varchar({ length: 100 }),
  premium: numeric({ precision: 12, scale: 2 }).notNull(),
  commissionAmount: numeric({ precision: 12, scale: 2 }).notNull(),

  status: varchar({ length: 20 }).notNull().default("pending"), // pending, active, cancelled, expired
  startsAt: timestamp(),
  endsAt: timestamp(),
  createdAt: timestamp().notNull().defaultNow(),
});