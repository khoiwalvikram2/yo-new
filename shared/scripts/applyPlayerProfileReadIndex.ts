/**
 * Online application of 0009's single index, outside a migration transaction.
 * From admin-backend (to use its configured local DB):
 * node --env-file-if-exists=.env --import tsx ../shared/scripts/applyPlayerProfileReadIndex.ts
 * Default target is loopback only; an operator must explicitly pass --allow-remote elsewhere.
 */
import 'dotenv/config'
import pg from 'pg'
import { getSSLConfig } from '../src/db/ssl.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const hostname = new URL(url).hostname
const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
if (!local && !process.argv.includes('--allow-remote')) throw new Error('Refusing a non-loopback database without explicit --allow-remote')
const client = new pg.Client({ connectionString: url, ssl: getSSLConfig(url), application_name: 'player-profile-read-index' })
try {
  await client.connect()
  await client.query("SET lock_timeout = '3s'")
  await client.query("SET statement_timeout = '120s'")
  // No transaction: CONCURRENTLY keeps normal ledger reads and writes available.
  await client.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS ledger_entries_tenant_wallet_created_idx ON ledger_entries (tenant, wallet_id, created_at)')
  const result = await client.query("SELECT i.indisvalid, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i WHERE i.indexrelid=to_regclass('public.ledger_entries_tenant_wallet_created_idx')")
  if (!result.rows[0]?.indisvalid) throw new Error('Index is missing or invalid; inspect before retrying')
  console.log(JSON.stringify({ local, valid: true, index: result.rows[0].definition }))
} finally { await client.end() }
