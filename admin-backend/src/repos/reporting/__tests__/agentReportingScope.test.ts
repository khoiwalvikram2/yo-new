/**
 * Agent scoping in the reporting repos (W4, agent-schemes hardening).
 *
 * The matka drill-downs (type, market, session and player breakdowns) accepted
 * `agentId` and ignored it, so an agent opening any of them saw the whole
 * whitelabel's matka figures, and the player breakdown listed every player of
 * the whitelabel with their phone number. The conditions every drill-down
 * shares are asserted here as the SQL PostgreSQL would receive.
 *
 * Also covered: the canonical agent-player subquery the repos now share
 * (subtree through the closure table + referral, both routes), and the agent
 * chain an agent caller may see on a player breakdown row.
 *
 * Unit tests: the SQL is rendered, never executed. No database rows are read
 * or written.
 *   node --env-file-if-exists=.env --test --import tsx src/repos/reporting/__tests__/agentReportingScope.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { and } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const dialect = new PgDialect()
const render = (conditions: unknown[]) => dialect.sqlToQuery(and(...(conditions as any[]))!)

describe('matka drill-down conditions', () => {
  it('scope an agent caller to its own players', async () => {
    const { buildBetConditions } = await import('@src/repos/reporting/matkaReportingRepo.js')
    const q = render(buildBetConditions({ tenant: 'brand-a', whitelabelId: 'brand-a', agentId: 'agent-9' }))
    const text = q.sql.replace(/\s+/g, ' ')
    assert.match(text, /"matka_bets"\."user_id" IN \( ?WITH agent_descendants/, 'the bet user must be one of the agent players')
    assert.match(text, /agent_hierarchy_closure/, 'the subtree comes from the closure table')
    assert.match(text, /referral_attributions/, 'referral-linked players count too')
    assert.ok(q.params.includes('agent-9'), 'bound to the caller agent')
    assert.ok(q.params.includes('brand-a'), 'players of the caller tenant only')
  })

  it('apply no agent scope for a whitelabel admin (no agentId)', async () => {
    const { buildBetConditions } = await import('@src/repos/reporting/matkaReportingRepo.js')
    const q = render(buildBetConditions({ tenant: 'brand-a', whitelabelId: 'brand-a' }))
    assert.doesNotMatch(q.sql, /agent_hierarchy_closure/)
    assert.match(q.sql, /"matka_bets"\."tenant" = \$/)
  })

  it('keep the tenant and whitelabel predicates when an agent is scoped', async () => {
    const { buildBetConditions } = await import('@src/repos/reporting/matkaReportingRepo.js')
    const q = render(buildBetConditions({ tenant: 'brand-a', whitelabelId: 'wl-a', agentId: 'agent-9' }))
    assert.match(q.sql, /"matka_bets"\."tenant" = \$/)
    assert.match(q.sql, /"matka_bets"\."whitelabel_id" = \$/)
  })
})

describe('the shared agent-player subquery', () => {
  it('reuses the canonical CTE: closure subtree, direct players, confirmed referrals', async () => {
    const { inAgentPlayers } = await import('@src/repos/reporting/agentPlayerScope.js')
    const { reportingDailySnapshots } = await import('@shared/db/schema.js')
    const q = dialect.sqlToQuery(inAgentPlayers(reportingDailySnapshots.playerId, 'agent-1', 'brand-a'))
    const text = q.sql.replace(/\s+/g, ' ')
    assert.match(text, /"reporting_daily_snapshots"\."player_id" IN \( ?WITH agent_descendants/)
    assert.match(text, /agent_direct_players/)
    assert.match(text, /agent_referred_players/)
    assert.match(text, /SELECT player_id FROM agent_players\)$/)
    assert.doesNotMatch(text, /parent_agent_id/, 'a direct-parent check would miss grandchildren')
    assert.deepEqual(q.params.filter((p) => p === 'agent-1').length, 1)
  })

  it('falls back to the default tenant rather than an empty one', async () => {
    const { agentPlayerIdsSubquery } = await import('@src/repos/reporting/agentPlayerScope.js')
    const q = dialect.sqlToQuery(agentPlayerIdsSubquery('agent-1', undefined))
    assert.ok(q.params.includes('default'))
  })
})

describe('the agent chain an agent caller sees', () => {
  // Closure rows of the player's direct agent D, root first: R (depth 2) > A (1) > D (0).
  const chain = [
    { ancestorId: 'R', depth: 2 },
    { ancestorId: 'A', depth: 1 },
    { ancestorId: 'D', depth: 0 },
  ]

  it('an admin sees the whole chain', async () => {
    const { callerVisibleChain } = await import('@src/repos/reporting/agentPlayerScope.js')
    assert.deepEqual(callerVisibleChain(chain, undefined)?.map((a) => a.ancestorId), ['R', 'A', 'D'])
  })

  it('an agent sees from itself down, never its upline', async () => {
    const { callerVisibleChain } = await import('@src/repos/reporting/agentPlayerScope.js')
    assert.deepEqual(callerVisibleChain(chain, 'A')?.map((a) => a.ancestorId), ['A', 'D'])
  })

  it('an agent outside the chain sees no agent at all', async () => {
    const { callerVisibleChain } = await import('@src/repos/reporting/agentPlayerScope.js')
    assert.equal(callerVisibleChain(chain, 'X'), null)
  })
})
