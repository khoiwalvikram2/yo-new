/**
 * Tenant and subtree scoping of the agent reads fixed in W3 (agentTree,
 * agentActivity, agentDashboardStats, settlementSummary, agentPlayerCredits,
 * agentCreditAlerts, whitelabelCreditPlayers). Repository methods are stubbed on
 * their prototypes; every refusal here happens before a database query.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/resolvers/__tests__/agentReadScoping.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AgentsRepo } from '../../../../repos/agents/AgentsRepo.js'
import { AgentCreditAlertsRepo } from '../../../../repos/agents/AgentCreditAlertsRepo.js'
import { CreditService } from '../../services/CreditService.js'
import { deriveAgentPermissions } from '../../services/AgentPermissionsService.js'
import { buildAgentsQueryResolvers } from '../queries.js'

const ROOT = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const CHILD = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
const OTHER = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'
const FOREIGN = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4' // another whitelabel

const row = (id: string, parentAgentId: string | null, tenantId = 't1') => ({
  id, tenantId, schemeType: 'CREDIT', status: 'ACTIVE', allowedDomains: ['sports'], parentAgentId,
  levelIndex: null, createdAt: new Date('2026-01-01T00:00:00Z'), username: id.slice(0, 4), tokenVersion: 0,
})
const AGENTS = new Map<string, any>([
  [ROOT, row(ROOT, null)],
  [CHILD, row(CHILD, ROOT)],
  [OTHER, row(OTHER, null)],
  [FOREIGN, row(FOREIGN, null, 't2')],
])

const admin = { user: { sub: '7', roles: ['Whitelabel Admin'] }, tenant: 't1', whitelabel: { id: 't1' }, permissions: [{ domain: 'all', actions: ['*'] }] }
const agent = (agentId: string) => ({
  user: { sub: agentId, type: 'agent', agentId, roles: [] }, tenant: 't1', whitelabel: { id: 't1' }, permissions: deriveAgentPermissions(['sports']),
})

const originals: Record<string, any> = {}
let listChildrenCalls: string[] = []

before(() => {
  originals.findById = AgentsRepo.prototype.findById
  originals.listChildren = AgentsRepo.prototype.listChildren
  originals.getDescendantIds = AgentsRepo.prototype.getDescendantIds
  originals.getAllAlerts = AgentCreditAlertsRepo.prototype.getAllAlerts
  originals.listWl = CreditService.prototype.listWhitelabelCreditPlayers
  ;(AgentsRepo.prototype as any).findById = async (id: string) => AGENTS.get(id) ?? null
  ;(AgentsRepo.prototype as any).listChildren = async (id: string) => {
    listChildrenCalls.push(id)
    return [...AGENTS.values()].filter((a) => a.parentAgentId === id)
  }
  ;(AgentsRepo.prototype as any).getDescendantIds = async (id: string) =>
    [id, ...[...AGENTS.values()].filter((a) => a.parentAgentId === id).map((a) => a.id)]
  ;(AgentCreditAlertsRepo.prototype as any).getAllAlerts = async (agentId: string) => [
    { id: 'x', agentId, alertType: 'THRESHOLD', threshold: 80, currentValue: 90, isActive: true, notifiedAt: null, createdAt: new Date() },
  ]
  ;(CreditService.prototype as any).listWhitelabelCreditPlayers = async () => {
    throw new Error('must not be reached for an agent')
  }
})

after(() => {
  AgentsRepo.prototype.findById = originals.findById
  AgentsRepo.prototype.listChildren = originals.listChildren
  AgentsRepo.prototype.getDescendantIds = originals.getDescendantIds
  AgentCreditAlertsRepo.prototype.getAllAlerts = originals.getAllAlerts
  CreditService.prototype.listWhitelabelCreditPlayers = originals.listWl
})

beforeEach(() => {
  listChildrenCalls = []
})

describe('agent reads are scoped to the caller tenant and subtree', () => {
  const q = buildAgentsQueryResolvers() as any

  it("agentTree: an admin cannot list another whitelabel's sub-agents", async () => {
    await assert.rejects(q.agentTree(null, { rootId: FOREIGN }, admin), /Forbidden/)
    assert.deepEqual(listChildrenCalls, [])
  })

  it('agentTree: an admin lists its own tenant\'s children', async () => {
    const children = await q.agentTree(null, { rootId: ROOT }, admin)
    assert.deepEqual(children.map((c: any) => c.id), [CHILD])
  })

  for (const name of ['agentActivity', 'agentDashboardStats', 'settlementSummary', 'agentPlayerCredits', 'agentCreditAlerts', 'previewCreditReconciliation']) {
    it(`${name}: another whitelabel's agent is Forbidden for an admin`, async () => {
      await assert.rejects(
        q[name](null, { agentId: FOREIGN, periodFrom: '2026-01-01', periodTo: '2026-02-01' }, admin),
        /Forbidden/,
      )
    })
  }

  it('agentCreditAlerts: an agent reads its subtree and is refused outside it', async () => {
    const own = await q.agentCreditAlerts(null, { agentId: CHILD }, agent(ROOT))
    assert.equal(own.length, 1)
    await assert.rejects(q.agentCreditAlerts(null, { agentId: OTHER }, agent(ROOT)), /Unauthorized/)
    await assert.rejects(q.agentCreditAlerts(null, { agentId: ROOT }, agent(CHILD)), /Unauthorized/)
  })

  it('whitelabelCreditPlayers: refused for an agent', async () => {
    await assert.rejects(q.whitelabelCreditPlayers(null, {}, agent(ROOT)), /Forbidden/)
  })
})
