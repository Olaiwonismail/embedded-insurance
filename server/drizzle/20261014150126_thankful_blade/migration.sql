CREATE TABLE "customers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(30),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "merchant_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"storeId" integer NOT NULL,
	"tokenHash" varchar(64) NOT NULL UNIQUE,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "policies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"quoteId" integer NOT NULL UNIQUE,
	"storeId" integer NOT NULL,
	"customerId" integer NOT NULL,
	"settlementId" integer,
	"issuanceKey" varchar(255) NOT NULL UNIQUE,
	"orderRef" varchar(255) NOT NULL,
	"policyNumber" varchar(100),
	"itemName" varchar(255) NOT NULL,
	"itemCategory" varchar(100) NOT NULL,
	"itemPrice" numeric(12,2) NOT NULL,
	"serialNumber" varchar(100),
	"premium" numeric(12,2) NOT NULL,
	"commissionAmount" numeric(12,2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"startsAt" timestamp,
	"endsAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quotes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"storeId" integer NOT NULL,
	"storeItemRef" varchar(255),
	"itemName" varchar(255) NOT NULL,
	"itemCategory" varchar(100) NOT NULL,
	"itemPrice" numeric(12,2) NOT NULL,
	"itemCondition" varchar(10) NOT NULL,
	"insureongoQuoteId" varchar(255) NOT NULL,
	"insurerName" varchar(255) NOT NULL,
	"planName" varchar(255) NOT NULL,
	"premium" numeric(12,2) NOT NULL,
	"status" varchar(20) DEFAULT 'offered' NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "settlements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"storeId" integer NOT NULL,
	"settlementDate" date NOT NULL,
	"policyCount" integer NOT NULL,
	"premiumTotal" numeric(14,2) NOT NULL,
	"commissionTotal" numeric(14,2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"platform" varchar(50) NOT NULL,
	"publicKey" varchar(255) NOT NULL UNIQUE,
	"secretKeyHash" varchar(255) NOT NULL,
	"webhookSecret" text NOT NULL,
	"allowedDomains" text[] DEFAULT '{}'::text[] NOT NULL,
	"commissionRate" numeric(5,4) NOT NULL,
	"settlementFrequency" varchar(20) DEFAULT 'daily' NOT NULL,
	"billingEmail" varchar(255) NOT NULL,
	"enabledCategories" text[] DEFAULT '{}'::text[] NOT NULL,
	"passwordHash" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"storeId" integer NOT NULL,
	"eventId" varchar(255) NOT NULL,
	"type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"receivedAt" timestamp DEFAULT now() NOT NULL,
	"processedAt" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_store_date_uq" ON "settlements" ("storeId","settlementDate");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_login_email_uq" ON "stores" (lower("billingEmail")) WHERE "passwordHash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_store_event_uq" ON "webhook_events" ("storeId","eventId");--> statement-breakpoint
ALTER TABLE "merchant_sessions" ADD CONSTRAINT "merchant_sessions_storeId_stores_id_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_quoteId_quotes_id_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id");--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_storeId_stores_id_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id");--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_customerId_customers_id_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_settlementId_settlements_id_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_storeId_stores_id_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id");--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_storeId_stores_id_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id");--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_storeId_stores_id_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id");