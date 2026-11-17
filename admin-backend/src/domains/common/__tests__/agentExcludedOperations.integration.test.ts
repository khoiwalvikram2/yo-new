/**
 * The admin-only reads an agent's flat grants would open are refused on the real resolver map (SCO-05).
 *
 * Measured before, as a sub-agent: matka(id), matkasExportCSV, matkaDefaultRates, snapshotRuns,
 * snapshotPgBossOverview, sportsResultStats, casinoVendorsWithSettings and movePlayerToAgentPreCheck each answered
 * exactly what the whitelabel admin gets, the pre-check with any player's name and phone number.
 *
 * adminSurfaceSessions.test.ts checks the guard on a stand-in map. This checks the wiring: each excluded name is a
 * root Query resolver the guard actually wraps (a field inside a namespace would be invisible to it), and an
 * agent is refused there while an admin is not. Requires DATABASE_URL (the admin calls read an empty tenant).
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_EXCLUDED_OPERATIONS } from '@src/domains/common/agentExcludedOperations.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'

const TENANT = 'vfyfix-agent-excl-none'
const AGENT_ID = 'a2a2a2a2-0000-4000-8000-000000000002'
let Query: Record<string, any> = {}

const at = (fieldName: string) => ({ parentType: { name: 'Query' }, fieldName })
const agent = () => ({
  user: { sub: AGENT_ID, agentId: AGENT_ID, type: 'agent', roles: [], agentSchemeType: 'SHARING' },
  permissions: deriveAgentPermissions(['sports', 'casino', 'matka'] as never, 'SHARING'),
  tenant: TENANT,
  whitelabel: { id: TENANT },
  request: { headers: {} },
})
const wlAdmin = () => ({
  user: { sub: '987656', name: 'vfyfix wl', roles: ['Whitelabel Admin'], type: 'admin' },
  permissions: [
    { domain: 'users', actions: ['read', 'write'] },
    { domain: 'players', actions: ['manage'] },
    { domain: 'matka', actions: ['read'] },
  ],
  tenant: TENANT,
  whitelabel: { id: TENANT },
  request: { headers: {} },
})

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { domainResolvers } = await import('@src/domains/index.js')
  Query = (domainResolvers as any).Query
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
  await closeRedisEmitter().catch(() => {})
})

describe('agents are refused the admin-only reads on the real map', () => {
  for (const name of Object.keys(AGENT_EXCLUDED_OPERATIONS)) {
    it(`${name}`, async () => {
      assert.equal(typeof Query[name], 'function', `${name} is not a root Query resolver, so the guard cannot see it`)
      await assert.rejects(async () => Query[name](undefined, {}, agent(), at(name)), /not available to agents/)
    })
  }
})

describe('the same fields still answer an admin, and an agent keeps its own reads', () => {
  it('movePlayerToAgentPreCheck reaches its resolver for a whitelabel admin', async () => {
    const args = { playerId: '987654321', targetAgentId: AGENT_ID }
    let message = ''
    try {
      await Query.movePlayerToAgentPreCheck(undefined, args, wlAdmin(), at('movePlayerToAgentPreCheck'))
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    assert.doesNotMatch(message, /not available to agents|Forbidden/)
  })

  it('matkas, which agent screens list, is not excluded', async () => {
    assert.ok(!('matkas' in AGENT_EXCLUDED_OPERATIONS))
    let message = ''
    try {
      await Query.matkas(undefined, {}, agent(), at('matkas'))
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    assert.doesNotMatch(message, /not available to agents/)
  })
})
