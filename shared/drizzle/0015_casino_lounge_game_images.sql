-- The custom artwork belongs to the tenant's category membership, preserving
-- the provider's original game thumbnail and other homepage collections.
ALTER TABLE "casino_category_games" ADD COLUMN IF NOT EXISTS "image_data" text;
