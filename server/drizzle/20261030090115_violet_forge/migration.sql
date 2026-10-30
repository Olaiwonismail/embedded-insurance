DROP INDEX "settlements_store_date_uq";--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "periodStart" date NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "periodEnd" date NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "sentAt" timestamp;--> statement-breakpoint
ALTER TABLE "settlements" DROP COLUMN "settlementDate";--> statement-breakpoint
ALTER TABLE "stores" ALTER COLUMN "settlementFrequency" SET DEFAULT 'weekly';--> statement-breakpoint
UPDATE "stores" SET "settlementFrequency" = 'weekly' WHERE "settlementFrequency" = 'daily';--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_store_period_uq" ON "settlements" ("storeId","periodStart");