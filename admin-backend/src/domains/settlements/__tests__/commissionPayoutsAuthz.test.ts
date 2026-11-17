/**
 * Who may list a whitelabel's commission payouts (SCO-09).
 *
 * Measured before: an admin needed only a session. A support admin holding nothing but jackpots:read listed all
 * 137 payouts of grandwinn (agent usernames, amounts, periods) while settlementDashboard refused it. The screen's
 * permission, settlements.commission:view (flat finance:read), was never checked. (The other half, the token of a
 * deleted admin still answering, is closed in buildAuthContext: common/__tests__/adminSessions.integration.test.ts.)
 *
 * Repository methods are stubbed on their prototypes, so nothing here reads the database: a refused caller is
 * stopped before the list is read, and a stub records whether it was.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/settlements/__tests__/commissionPayoutsAuthz.test.ts
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AgentsRepo } from '../../../repos/agents/AgentsRepo.js'
import { CommissionPayoutsRepo } from '../../../repos/settlements/CommissionPayoutsRepo.js'
import { deriveAgentPermissions } from '../../agents/services/AgentPermissionsService.js'
import { settlementsQueryResolvers } from '../resolvers/queries.js'

const T = 'vfyfix-payouts'
const COMMISSION_AGENT = '5a5a5a5a-0000-4000-8000-000000000005'
const SHARING_AGENT = '6b6b6b6b-0000-4000-8000-000000000006'

const originals: Record<string, any> = {}
let listCalls = 0

const anonymous = { tenant: T, whitelabel: { id: T } }
const admin = (permissions: Array<{ domain: string; actions: string[] }>) => ({
  user: { sub: '7', roles: ['Support'] },
  tenant: T,
  whitelabel: { id: T },
  permissions,
})
const agent = (agentId: string, scheme: 'COMMISSION' | 'SHARING') => ({
  user: { sub: agentId, type: 'agent', agentId, roles: [] },
  tenant: T,
  whitelabel: { id: T },
  permissions: deriveAgentPermissions(['sports'] as never, scheme),
})

const list = (ctx: unknown, args: Record<string, unknown> = {}) => (settlementsQueryResolvers as any).commissionPayouts(null, args, ctx)
const page = (ctx: unknown) => (settlementsQueryResolvers as any).commissionPayoutsPage(null, { limit: 3 }, ctx)

before(() => {
  originals.findById = AgentsRepo.prototype.findById
  originals.list = CommissionPayoutsRepo.prototype.list
  originals.count = CommissionPayoutsRepo.prototype.count
  ;(AgentsRepo.prototype as any).findById = async (id: string) =>
    id === COMMISSION_AGENT ? { id, tenantId: T, schemeType: 'COMMISSION', parentAgentId: null, status: 'ACTIVE' }
      : id === SHARING_AGENT ? { id, tenantId: T, schemeType: 'SHARING', parentAgentId: null, status: 'ACTIVE' }
        : null
  ;(CommissionPayoutsRepo.prototype as any).list = async () => {
    listCalls++
    return []
  }
  ;(CommissionPayoutsRepo.prototype as any).count = async () => 0
})

after(() => {
  AgentsRepo.prototype.findById = originals.findById
  CommissionPayoutsRepo.prototype.list = originals.list
  CommissionPayoutsRepo.prototype.count = originals.count
})

beforeEach(() => {
  listCalls = 0
})

describe('commission payouts need the commission read permission', () => {
  it('refuses a caller with no session', async () => {
    await assert.rejects(list(anonymous), /Unauthorized/)
    await assert.rejects(page(anonymous), /Unauthorized/)
    assert.equal(listCalls, 0)
  })

  it('refuses an admin holding only an unrelated permission, before reading the list', async () => {
    const jackpotsOnly = admin([{ domain: 'jackpots', actions: ['read'] }])
    await assert.rejects(list(jackpotsOnly), /Forbidden: insufficient permissions to view commission \(settlements\.commission:view or agents\.commission:view\)/)
    await assert.rejects(page(jackpotsOnly), /Forbidden: insufficient permissions to view commission/)
    // Finance Manager holds settlements.center:view but not the commission read; no screen it can open lists payouts.
    await assert.rejects(list(admin([{ domain: 'settlements.center', actions: ['view'] }])), /Forbidden/)
    assert.equal(listCalls, 0, 'the payouts were read for a refused caller')
  })

  it('answers an admin holding settlements.commission:view, nested or through flat finance:read', async () => {
    assert.deepEqual(await list(admin([{ domain: 'settlements.commission', actions: ['view'] }])), [])
    assert.deepEqual(await page(admin([{ domain: 'finance', actions: ['read'] }])), { items: [], total: 0 })
    assert.deepEqual(await list(admin([{ domain: 'all', actions: ['*'] }])), [])
  })

  it("takes the agent profile Commission tab's gate: agents.commission:view also answers, nested or through flat agents:view (T078)", async () => {
    // The tab's other reads (requireCommissionReadForAdmin) accepted either permission while this table took one.
    assert.deepEqual(await list(admin([{ domain: 'agents.commission', actions: ['view'] }])), [])
    assert.deepEqual(await page(admin([{ domain: 'agents', actions: ['view'] }])), { items: [], total: 0 })
    // agents.commission:update alone is not the read.
    await assert.rejects(list(admin([{ domain: 'agents.commission', actions: ['update'] }])), /Forbidden/)
    assert.equal(listCalls, 2)
  })
})

describe('the agent branch is unchanged', () => {
  it('a commission agent reads its own payouts', async () => {
    assert.deepEqual(await list(agent(COMMISSION_AGENT, 'COMMISSION')), [])
    assert.equal(listCalls, 1)
  })

  it('a sharing agent is refused with its own message', async () => {
    await assert.rejects(list(agent(SHARING_AGENT, 'SHARING')), /Only commission agents can access commission payouts/)
  })

  it("a commission agent reads a direct sub-agent's payouts but not another agent's; the admin gate never widens it", async () => {
    // Every agent derives agents.commission:view (flat agents:view), which now opens the admin branch for admins.
    await assert.rejects(
      list(agent(COMMISSION_AGENT, 'COMMISSION'), { agentId: SHARING_AGENT }),
      /Commission agents can only access their own or direct sub-agent commission payouts/,
    )
    // An agent session without its agent id is refused, not treated as an admin holding agents.commission:view.
    const noAgentId = { ...agent(COMMISSION_AGENT, 'COMMISSION'), user: { sub: COMMISSION_AGENT, type: 'agent', roles: [] } }
    await assert.rejects(list(noAgentId), /Forbidden: insufficient permissions to view commission payouts/)
    assert.equal(listCalls, 0)
  })
})
