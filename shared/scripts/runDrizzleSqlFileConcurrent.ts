/**
 * Run a .sql file from shared/drizzle OUTSIDE a transaction, one statement at a time.
 *
 * runDrizzleSqlFile.ts wraps the whole file in BEGIN/COMMIT, which is right for ordinary
 * DDL — either the migration lands or it does not. But it makes
 * `CREATE INDEX CONCURRENTLY` impossible: Postgres rejects it inside a transaction
 * block. Until this existed, there was no way to add an index to a large table without
 * taking an ACCESS EXCLUSIVE lock on it, which on the bet and ledger tables means
 * blocking live betting for the duration of the build.
 *
 * The trade is explicit: there is no rollback. A file run this way must be written so
 * that a statement failing halfway leaves the database usable — in practice, use
 * `IF NOT EXISTS` and keep each statement independent. A failed CONCURRENTLY build
 * leaves an INVALID index behind, which this reports so it can be dropped and retried.
 *
 * Usage (from shared/):
 *   npx tsx scripts/runDrizzleSqlFileConcurrent.ts drizzle/data_0002_crm_source_indexes.sql
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Pool } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Split on drizzle's statement marker when present, otherwise on semicolons at the end
 * of a line. Comment-only fragments are dropped so an empty statement is never sent.
 */
function splitStatements(sql: string): string[] {
  const parts = sql.includes('--> statement-breakpoint')
    ? sql.split('--> statement-breakpoint')
    : sql.split(/;\s*$/m)

  return parts
    .map(s => s.trim().replace(/;$/, '').trim())
    .filter(s => s.length > 0)
    .filter(s => !s.split('\n').every(line => line.trim() === '' || line.trim().startsWith('--')))
}

async function main() {
  const rel = process.argv[2]
  if (!rel) {
    console.error('Usage: npx tsx scripts/runDrizzleSqlFileConcurrent.ts <path-under-shared>')
    process.exit(1)
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const statements = splitStatements(readFileSync(join(__dirname, '..', rel), 'utf-8'))
  console.log(`${rel}: ${statements.length} statement(s), no transaction`)

  const pool = new Pool({ connectionString })
  const client = await pool.connect()

  let failed = 0
  try {
    for (const [i, statement] of statements.entries()) {
      const label = statement.replace(/\s+/g, ' ').slice(0, 90)
      const started = Date.now()
      try {
        await client.query(statement)
        console.log(`  [${i + 1}/${statements.length}] ok (${Date.now() - started}ms)  ${label}`)
      } catch (e: any) {
        failed++
        // Keep going: each statement is independent by contract, and stopping at the
        // first failure would leave the rest of a batch of indexes unbuilt for no reason.
        console.error(`  [${i + 1}/${statements.length}] FAILED  ${label}\n      ${e?.message ?? e}`)
      }
    }

    const { rows } = await client.query(`
      SELECT c.relname AS index_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE NOT i.indisvalid
    `)
    if (rows.length) {
      console.error(
        `\n${rows.length} INVALID index(es) left behind by a failed concurrent build — ` +
        `drop and retry:\n` + rows.map((r: any) => `  DROP INDEX CONCURRENTLY ${r.index_name};`).join('\n')
      )
    }
  } finally {
    client.release()
    await pool.end()
  }

  if (failed > 0) process.exit(1)
  console.log('OK:', rel)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
