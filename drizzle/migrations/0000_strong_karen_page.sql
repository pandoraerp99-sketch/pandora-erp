CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"cuit" text NOT NULL,
	"tax_regime" text NOT NULL,
	"merchant_jurisdiction_province" text NOT NULL,
	"merchant_special_regime" text,
	"afip_environment" text DEFAULT 'homologacion' NOT NULL,
	"afip_sale_point" text DEFAULT '0001' NOT NULL,
	"demo_status" text DEFAULT 'trial' NOT NULL,
	"demo_trial_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_cuit_unique" UNIQUE("cuit"),
	CONSTRAINT "companies_tax_regime_check" CHECK ("companies"."tax_regime" IN ('responsable_inscripto','monotributo','iva_liberado')),
	CONSTRAINT "companies_jurisdiction_check" CHECK ("companies"."merchant_jurisdiction_province" IN ('TIERRA_DEL_FUEGO')),
	CONSTRAINT "companies_special_regime_check" CHECK ("companies"."merchant_special_regime" IS NULL OR "companies"."merchant_special_regime" IN ('LEY_19640')),
	CONSTRAINT "companies_afip_environment_check" CHECK ("companies"."afip_environment" IN ('homologacion','produccion')),
	CONSTRAINT "companies_demo_status_check" CHECK ("companies"."demo_status" IN ('trial','active','read_only','archived')),
	CONSTRAINT "companies_cuit_format_check" CHECK ("companies"."cuit" ~ '^[0-9]{11}$')
);
--> statement-breakpoint
CREATE TABLE "company_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_users_unique_membership" UNIQUE("company_id","user_id"),
	CONSTRAINT "company_users_role_check" CHECK ("company_users"."role" IN ('owner','admin','cashier','accountant'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"is_support" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"barcode" text,
	"unit_type" text DEFAULT 'unidad' NOT NULL,
	"price" numeric(19, 4) NOT NULL,
	"cost" numeric(19, 4),
	"tax_rate" numeric(5, 2) DEFAULT '21.00' NOT NULL,
	"tdf_exempt" boolean DEFAULT false NOT NULL,
	"stock_current" numeric(19, 4) DEFAULT '0' NOT NULL,
	"stock_minimum" numeric(19, 4),
	"stock_tracking_enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_unit_type_check" CHECK ("products"."unit_type" IN ('unidad','metro','kg','gramo','litro','docena')),
	CONSTRAINT "products_price_non_negative" CHECK ("products"."price" >= 0),
	CONSTRAINT "products_tax_rate_range" CHECK ("products"."tax_rate" >= 0 AND "products"."tax_rate" <= 100)
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"product_sku_snapshot" text,
	"product_unit_type_snapshot" text DEFAULT 'unidad' NOT NULL,
	"unit_price" numeric(19, 4) NOT NULL,
	"quantity" numeric(19, 4) NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"tdf_exempt" boolean DEFAULT false NOT NULL,
	"line_subtotal" numeric(19, 4) NOT NULL,
	"line_tax" numeric(19, 4) NOT NULL,
	"line_total" numeric(19, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_items_quantity_positive" CHECK ("sale_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"cashier_user_id" uuid NOT NULL,
	"commercial_status" text DEFAULT 'draft' NOT NULL,
	"fiscal_status" text DEFAULT 'not_required' NOT NULL,
	"subtotal" numeric(19, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"exempt_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"payment_method" text,
	"payment_breakdown" text,
	"customer_doc_type" text DEFAULT 'none',
	"customer_doc_number" text,
	"customer_name_snapshot" text,
	"customer_tax_condition_snapshot" text,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "sales_commercial_status_check" CHECK ("sales"."commercial_status" IN ('draft','in_progress','cobrando','cobrada','terminada','cancelada')),
	CONSTRAINT "sales_fiscal_status_check" CHECK ("sales"."fiscal_status" IN ('not_required','pending','requesting','issued','reconciled_issued','requires_reconciliation','failed','number_burned','contingency','manual_resolution_required')),
	CONSTRAINT "sales_payment_method_check" CHECK ("sales"."payment_method" IS NULL OR "sales"."payment_method" IN ('efectivo','tarjeta','mp_qr','mixto')),
	CONSTRAINT "sales_customer_doc_type_check" CHECK ("sales"."customer_doc_type" IN ('DNI','CUIT','CUIL','none'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial NOT NULL,
	"event_name" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"pii_level" text DEFAULT 'internal' NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "audit_log_actor_type_check" CHECK ("audit_log"."actor_type" IN ('user','system','support','cron','worker')),
	CONSTRAINT "audit_log_pii_level_check" CHECK ("audit_log"."pii_level" IN ('public','internal','pii_low','pii_high','secret')),
	CONSTRAINT "audit_log_severity_check" CHECK ("audit_log"."severity" IN ('info','notice','warning','error','critical'))
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_point" integer NOT NULL,
	"invoice_type" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_sequences_unique" UNIQUE("tenant_id","sale_point","invoice_type"),
	CONSTRAINT "invoice_sequences_invoice_type_check" CHECK ("invoice_sequences"."invoice_type" IN ('A','B','C','E','M')),
	CONSTRAINT "invoice_sequences_sale_point_positive" CHECK ("invoice_sequences"."sale_point" > 0),
	CONSTRAINT "invoice_sequences_next_number_positive" CHECK ("invoice_sequences"."next_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fiscal_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"calculation_engine_version" text NOT NULL,
	"tax_policy_version" text NOT NULL,
	"rounding_mode" text NOT NULL,
	"rounding_stage" text NOT NULL,
	"iva_rates_applied" jsonb NOT NULL,
	"currency_code" text DEFAULT 'ARS' NOT NULL,
	"jurisdiction_context" jsonb NOT NULL,
	"fiscal_breakdown" jsonb NOT NULL,
	"wsfe_version" text DEFAULT 'WSFEv1' NOT NULL,
	"wsfe_request_payload" jsonb,
	"wsfe_response_raw" jsonb,
	"sale_point" integer,
	"invoice_type" text,
	"invoice_number" integer,
	"cae" text,
	"cae_expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_snapshots_sale_unique" UNIQUE("sale_id"),
	CONSTRAINT "fiscal_snapshots_invoice_type_check" CHECK ("fiscal_snapshots"."invoice_type" IS NULL OR "fiscal_snapshots"."invoice_type" IN ('A','B','C','E','M')),
	CONSTRAINT "fiscal_snapshots_rounding_mode_check" CHECK ("fiscal_snapshots"."rounding_mode" = 'HALF_EVEN')
);
--> statement-breakpoint
CREATE TABLE "jobs_queue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"last_request_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 24 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_queue_job_type_check" CHECK ("jobs_queue"."job_type" IN ('afip.emit_invoice','afip.reconcile_pending','afip.refresh_wsaa_token','afip.refresh_padron','email.send_invoice','email.send_breach_notification','mp.reconcile_webhook','cron.archive_expired_demos','cron.partition_audit_log','cron.cleanup_old_jobs')),
	CONSTRAINT "jobs_queue_status_check" CHECK ("jobs_queue"."status" IN ('pending','running','done','failed','dead')),
	CONSTRAINT "jobs_queue_attempts_check" CHECK ("jobs_queue"."attempts" >= 0 AND "jobs_queue"."attempts" <= "jobs_queue"."max_attempts"),
	CONSTRAINT "jobs_queue_max_attempts_check" CHECK ("jobs_queue"."max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_user_id_users_id_fk" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_snapshots" ADD CONSTRAINT "fiscal_snapshots_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_snapshots" ADD CONSTRAINT "fiscal_snapshots_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_sku_unique_partial" ON "products" USING btree ("tenant_id","sku") WHERE "products"."sku" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_barcode_unique_partial" ON "products" USING btree ("tenant_id","barcode") WHERE "products"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "products_tenant_idx" ON "products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "products_barcode_idx" ON "products" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "sales_tenant_idx" ON "sales" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_correlation_idx" ON "sales" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "sales_cashier_idx" ON "sales" USING btree ("tenant_id","cashier_user_id");--> statement-breakpoint
CREATE INDEX "sales_fiscal_status_idx" ON "sales" USING btree ("tenant_id","fiscal_status");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_time_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_correlation_idx" ON "audit_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "audit_log_event_name_idx" ON "audit_log" USING btree ("tenant_id","event_name","created_at");--> statement-breakpoint
CREATE INDEX "fiscal_snapshots_tenant_idx" ON "fiscal_snapshots" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "fiscal_snapshots_cae_idx" ON "fiscal_snapshots" USING btree ("tenant_id","cae");--> statement-breakpoint
CREATE INDEX "fiscal_snapshots_invoice_number_idx" ON "fiscal_snapshots" USING btree ("tenant_id","sale_point","invoice_type","invoice_number");--> statement-breakpoint
CREATE INDEX "jobs_queue_status_next_attempt_idx" ON "jobs_queue" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "jobs_queue_tenant_status_idx" ON "jobs_queue" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "jobs_queue_correlation_idx" ON "jobs_queue" USING btree ("correlation_id");