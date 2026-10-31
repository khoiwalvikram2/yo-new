/**
 * Verifies migration 0086: the partial unique index `agent_ledger_commission_unique`
 * enforces one COMMISSION line per (agent, domain, period) but does NOT constrain other
 * line types. Seeds a temp agent in a transaction that is always ROLLED BACK.
 *
 * Run: node --import tsx --test --env-file=.env src/db/schema/__tests__/agentLedgerCommissionUnique.test.ts
 */
import 'dotenv/config'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from 'pg'

const TENANT = '__test_ale_tenant__'
const FROM = '2099-01-04 00:00:00+00' // a Monday far in the future, won't collide
const TO = '2099-01-11 00:00:00+00'

async function withRollback(fn: (c: Client) => Promise<void>) {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query('BEGIN')
    await fn(c)
  } finally {
    await c.query('ROLLBACK')
    await c.end()
  }
}

async function seedAgent(c: Client): Promise<string> {
  const r = await c.query(
    `INSERT INTO agents (tenant_id, scheme_type, allowed_domains, status)
     VALUES ($1, 'COMMISSION', ARRAY['sports','casino','matka'], 'ACTIVE') RETURNING id`,
    [TENANT]
  )
  return r.rows[0].id
}

async function insertLine(c: Client, agentId: string, domain: string, lineType: string) {
  await c.query(
    `INSERT INTO agent_ledger (agent_id, domain, period_from, period_to, line_type, amount, currency)
     VALUES ($1, $2, $3, $4, $5, '100', 'INR')`,
    [agentId, domain, FROM, TO, lineType]
  )
}

test('index agent_ledger_commission_unique exists and is partial on COMMISSION', async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const r = await c.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'agent_ledger_commission_unique'"
    )
    assert.equal(r.rowCount, 1, 'index must exist')
    assert.match(r.rows[0].indexdef, /line_type = 'COMMISSION'/, 'must be partial on COMMISSION')
  } finally {
    await c.end()
  }
})

test('second COMMISSION line for same (agent,domain,period) is rejected (23505)', async () => {
  await withRollback(async (c) => {
    const agentId = await seedAgent(c)
    await insertLine(c, agentId, 'sports', 'COMMISSION')
    await assert.rejects(
      () => insertLine(c, agentId, 'sports', 'COMMISSION'),
      (err: any) => err.code === '23505',
      'duplicate COMMISSION line must violate the unique index'
    )
  })
})

test('SHARE line with the same (agent,domain,period) is allowed (partial scope)', async () => {
  await withRollback(async (c) => {
    const agentId = await seedAgent(c)
    await insertLine(c, agentId, 'sports', 'COMMISSION')
    // A SHARE line sharing the exact key must NOT be blocked by the COMMISSION-only index.
    await insertLine(c, agentId, 'sports', 'SHARE')
    await insertLine(c, agentId, 'sports', 'SETTLEMENT')
    const r = await c.query(
      `SELECT line_type FROM agent_ledger WHERE agent_id = $1`,
      [agentId]
    )
    // line_type is an enum (orders by declaration, not alphabetical) — sort in JS.
    assert.deepEqual(r.rows.map((x) => x.line_type).sort(), ['COMMISSION', 'SETTLEMENT', 'SHARE'])
  })
})

test('different domain COMMISSION line for same period is allowed', async () => {
  await withRollback(async (c) => {
    const agentId = await seedAgent(c)
    await insertLine(c, agentId, 'sports', 'COMMISSION')
    await insertLine(c, agentId, 'casino', 'COMMISSION') // different domain → ok
    const r = await c.query(`SELECT count(*)::int AS n FROM agent_ledger WHERE agent_id = $1`, [agentId])
    assert.equal(r.rows[0].n, 2)
  })
})
