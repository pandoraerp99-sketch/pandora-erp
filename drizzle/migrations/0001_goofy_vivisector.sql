CREATE TABLE "processed_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid,
	"signature_validated" boolean DEFAULT false NOT NULL,
	"header_timestamp" timestamp with time zone,
	"payload_hash" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_webhook_events_provider_check" CHECK ("processed_webhook_events"."provider" IN ('mercadopago','afip'))
);
--> statement-breakpoint
ALTER TABLE "processed_webhook_events" ADD CONSTRAINT "processed_webhook_events_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "processed_webhook_events_provider_event_unique" ON "processed_webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "processed_webhook_events_tenant_processed_idx" ON "processed_webhook_events" USING btree ("tenant_id","processed_at");--> statement-breakpoint
CREATE INDEX "processed_webhook_events_sale_idx" ON "processed_webhook_events" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "processed_webhook_events_correlation_idx" ON "processed_webhook_events" USING btree ("correlation_id");