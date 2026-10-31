/**
 * Run reporting_daily_snapshots dedupe + unique index migration (no psql required).
 * Usage: from shared folder, npm run migrate:reporting-snapshots-dedup
 * Requires: DATABASE_URL in env or .env (loads shared/.env and ../admin-backend/.env if present)
 */
import { config } from 'dotenv'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
config() // shared/.env
if (existsSync(join(__dirname, '..', '..', 'admin-backend', '.env'))) {
  config({ path: join(__dirname, '..', '..', 'admin-backend', '.env') })
}

const { Pool } = pg

async function run() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Set it in .env or environment.')
    process.exit(1)
  }

  const pool = new Pool({ connectionString })
  const client = await pool.connect()

  try {
    const filePath = join(__dirname, '..', 'drizzle', '0066_reporting_snapshots_unique_nulls_not_distinct.sql')
    const sql = readFileSync(filePath, 'utf-8')
    // Remove comment lines, then run each statement (split by semicolon + newline)
    const cleaned = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    const statements = cleaned
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)

    console.log('Running reporting snapshots dedupe + unique index (0066)...')
    for (const statement of statements) {
      await client.query(statement)
    }
    console.log('Done. Duplicates removed and unique index created.')
  } catch (err: any) {
    console.error('Failed:', err.message)
    if (err.message?.includes('NULLS NOT DISTINCT')) {
      console.error('PostgreSQL 15+ is required. Check: SELECT version();')
    }
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
