ALTER TABLE "billing_customer" ADD COLUMN "deleting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_customer" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "billing_customer" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
-- A pending deletion now lapses on its own; existing flags start their window now.
UPDATE "billing_customer" SET "deleting_at" = now() WHERE "deleting";--> statement-breakpoint
ALTER TABLE "billing_customer" DROP COLUMN "deleting";
