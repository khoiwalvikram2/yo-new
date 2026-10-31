#!/bin/bash
# Script to apply the Director Admin preferences migration
# Usage: ./apply_migration.sh

echo "Applying migration: 0035_add_director_admin_preferences.sql"
echo ""

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL environment variable is not set"
  exit 1
fi

psql "$DATABASE_URL" -f drizzle/0035_add_director_admin_preferences.sql

if [ $? -eq 0 ]; then
  echo ""
  echo "✓ Migration applied successfully!"
else
  echo ""
  echo "✗ Migration failed. Please check the error above."
  exit 1
fi
