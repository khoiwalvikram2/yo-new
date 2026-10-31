/**
 * The agent betting gate's SQL against the real database — READ ONLY (every statement is a SELECT;
 * a check without suitable data skips rather than fails).
 *
 * A player who joined through an agent player's referral link has no users.agent_id; the gate reads
 * the agent through the CONFIRMED referral attribution (owner decision 3), so the agent's status chain
 * and domains must gate that player exactly as they gate the agent's own players.
 *
 *   node --env-file-if-exists=.env --test --import tsx src/domains/userApp/services/agentBettingGate.integration.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { db } from '../../../db/client.js'
import { checkPlayerAgentBettingGate, evaluateAgentBettingGate, type AgentChainRow } from './agentBettingGate.js'

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? []
}

after(async () => {
  try { await (db as any).$client?.end?.() } catch {}
})

describe('agent betting gate (live data, read-only)', () => {
  it('a referral-only player is gated by its confirmed referrer\'s agent chain', async (t) => {
    const found = rows(await db.execute(sql`
      SELECT u.id AS user_id, u.tenant, ru.agent_id::text AS agent_id
      FROM users u
      JOIN referral_attributions ra ON ra.referee_id = u.id AND ra.tenant = u.tenant AND ra.status = 'confirmed'
      JOIN users ru ON ru.id = ra.referrer_id AND ru.tenant = u.tenant
      WHERE u.agent_id IS NULL AND ru.agent_id IS NOT NULL
      LIMIT 1
    `))
    if (!found[0]) return t.skip('no referral-only player of an agent player in this database')
    const { user_id: userId, tenant, agent_id: agentId } = found[0]

    // The expected verdict, from an independent read of the referrer's agent and its ancestors.
    const chain = rows(await db.execute(sql`
      SELECT ${agentId}::text AS player_agent_id, a.id::text AS agent_id, a.status, a.allowed_domains
      FROM agents a
      WHERE a.id = ${agentId}::uuid
         OR a.id IN (SELECT c.ancestor_id FROM agent_hierarchy_closure c WHERE c.descendant_id = ${agentId}::uuid)
    `)) as AgentChainRow[]
    assert.ok(chain.length > 0, 'the referrer\'s agent exists')

    for (const domain of ['sports', 'casino', 'matka'] as const) {
      const actual = await checkPlayerAgentBettingGate(db, { userId: Number(userId), tenant }, domain)
      assert.deepEqual(actual, evaluateAgentBettingGate(chain, domain), `${domain}: gate differs from the referrer's agent chain`)
    }
  })

  it('a player with no agent at all is not gated', async (t) => {
    const found = rows(await db.execute(sql`
      SELECT u.id AS user_id, u.tenant
      FROM users u
      WHERE u.agent_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM referral_attributions ra WHERE ra.referee_id = u.id AND ra.status = 'confirmed')
      LIMIT 1
    `))
    if (!found[0]) return t.skip('no player without an agent in this database')
    const verdict = await checkPlayerAgentBettingGate(db, { userId: Number(found[0].user_id), tenant: found[0].tenant }, 'sports')
    assert.deepEqual(verdict, { ok: true })
  })
})
