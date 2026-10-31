/**
 * Guards on the agent mutations (resolvers/mutations.ts) and the agent branch of
 * buildAuthContext, exercised through the real resolvers with the repositories
 * stubbed on their prototypes. No database: every path here stops at a refusal,
 * or at a stubbed write that records what it was given.
 *
 * Hierarchy (all tenant t1):
 *   P  SHARING L1 ── C  SHARING L2 ── G  SHARING L3
 *   L4 SHARING L4 (no children)
 *   CR CREDIT  L1 ── CRC CREDIT L2 ── CRG CREDIT L3
 *   K5 COMMISSION L5 ── K COMMISSION L6
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

const T = 't1'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const P = id(1), C = id(2), G = id(3), L4 = id(4), CR = id(5), CRC = id(6), CRG = id(7), K5 = id(8), K = id(9)

const createdAt = new Date('2026-10-21T10:00:00+05:30') // Wednesday
const mk = (agentId: string, schemeType: string, levelIndex: number, parentAgentId: string | null, allowedDomains: string[]) => ({
  id: agentId,
  tenantId: T,
  schemeType,
  levelIndex,
  parentAgentId,
  allowedDomains,
  status: 'ACTIVE',
  tallyEnabled: false,
  tallyDomains: null as string[] | null,
  tokenVersion: 0,
  createdAt,
  username: `agent_${agentId.slice(-2)}`,
})
const agents: Record<string, ReturnType<typeof mk>> = {
  [P]: mk(P, 'SHARING', 1, null, ['sports', 'casino']),
  [C]: mk(C, 'SHARING', 2, P, ['sports']),
  [G]: mk(G, 'SHARING', 3, C, ['sports']),
  [L4]: mk(L4, 'SHARING', 4, null, ['sports']),
  [CR]: mk(CR, 'CREDIT', 1, null, ['sports']),
  [CRC]: mk(CRC, 'CREDIT', 2, CR, ['sports']),
  [CRG]: mk(CRG, 'CREDIT', 3, CRC, ['sports']),
  [K5]: mk(K5, 'COMMISSION', 5, null, ['sports']),
  [K]: mk(K, 'COMMISSION', 6, K5, ['sports']),
}
const subtree: Record<string, string[]> = {
  [P]: [P, C, G],
  [C]: [C, G],
  [CR]: [CR, CRC, CRG],
  [CRC]: [CRC, CRG],
  [K5]: [K5, K],
}
type Row = { effectiveFrom: Date; effectiveTo: Date | null; rate: number }
let rates: Record<string, Row[]> = {}
let ancestorStatuses: Record<string, string[]> = {}
const captured: any[] = []

const asAgent = (agentId: string) => ({
  user: { sub: agentId, type: 'agent', agentId, isReadOnly: false, roles: [] },
  tenant: T,
  whitelabel: { id: T },
  permissions: [],
})
const asAdmin = () => ({
  user: { sub: '1', type: 'admin', roles: ['Whitelabel Admin'] },
  tenant: T,
  whitelabel: { id: T },
  permissions: [],
})

let m: any
let buildAuthContext: any
let signJwt: any
const restore: Array<() => void> = []
function stub(proto: any, name: string, fn: any) {
  const orig = proto[name]
  proto[name] = fn
  restore.push(() => {
    proto[name] = orig
  })
}

before(async () => {
  const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
  const { AgentRateHistoryRepo } = await import('@src/repos/agents/AgentRateHistoryRepo.js')
  const { AgentConfigsRepo } = await import('@src/repos/agents/AgentConfigsRepo.js')
  const { AgentSettlementsRepo } = await import('@src/repos/agents/AgentSettlementsRepo.js')
  const { CreditService } = await import('@src/domains/agents/services/CreditService.js')

  stub(AgentsRepo.prototype, 'findById', async (x: string) => agents[x] ?? null)
  stub(AgentsRepo.prototype, 'findByIdScoped', async (x: string, t: string) => (agents[x]?.tenantId === t ? agents[x] : null))
  stub(AgentsRepo.prototype, 'getDescendantIds', async (x: string) => subtree[x] ?? [x])
  stub(AgentsRepo.prototype, 'listChildren', async (x: string) => Object.values(agents).filter((a) => a.parentAgentId === x))
  stub(AgentsRepo.prototype, 'updateAgent', async () => {
    throw new Error('SENTINEL_UPDATE')
  })
  stub(AgentsRepo.prototype, 'listNonActiveAncestorStatuses', async (x: string) => ancestorStatuses[x] ?? [])
  stub(AgentRateHistoryRepo.prototype, 'listRows', async (kind: string, agentId: string, domain: string) => rates[`${kind}:${agentId}:${domain}`] ?? [])
  stub(AgentRateHistoryRepo.prototype, 'whitelabelShareCap', async () => 0.9)
  stub(AgentRateHistoryRepo.prototype, 'whitelabelTimezone', async () => 'Asia/Kolkata')
  stub(AgentConfigsRepo.prototype, 'setSharingConfig', async (p: any) => {
    captured.push(p)
    return p
  })
  stub(AgentConfigsRepo.prototype, 'setCommissionConfig', async (p: any) => {
    captured.push(p)
    return p
  })
  stub(AgentSettlementsRepo.prototype, 'getById', async () => ({ id: 's1', agentId: CR }))
  stub(CreditService.prototype, 'getCreditAllocation', async (agentId: string) => ({
    agentId,
    creditLimit: 1000,
    creditUsed: 500,
    creditAvailable: 500,
  }))

  const mod = await import('@src/domains/agents/resolvers/mutations.js')
  m = mod.buildAgentsMutationResolvers()
  ;({ buildAuthContext, signJwt } = await import('@src/domains/common/auth.js'))
})

after(() => {
  for (const r of restore.reverse()) r()
})

describe('adjustSubAgentCredit', () => {
  it('refuses an agent raising its own limit', async () => {
    await assert.rejects(m.adjustSubAgentCredit(null, { agentId: CR, creditLimit: 5000 }, asAgent(CR)), /cannot adjust a credit limit for itself/)
  })
  it('refuses an agent acting on its parent', async () => {
    await assert.rejects(m.adjustSubAgentCredit(null, { agentId: CR, creditLimit: 5000 }, asAgent(CRC)), /Agent not found/)
  })
})

describe('updateAgent', () => {
  it('refuses an agent updating itself', async () => {
    await assert.rejects(m.updateAgent(null, { input: { id: C, allowedDomains: ['sports'] } }, asAgent(C)), /cannot update agent settings for itself/)
  })
  it('refuses an agent changing a sub-agent level or tally settings', async () => {
    await assert.rejects(m.updateAgent(null, { input: { id: C, levelIndex: 3 } }, asAgent(P)), /cannot change levelIndex/)
    await assert.rejects(m.updateAgent(null, { input: { id: C, tallyEnabled: true } }, asAgent(P)), /cannot change tallyEnabled/)
  })
  it('lets an agent echo the level and widen a sub-agent within its own domains', async () => {
    await assert.rejects(
      m.updateAgent(null, { input: { id: C, levelIndex: 2, allowedDomains: ['sports', 'casino'] } }, asAgent(P)),
      /SENTINEL_UPDATE/
    )
  })
  it('refuses domains the parent lacks, for admins too', async () => {
    await assert.rejects(m.updateAgent(null, { input: { id: C, allowedDomains: ['matka'] } }, asAdmin()), /'matka' is not allowed/)
    await assert.rejects(m.updateAgent(null, { input: { id: G, allowedDomains: ['casino'] } }, asAgent(P)), /'casino' is not allowed/)
  })
  it('caps SHARING at level 4 and leaves COMMISSION deeper than 4 editable', async () => {
    await assert.rejects(m.updateAgent(null, { input: { id: G, levelIndex: 5 } }, asAdmin()), /Maximum hierarchy depth/)
    await assert.rejects(m.updateAgent(null, { input: { id: K, levelIndex: 6, allowedDomains: ['sports'] } }, asAdmin()), /SENTINEL_UPDATE/)
  })
})

describe('createAgent depth re-check', () => {
  it('a level-4 SHARING agent cannot create level 5 by omitting parentAgentId', async () => {
    const input = { schemeType: 'SHARING', allowedDomains: ['sports'], username: 'sub_agent_five', password: 'secret123', currency: 'INR' }
    await assert.rejects(m.createAgent(null, { input }, asAgent(L4)), /Maximum hierarchy depth/)
  })
  it('refuses a credit limit on a non-CREDIT agent', async () => {
    const input = { schemeType: 'SHARING', allowedDomains: ['sports'], username: 'sub_agent_six', password: 'secret123', currency: 'INR', creditLimit: 100 }
    await assert.rejects(m.createAgent(null, { input }, asAdmin()), /only be set for CREDIT agents/)
  })
  it('looks the parent up in the caller tenant', async () => {
    const input = { schemeType: 'SHARING', allowedDomains: ['sports'], username: 'sub_agent_seven', password: 'secret123', currency: 'INR', parentAgentId: P }
    await assert.rejects(m.createAgent(null, { input }, { ...asAdmin(), tenant: 'other', whitelabel: { id: 'other' } }), /Parent agent not found/)
  })
})

describe('whitelabel player credit is admin-only', () => {
  for (const name of ['adjustWhitelabelPlayerCredit', 'depositCreditToWhitelabelPlayer', 'withdrawCreditFromWhitelabelPlayer']) {
    it(`${name} refuses a SHARING or CREDIT agent`, async () => {
      const input = { playerId: '1', creditLimit: 10, amount: 10 }
      await assert.rejects(m[name](null, { input }, asAgent(CR)), /admin operation/)
      await assert.rejects(m[name](null, { input }, asAgent(P)), /admin operation/)
    })
  }
})

describe('adjustAgentCredit DECREASE', () => {
  it('is refused for an agent caller', async () => {
    const res = await m.adjustAgentCredit(null, { input: { agentId: CRC, adjustmentType: 'DECREASE', amount: 10 } }, asAgent(CR))
    assert.equal(res.success, false)
    assert.match(res.message, /administrator/)
  })
})

describe('legacy settlement mutations: direct children only, never self', () => {
  const period = { periodFrom: '2026-10-01T00:00:00Z', periodTo: '2026-10-08T00:00:00Z', currency: 'INR' }
  it('settleSharingAgent refuses self and a grandchild', async () => {
    await assert.rejects(m.settleSharingAgent(null, { input: { agentId: CR, ...period } }, asAgent(CR)), /cannot settle for itself/)
    await assert.rejects(m.settleSharingAgent(null, { input: { agentId: CRG, ...period } }, asAgent(CR)), /direct sub-agents/)
  })
  it('settleAgent refuses a grandchild and other tenants', async () => {
    await assert.rejects(m.settleAgent(null, { input: { agentId: G, ...period } }, asAgent(P)), /direct sub-agents/)
    await assert.rejects(m.settleAgent(null, { input: { agentId: G, ...period } }, { ...asAdmin(), tenant: 'other', whitelabel: { id: 'other' } }), /Agent not found/)
  })
  it('postSettlement refuses the agent posting its own settlement', async () => {
    await assert.rejects(m.postSettlement(null, { settlementId: 's1' }, asAgent(CR)), /cannot post a settlement for itself/)
  })
})

describe('tenant and subtree scoping of credit mutations', () => {
  it('applyCreditReconciliation refuses self and outsiders', async () => {
    await assert.rejects(m.applyCreditReconciliation(null, { agentId: CR }, asAgent(CR)), /cannot reconcile credit for itself/)
    await assert.rejects(m.applyCreditReconciliation(null, { agentId: CR }, asAgent(CRC)), /Agent not found/)
    await assert.rejects(m.applyCreditReconciliation(null, { agentId: CR }, { ...asAdmin(), tenant: 'other', whitelabel: { id: 'other' } }), /Agent not found/)
  })
  it('depositCredit and setAgentCreditAlertThreshold are tenant-scoped for admins', async () => {
    const other = { ...asAdmin(), tenant: 'other', whitelabel: { id: 'other' } }
    await assert.rejects(m.depositCredit(null, { input: { agentId: CR, targetEntityType: 'player', targetEntityId: '1', amount: 1 } }, other), /Agent not found/)
    await assert.rejects(m.setAgentCreditAlertThreshold(null, { agentId: CR, threshold: 80 }, other), /Agent not found/)
  })
})

describe('rate configs', () => {
  it('back-dates the first SHARING rate to the creation day (IST)', async () => {
    rates = { ['sharing:' + P + ':sports']: [{ effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null, rate: 0.3 }] }
    captured.length = 0
    await m.setSharingConfig(null, { input: { agentId: C, domain: 'sports', shareRate: 0.1, effectiveFrom: '2026-10-21T15:00:00+05:30' } }, asAdmin())
    assert.equal(captured[0].effectiveFrom.toISOString(), new Date('2026-10-21T00:00:00+05:30').toISOString())
  })
  it('back-dates the first COMMISSION rate to the creation-cycle Monday 00:00 IST', async () => {
    rates = { ['commission:' + K5 + ':sports']: [{ effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null, rate: 0.05 }] }
    captured.length = 0
    await m.setCommissionConfig(null, { input: { agentId: K, domain: 'sports', commissionRate: 0.02, effectiveFrom: '2026-10-21T15:00:00+05:30' } }, asAdmin())
    assert.equal(captured[0].effectiveFrom.toISOString(), new Date('2026-10-19T00:00:00+05:30').toISOString())
  })
  it('keeps the requested date for a later rate change', async () => {
    rates = {
      ['sharing:' + P + ':sports']: [{ effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null, rate: 0.3 }],
      ['sharing:' + C + ':sports']: [{ effectiveFrom: new Date('2026-10-21T00:00:00+05:30'), effectiveTo: null, rate: 0.1 }],
    }
    captured.length = 0
    await m.setSharingConfig(null, { input: { agentId: C, domain: 'sports', shareRate: 0.15, effectiveFrom: '2026-10-25T00:00:00+05:30' } }, asAdmin())
    assert.equal(captured[0].effectiveFrom.toISOString(), new Date('2026-10-25T00:00:00+05:30').toISOString())
  })
  it('refuses lowering a parent below a direct child', async () => {
    rates = {
      ['sharing:' + P + ':sports']: [{ effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null, rate: 0.3 }],
      ['sharing:' + C + ':sports']: [{ effectiveFrom: new Date('2026-10-21T00:00:00+05:30'), effectiveTo: null, rate: 0.1 }],
    }
    await assert.rejects(
      m.setSharingConfig(null, { input: { agentId: P, domain: 'sports', shareRate: 0.05, effectiveFrom: '2026-10-25T00:00:00+05:30' } }, asAdmin()),
      /Lower the sub-agent's rate first/
    )
  })
  it('checks the parent cap at effectiveFrom, not now', async () => {
    rates = {
      ['sharing:' + P + ':sports']: [
        { effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null, rate: 0.3 },
        { effectiveFrom: new Date('2026-12-01T00:00:00Z'), effectiveTo: null, rate: 0.2 },
      ],
      ['sharing:' + C + ':sports']: [{ effectiveFrom: new Date('2026-10-21T00:00:00+05:30'), effectiveTo: null, rate: 0.1 }],
    }
    await assert.rejects(
      m.setSharingConfig(null, { input: { agentId: C, domain: 'sports', shareRate: 0.25, effectiveFrom: '2027-01-01T00:00:00Z' } }, asAdmin()),
      /cannot exceed parent agent's rate \(20\.00%\)/
    )
  })
})

describe('narrowSubtreeDomains (parent narrowing cascades down)', () => {
  it('strips the removed domains from every agent in the closure subtree, in the given transaction', async () => {
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
    const { PgDialect } = await import('drizzle-orm/pg-core')
    let statement: any = null
    const tx = { execute: async (q: any) => { statement = q; return { rows: [{ id: C }, { id: G }] } } }
    const changed = await new AgentsRepo().narrowSubtreeDomains(P, ['casino', 'matka', 'casino'], tx)
    assert.equal(changed, 2)
    const { sql: text, params } = new PgDialect().sqlToQuery(statement)
    const flat = text.replace(/\s+/g, ' ')
    assert.match(flat, /UPDATE agents SET allowed_domains = array_remove\(array_remove\(allowed_domains, \$\d+::text\), \$\d+::text\)/)
    assert.match(flat, /tally_domains = CASE WHEN tally_domains IS NULL THEN NULL ELSE array_remove\(array_remove\(tally_domains/)
    assert.match(flat, /SELECT descendant_id FROM agent_hierarchy_closure WHERE ancestor_id = \$\d+ AND depth >= 0/)
    assert.ok(params.includes(P))
    assert.deepEqual(params.filter((p: unknown) => p === 'casino').length > 0 && params.filter((p: unknown) => p === 'matka').length > 0, true)
  })
  it('does nothing when no domain was removed', async () => {
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
    let called = false
    const tx = { execute: async () => { called = true; return { rows: [] } } }
    assert.equal(await new AgentsRepo().narrowSubtreeDomains(P, [], tx), 0)
    assert.equal(called, false)
  })
})

describe('buildAuthContext: a suspended ancestor blocks the subtree (decision 1)', () => {
  const req = () => ({ headers: { authorization: `Bearer ${signJwt({ sub: C, name: 'c', roles: [], agentId: C, type: 'agent', v: 0 })}` } })
  it('honours the token when every ancestor is ACTIVE', async () => {
    ancestorStatuses = {}
    const auth = await buildAuthContext(req(), T)
    assert.equal(auth.user?.agentId, C)
    assert.equal(auth.user?.isReadOnly, false)
  })
  it('stops honouring it when an ancestor is SUSPENDED or BLOCKED', async () => {
    ancestorStatuses = { [C]: ['SUSPENDED'] }
    assert.deepEqual(await buildAuthContext(req(), T), {})
    ancestorStatuses = { [C]: ['BLOCKED'] }
    assert.deepEqual(await buildAuthContext(req(), T), {})
  })
  it('makes the agent read-only under an INACTIVE ancestor', async () => {
    ancestorStatuses = { [C]: ['INACTIVE'] }
    const auth = await buildAuthContext(req(), T)
    assert.equal(auth.user?.isReadOnly, true)
    ancestorStatuses = {}
  })
})
