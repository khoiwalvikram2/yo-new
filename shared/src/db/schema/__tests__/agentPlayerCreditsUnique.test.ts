/**
 * Verifies migration 0087: the unique index `agent_player_credits_agent_player_key`
 * enforces at most one agent_player_credits (apc) row per (agent_id, player_id).
 * Seeds a temp agent + player inside a transaction that is always ROLLED BACK, so the
 * local DB is never mutated.
 *
 * Run: node --import tsx --test --env-file=.env src/db/schema/__tests__/agentPlayerCreditsUnique.test.ts
 */
import 'dotenv/config'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from 'pg'

const TENANT = '__test_apc_tenant__'

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
     VALUES ($1, 'CREDIT', ARRAY['sports','casino','matka'], 'ACTIVE') RETURNING id`,
    [TENANT]
  )
  return r.rows[0].id
}

async function seedPlayer(c: Client, agentId: string): Promise<number> {
  const r = await c.query(
    `INSERT INTO users (tenant, name, phone, username, password_hash, player_type, agent_id)
     VALUES ($1, '__test_apc_player__', '__test_apc_phone__', $2, 'x', 'AGENT_CREDIT', $3)
     RETURNING id`,
    [TENANT, '__test_apc_user_' + Math.random().toString(36).slice(2), agentId]
  )
  return r.rows[0].id
}

async function insertApc(c: Client, agentId: string, playerId: number) {
  await c.query(
    `INSERT INTO agent_player_credits (agent_id, player_id, credit_limit, current_balance, open_exposure, credit_used, credit_available)
     VALUES ($1, $2, '0', '0', '0', '0', '0')`,
    [agentId, playerId]
  )
}

test('index agent_player_credits_agent_player_key exists and is UNIQUE', async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const r = await c.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'agent_player_credits_agent_player_key'"
    )
    assert.equal(r.rowCount, 1, 'index must exist')
    assert.match(r.rows[0].indexdef, /UNIQUE INDEX/, 'must be a UNIQUE index')
    assert.match(r.rows[0].indexdef, /\(agent_id, player_id\)/, 'must be on (agent_id, player_id)')
  } finally {
    await c.end()
  }
})

test('second apc row for same (agent,player) is rejected (23505)', async () => {
  await withRollback(async (c) => {
    const agentId = await seedAgent(c)
    const playerId = await seedPlayer(c, agentId)
    await insertApc(c, agentId, playerId)
    await assert.rejects(
      () => insertApc(c, agentId, playerId),
      (err: any) => err.code === '23505',
      'duplicate (agent,player) apc row must violate the unique index'
    )
  })
})
