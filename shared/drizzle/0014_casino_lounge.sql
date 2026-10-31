-- Commit the new enum label before inserting categories using it. Default empty
-- categories are provisioned after migrate() commits in scripts/runMigration.ts.
ALTER TYPE "public"."casino_category_type" ADD VALUE IF NOT EXISTS 'lounge';
