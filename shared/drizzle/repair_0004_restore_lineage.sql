-- Restores the migration lineage after this database was reset behind an active
-- session, which left drizzle."__drizzle_migrations" empty while the objects
-- themselves were rebuilt by the repair files beside this one.
--
-- Without these rows the next 'migrate:run' would try to apply 0000_baseline
-- against 132 tables that already exist and fail confusingly. The hashes are
-- sha256 of each migration file, which is what drizzle itself records — verified
-- against the row it wrote for 0000 before the reset.
--
-- Guarded by NOT EXISTS, so running this twice inserts nothing the second time.

-- 0000_baseline
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
SELECT '0621164d3e06c7af6c43d1aeb2c6d9e1ea2faf6305ff8bc18c3c5349de253a15', 1787751895846
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '0621164d3e06c7af6c43d1aeb2c6d9e1ea2faf6305ff8bc18c3c5349de253a15');
--> statement-breakpoint
-- 0001_crm_foundation
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
SELECT '8e923d3aba1bed0fbd0c62ec1e251293a2f07b46ff269fe746d404d3ac3139b5', 1787754110014
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '8e923d3aba1bed0fbd0c62ec1e251293a2f07b46ff269fe746d404d3ac3139b5');
--> statement-breakpoint
-- 0002_crm_timeline_indexes
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
SELECT '6cf9ecf4ad5a7a805948c8f745a734824fabeeaa24845f44758e9ae1f7d57bc8', 1787754882943
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '6cf9ecf4ad5a7a805948c8f745a734824fabeeaa24845f44758e9ae1f7d57bc8');
