-- ALREADY APPLIED TO PROD (manually, 2026-07-05) via
-- scripts/migrations/applied/2026-07-05-vendor-tables.sql.
-- Kept for drizzle journal coherence; do NOT re-apply.
CREATE INDEX "vendor_api_keys_vendor_idx" ON "vendor_api_keys" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vendor_members_vendor_idx" ON "vendor_members" USING btree ("vendor_id");
