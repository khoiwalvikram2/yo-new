/**
 * Run a .sql file from shared/drizzle against DATABASE_URL (no psql required).
 *
 * Usage (from shared/):
 *   npx tsx scripts/runDrizzleSqlFile.ts drizzle/0075_bonus_awards_distribution_snapshot.sql
 *
 * Requires DATABASE_URL in .env or environment.
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Pool } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main() {
  const rel = process.argv[2]
  if (!rel) {
    console.error('Usage: npx tsx scripts/runDrizzleSqlFile.ts <path-under-shared>')
    console.error('Example: npx tsx scripts/runDrizzleSqlFile.ts drizzle/0075_bonus_awards_distribution_snapshot.sql')
    process.exit(1)
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const filePath = join(__dirname, '..', rel)
  const sql = readFileSync(filePath, 'utf-8')

  const pool = new Pool({ connectionString })
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('OK:', rel)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
