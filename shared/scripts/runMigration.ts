/**
 * Applies every migration in ./drizzle that the database has not yet recorded,
 * in journal order, inside drizzle's own migration table.
 *
 * This used to be a hardcoded list of filenames. When the migrations were
 * collapsed into 0000_baseline those files stopped existing and the script
 * failed on its first read — so it named files, rather than asking the journal
 * what is pending. It now asks.
 */
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { provisionCasinoLounge } from './provisionCasinoLounge.js'

const { Pool } = pg
const here = dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  const pool = new Pool({ connectionString, max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: join(here, '..', 'drizzle') })
    // PostgreSQL requires the enum ADD VALUE transaction to commit before use.
    const loungeCategories = await provisionCasinoLounge(pool)
    console.log(`Casino lounge: ${loungeCategories} empty categories provisioned`)
    console.log('✅ Migrations up to date')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
