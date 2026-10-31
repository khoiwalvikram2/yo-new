ALTER TABLE "crm_consent_events" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "crm_consent_events" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_consent_events_seq_idx" ON "crm_consent_events" USING btree ("tenant","player_id","channel","purpose","seq" DESC NULLS LAST);