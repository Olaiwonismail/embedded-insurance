import { integer, pgTable, varchar, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const storesTable = pgTable("stores", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  status: varchar({ length: 255 }).notNull(),

  platform: varchar({ length: 50 }).notNull(),
  publicKey: varchar({ length: 255 }).notNull().unique(),
  secretKeyHash: varchar({ length: 255 }).notNull(),
  webhookSecret: text().notNull(),
  allowedDomains: text().array().notNull().default(sql`'{}'::text[]`),

  commissionRate: numeric({ precision: 5, scale: 4 }).notNull(),
  settlementFrequency: varchar({ length: 20 }).notNull().default("daily"),
  billingEmail: varchar({ length: 255 }).notNull(),

  insurerId: integer().notNull(),
  enabledCategories: text().array().notNull().default(sql`'{}'::text[]`),

  createdAt: timestamp().notNull().defaultNow(),
});