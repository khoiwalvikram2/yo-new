/**
 * Tenant and subtree scoping of the agent reads fixed in W3 (agentTree,
 * agentActivity, agentDashboardStats, settlementSummary). Repository methods are
 * stubbed on their prototypes; every refusal here happens before a database query.
 *
 * The credit-limit model's reads that W3 also scoped (agentPlayerCredits,
 * agentCreditAlerts, whitelabelCreditPlayers and the rest) were removed with that
 * model (spec 2026-11-02 §6); the last block checks they stay gone.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/resolvers/__tests__/agentReadScoping.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AgentsRepo } from '../../../../repos/agents/AgentsRepo.js'
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
const agent = (agentId: string) => ({ user: { sub: agentId, type: 'agent', agentId, roles: [] }, tenant: 't1', whitelabel: { id: 't1' } })

const originals: Record<string, any> = {}
let listChildrenCalls: string[] = []

before(() => {
  originals.findById = AgentsRepo.prototype.findById
  originals.listChildren = AgentsRepo.prototype.listChildren
  originals.getDescendantIds = AgentsRepo.prototype.getDescendantIds
  ;(AgentsRepo.prototype as any).findById = async (id: string) => AGENTS.get(id) ?? null
  ;(AgentsRepo.prototype as any).listChildren = async (id: string) => {
    listChildrenCalls.push(id)
    return [...AGENTS.values()].filter((a) => a.parentAgentId === id)
  }
  ;(AgentsRepo.prototype as any).getDescendantIds = async (id: string) =>
    [id, ...[...AGENTS.values()].filter((a) => a.parentAgentId === id).map((a) => a.id)]
})

after(() => {
  AgentsRepo.prototype.findById = originals.findById
  AgentsRepo.prototype.listChildren = originals.listChildren
  AgentsRepo.prototype.getDescendantIds = originals.getDescendantIds
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

  for (const name of ['agentActivity', 'agentDashboardStats', 'settlementSummary']) {
    it(`${name}: another whitelabel's agent is Forbidden for an admin`, async () => {
      await assert.rejects(
        q[name](null, { agentId: FOREIGN, periodFrom: '2026-01-01', periodTo: '2026-02-01' }, admin),
        /Forbidden/,
      )
    })
  }

  it('agentActivity: an agent is refused above and beside its subtree, before any read', async () => {
    await assert.rejects(q.agentActivity(null, { agentId: ROOT }, agent(CHILD)), /Unauthorized/)
    await assert.rejects(q.agentActivity(null, { agentId: OTHER }, agent(ROOT)), /Unauthorized/)
  })
})

describe("the credit-limit model's reads are gone (spec 2026-11-02 §6)", () => {
  it('the agents query map has none of them (a CREDIT account is read through the chip reads now)', () => {
    const q = buildAgentsQueryResolvers() as any
    for (const name of [
      'creditAllocation',
      'creditTransactionHistory',
      'agentCreditTransactions',
      'agentCreditTransactionsCount',
      'agentPlayerCredits',
      'previewCreditReconciliation',
      'agentCreditAlerts',
      'whitelabelCreditPlayers',
    ]) {
      assert.equal(q[name], undefined, `${name} is still in the agents query map`)
    }
  })
})
