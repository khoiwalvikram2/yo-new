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
/** Audit rows the resolvers wrote; recordAuditDb's insert is captured here instead of reaching the database. */
const audits: any[] = []

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
  // recordAuditDb inserts through this db: capture the row, and return none so no audit event is published.
  const { db } = await import('@src/db/client.js')
  stub(db, 'insert', () => ({
    values: (values: any) => ({
      returning: async () => {
        audits.push(values)
        return []
      },
    }),
  }))

  const mod = await import('@src/domains/agents/resolvers/mutations.js')
  m = mod.buildAgentsMutationResolvers()
  ;({ buildAuthContext, signJwt } = await import('@src/domains/common/auth.js'))
})

after(() => {
  for (const r of restore.reverse()) r()
})

describe('the credit-limit money mutations are gone (spec 2026-11-02 §6, stage C)', () => {
  // They refused with "Credit now moves as chips" while the UIs moved to depositChips / withdrawChips /
  // setCreditReference; now neither the schema, the resolver map nor the permission map has them.
  const REMOVED = [
    'adjustSubAgentCredit',
    'adjustAgentCredit',
    'allocateCreditToPlayer',
    'depositCredit',
    'withdrawCredit',
    'transferCredit',
    'settleSharingAgent',
    'applyCreditReconciliation',
    'setAgentCreditAlertThreshold',
    'resolveAgentCreditAlert',
    'adjustWhitelabelPlayerCredit',
    'depositCreditToWhitelabelPlayer',
    'withdrawCreditFromWhitelabelPlayer',
  ]
  it('the resolver map and AGENT_MUTATION_PERMISSIONS have none of them', async () => {
    const { AGENT_MUTATION_PERMISSIONS } = await import('@src/domains/agents/resolvers/guardAgentMutations.js')
    for (const name of REMOVED) {
      assert.equal(m[name], undefined, `${name} is still in the resolver map`)
      assert.equal(AGENT_MUTATION_PERMISSIONS[name], undefined, `${name} is still in AGENT_MUTATION_PERMISSIONS`)
    }
  })
  it('the chip moves that replace them are there', () => {
    for (const name of ['depositChips', 'withdrawChips', 'setCreditReference']) assert.equal(typeof m[name], 'function', name)
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

describe('legacy settlement mutations: direct children only, never self', () => {
  const period = { periodFrom: '2026-10-01T00:00:00Z', periodTo: '2026-10-08T00:00:00Z', currency: 'INR' }
  it('settleAgent refuses self, a grandchild and other tenants', async () => {
    await assert.rejects(m.settleAgent(null, { input: { agentId: P, ...period } }, asAgent(P)), /cannot settle for itself/)
    await assert.rejects(m.settleAgent(null, { input: { agentId: G, ...period } }, asAgent(P)), /direct sub-agents/)
    await assert.rejects(m.settleAgent(null, { input: { agentId: G, ...period } }, { ...asAdmin(), tenant: 'other', whitelabel: { id: 'other' } }), /Agent not found/)
  })
  it('a CREDIT agent settles by Deposit / Withdraw now: settleAgent refuses its direct parent and the admin', async () => {
    const chips = /^Error: Credit now moves as chips: use Deposit \/ Withdraw$/
    await assert.rejects(m.settleAgent(null, { input: { agentId: CRC, ...period } }, asAgent(CR)), chips)
    await assert.rejects(m.settleAgent(null, { input: { agentId: CR, ...period } }, asAdmin()), chips)
  })
  it('postSettlement refuses the agent posting its own settlement', async () => {
    await assert.rejects(m.postSettlement(null, { settlementId: 's1' }, asAgent(CR)), /cannot post a settlement for itself/)
  })
})

describe('createAgent: credit reference and opening chips (spec 2026-11-02 §4.4)', () => {
  const credit = (over: Record<string, unknown> = {}) => ({ schemeType: 'CREDIT', allowedDomains: ['sports'], username: 'credit_sub_new', password: 'secret123', currency: 'INR', ...over })

  it('refuses opening chips on a non-CREDIT agent, and negative or non-numeric figures', async () => {
    const sharing = { schemeType: 'SHARING', allowedDomains: ['sports'], username: 'sharing_sub_x', password: 'secret123', currency: 'INR' }
    await assert.rejects(m.createAgent(null, { input: { ...sharing, openingChips: 10 } }, asAdmin()), /Opening chips can only be given to CREDIT agents/)
    await assert.rejects(m.createAgent(null, { input: credit({ openingChips: -1 }) }, asAgent(CR)), /Opening chips cannot be negative/)
    await assert.rejects(m.createAgent(null, { input: credit({ openingChips: 'lots' }) }, asAgent(CR)), /Opening chips must be a number/)
    await assert.rejects(m.createAgent(null, { input: credit({ creditLimit: -5 }) }, asAgent(CR)), /Credit reference cannot be negative/)
  })

  it('sets the credit reference on the insert and deposits the opening chips from the parent on the creation transaction', async () => {
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
    const { ChipService } = await import('@src/domains/agents/services/ChipService.js')
    const { db } = await import('@src/db/client.js')
    let created: any = null
    const deposits: any[] = []
    stub((db as any).query.appConfigs, 'findFirst', async () => null)
    stub(AgentsRepo.prototype, 'createAgent', async (input: any) => {
      created = input
      return { id: '00000000-0000-4000-8000-000000000777', tenantId: T, schemeType: 'CREDIT', parentAgentId: input.parentAgentId }
    })
    stub(ChipService.prototype, 'depositOpeningChips', async (input: any, tx: unknown) => {
      deposits.push({ input, tx })
      return { transferId: 't-1' }
    })
    // The new agent as the creation transaction sees it: CR's own direct sub-agent, so CR may give it opening chips.
    const { ChipRepo } = await import('@src/repos/agents/ChipRepo.js')
    const placeReads: unknown[] = []
    stub(ChipRepo.prototype, 'readAgent', async (tx: unknown, agentId: string) => {
      placeReads.push(tx)
      return { id: agentId, tenantId: T, schemeType: 'CREDIT', status: 'ACTIVE', parentAgentId: CR, chipBalance: 0, creditLimit: 0, username: 'credit_sub_new' }
    })

    await m.createAgent(null, { input: credit({ creditLimit: 5000, openingChips: 1000.005 }) }, asAgent(CR))
    assert.equal(created.creditLimit, 5000)
    assert.equal(created.parentAgentId, CR)
    assert.equal(typeof created.afterInsert, 'function', 'the opening deposit runs inside the creation transaction')

    const tx = { rollback() {} }
    await created.afterInsert(tx, { id: '00000000-0000-4000-8000-000000000777' })
    assert.deepEqual(placeReads, [tx], "the new agent's parent is read on the creation transaction")
    assert.equal(deposits.length, 1)
    assert.equal(deposits[0].tx, tx)
    assert.deepEqual(deposits[0].input, {
      tenant: T,
      accountType: 'AGENT',
      accountId: '00000000-0000-4000-8000-000000000777',
      amount: 1000.01,
      actor: { createdBy: CR, createdByType: 'agent' },
      remark: 'Opening chips',
    })

    await m.createAgent(null, { input: credit({ username: 'credit_sub_zero', creditLimit: 0 }) }, asAgent(CR))
    assert.equal(created.afterInsert, undefined, 'no opening chips, no deposit')
    assert.equal(created.creditLimit, 0)
  })

  it("names the opening chips in a refusal from the parent's side", async () => {
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
    const { ChipService, ChipError } = await import('@src/domains/agents/services/ChipService.js')
    const { db } = await import('@src/db/client.js')
    let created: any = null
    stub((db as any).query.appConfigs, 'findFirst', async () => null)
    stub(AgentsRepo.prototype, 'createAgent', async (input: any) => {
      created = input
      return { id: '00000000-0000-4000-8000-000000000778' }
    })
    stub(ChipService.prototype, 'depositOpeningChips', async () => {
      throw new ChipError('INSUFFICIENT', 'Not enough chips: available 10.00')
    })
    const { ChipRepo } = await import('@src/repos/agents/ChipRepo.js')
    stub(ChipRepo.prototype, 'readAgent', async (_tx: unknown, agentId: string) =>
      ({ id: agentId, tenantId: T, schemeType: 'CREDIT', status: 'ACTIVE', parentAgentId: CR, chipBalance: 0, creditLimit: 0, username: 'credit_sub_poor' }))
    await m.createAgent(null, { input: credit({ username: 'credit_sub_poor', openingChips: 50 }) }, asAgent(CR))
    await assert.rejects(created.afterInsert({ rollback() {} }, { id: '00000000-0000-4000-8000-000000000778' }), (err: any) => {
      assert.ok(err instanceof ChipError)
      assert.equal(err.code, 'INSUFFICIENT')
      assert.equal(err.message, 'Opening chips: Not enough chips: available 10.00')
      return true
    })
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
    // AGE-09: the narrowing that takes an agent's last tally domain turns its tally off (it pays as off anyway).
    assert.match(
      flat,
      /tally_enabled = CASE WHEN tally_enabled AND COALESCE\(tally_domains && ARRAY\[\$\d+::text, \$\d+::text\]::text\[\], false\) AND NOT COALESCE\(array_remove\(array_remove\(tally_domains, \$\d+::text\), \$\d+::text\) && ARRAY\['sports', 'casino', 'matka'\]::text\[\], false\) THEN false ELSE tally_enabled END/
    )
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
    // No user in the context; the context also says why (authRejected) once buildAuthContext reports it.
    ancestorStatuses = { [C]: ['SUSPENDED'] }
    assert.equal((await buildAuthContext(req(), T)).user, undefined)
    ancestorStatuses = { [C]: ['BLOCKED'] }
    assert.equal((await buildAuthContext(req(), T)).user, undefined)
  })
  it('makes the agent read-only under an INACTIVE ancestor', async () => {
    ancestorStatuses = { [C]: ['INACTIVE'] }
    const auth = await buildAuthContext(req(), T)
    assert.equal(auth.user?.isReadOnly, true)
    ancestorStatuses = {}
  })
})

describe('setAgentCredentials: the rules of the other password paths (AGE-05)', () => {
  const sets: Array<{ agentId: string; username: string }> = []
  const bumps: string[] = []
  let adminHash = ''
  before(async () => {
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
    const { hashPassword } = await import('@src/domains/common/auth.js')
    const hashes: Record<string, string> = { [P]: await hashPassword('parent-pass'), [C]: await hashPassword('child-pass') }
    adminHash = await hashPassword('admin-pass')
    stub(AgentsRepo.prototype, 'getPasswordHash', async (x: string) => hashes[x] ?? null)
    stub(AgentsRepo.prototype, 'setCredentials', async (agentId: string, username: string) => {
      sets.push({ agentId, username })
    })
    stub(AgentsRepo.prototype, 'incrementTokenVersion', async (agentId: string) => {
      bumps.push(agentId)
    })
  })
  const set = (agentId: string, over: Record<string, unknown>, ctx: any) =>
    m.setAgentCredentials(null, { input: { agentId, username: agents[agentId].username, ...over } }, ctx)
  const reset = () => {
    sets.length = 0
    bumps.length = 0
    audits.length = 0
  }

  it('refuses an empty, short or blank password before anything is written', async () => {
    reset()
    await assert.rejects(set(C, { password: '', currentPassword: 'parent-pass' }, asAgent(P)), /at least 6 characters/)
    await assert.rejects(set(C, { password: 'x', currentPassword: 'parent-pass' }, asAgent(P)), /at least 6 characters/)
    await assert.rejects(set(C, { password: '        ', currentPassword: 'parent-pass' }, asAgent(P)), /cannot be blank/)
    assert.deepEqual([sets.length, bumps.length, audits.length], [0, 0, 0])
  })

  it('an agent changing its own credentials must give its current password', async () => {
    reset()
    await assert.rejects(set(C, { password: 'new-secret' }, asAgent(C)), /current password is required/)
    await assert.rejects(set(C, { password: 'new-secret', currentPassword: 'guess-again' }, asAgent(C)), /Current password is incorrect/)
    assert.equal(sets.length, 0, 'a stolen token alone cannot re-key the account')
    assert.equal(await set(C, { password: 'new-secret', currentPassword: 'child-pass' }, asAgent(C)), true)
    assert.deepEqual(sets, [{ agentId: C, username: agents[C].username }])
    assert.deepEqual(bumps, [C], 'every older session of the agent ends')
    assert.equal(audits.find((a) => a.action === 'set_agent_credentials')?.after?.setBy, 'self')
  })

  it("a parent confirms with its own password (not the sub-agent's), ends the sub-agent's sessions and is audited", async () => {
    reset()
    await assert.rejects(set(C, { password: 'new-secret', currentPassword: 'child-pass' }, asAgent(P)), /Current password is incorrect/)
    assert.equal(await set(C, { password: 'new-secret', currentPassword: 'parent-pass' }, asAgent(P)), true)
    assert.deepEqual(bumps, [C])
    const row = audits.find((a) => a.action === 'set_agent_credentials')
    assert.ok(row, 'the change is in the audit log')
    assert.equal(row.actorId, P)
    assert.equal(row.resourceId, C)
    assert.equal(row.domain, 'agents.security')
    assert.equal(row.after.setBy, 'agent')
    assert.equal(row.after.passwordChanged, true)
    assert.equal(/new-secret|parent-pass|\$2[aby]\$/.test(JSON.stringify(row)), false, 'no password or hash in the audit row')
  })

  it('cannot reach its parent or a sibling', async () => {
    reset()
    await assert.rejects(set(P, { password: 'new-secret', currentPassword: 'child-pass' }, asAgent(C)), /Agent not found/)
    assert.equal(sets.length, 0)
  })

  it("an admin confirms with its own password and is recorded under its user id, not 'system'", async () => {
    reset()
    const { db } = await import('@src/db/client.js')
    const select = (db as any).select
    // getUserPasswordHashDb's read of the admin's hash.
    ;(db as any).select = () => ({ from: () => ({ where: async () => [{ passwordHash: adminHash }] }) })
    try {
      await assert.rejects(set(C, { password: 'new-secret', currentPassword: 'wrong-pass' }, asAdmin()), /Current password is incorrect/)
      assert.equal(await set(C, { password: 'new-secret', currentPassword: 'admin-pass' }, asAdmin()), true)
    } finally {
      ;(db as any).select = select
    }
    assert.deepEqual(bumps, [C])
    const row = audits.find((a) => a.action === 'set_agent_credentials')
    assert.equal(row?.actorId, '1')
    assert.equal(row?.after?.setBy, 'admin')
  })
})

describe('agent audit rows name the real actor (AGE-03, AGE-04)', () => {
  const NEW = '00000000-0000-4000-8000-000000000999'
  let updateAgent: any
  before(async () => {
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
    const { db } = await import('@src/db/client.js')
    stub((db as any).query.appConfigs, 'findFirst', async () => null)
    stub(AgentsRepo.prototype, 'createAgent', async (input: any) => ({
      id: NEW,
      tenantId: T,
      schemeType: input.schemeType,
      status: input.status,
      parentAgentId: input.parentAgentId,
      levelIndex: input.levelIndex,
      allowedDomains: input.allowedDomains,
      tallyEnabled: input.tallyEnabled,
      tallyDomains: input.tallyDomains,
    }))
    stub(AgentsRepo.prototype, 'incrementTokenVersion', async () => {})
    updateAgent = AgentsRepo.prototype.updateAgent
    AgentsRepo.prototype.updateAgent = async (input: any) => ({ ...agents[input.id], ...input })
  })
  after(async () => {
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
    AgentsRepo.prototype.updateAgent = updateAgent
  })

  it('createAgent records create_agent under the creating agent, with the status it chose and no password', async () => {
    audits.length = 0
    const input = { schemeType: 'SHARING', allowedDomains: ['sports'], username: 'sub_audited', password: 'secret123', currency: 'INR', status: 'INACTIVE' }
    await m.createAgent(null, { input }, asAgent(P))
    const row = audits.find((a) => a.action === 'create_agent')
    assert.ok(row, 'the creation is audited')
    assert.equal(row.actorId, P)
    assert.equal(row.resourceType, 'agent')
    assert.equal(row.resourceId, NEW)
    assert.equal(row.before, null, 'a creation row has no before, so the status guard counts it as a status change')
    assert.equal(row.after.status, 'INACTIVE')
    assert.equal(row.after.parentAgentId, P)
    assert.equal(row.after.username, 'sub_audited')
    assert.equal(/secret123|passwordHash/.test(JSON.stringify(row)), false)
  })

  it("an admin's creation and status changes carry the admin's user id, not 'system'", async () => {
    audits.length = 0
    const input = { schemeType: 'SHARING', allowedDomains: ['sports'], username: 'root_audited', password: 'secret123', currency: 'INR' }
    await m.createAgent(null, { input }, asAdmin())
    await m.updateAgentStatus(null, { agentId: C, status: 'SUSPENDED' }, asAdmin())
    await m.updateAgent(null, { input: { id: C, allowedDomains: ['sports'] } }, asAdmin())
    const actors = Object.fromEntries(audits.map((a) => [a.action, a.actorId]))
    assert.deepEqual(actors, { create_agent: '1', update_agent_status: '1', update_agent: '1' })
  })

  it('an agent acting on its sub-agent is recorded under its own id', async () => {
    audits.length = 0
    await m.updateAgentStatus(null, { agentId: C, status: 'SUSPENDED' }, asAgent(P))
    assert.equal(audits.find((a) => a.action === 'update_agent_status')?.actorId, P)
  })
})

describe('a tally needs a domain (AGE-09)', () => {
  let createInput: any = null
  let updateInput: any = null
  let saved: Record<string, any> = {}
  before(async () => {
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
    const { db } = await import('@src/db/client.js')
    stub((db as any).query.appConfigs, 'findFirst', async () => null)
    stub(AgentsRepo.prototype, 'createAgent', async (input: any) => {
      createInput = input
      return { id: '00000000-0000-4000-8000-000000000998', tenantId: T, ...input }
    })
    saved = {
      updateAgent: AgentsRepo.prototype.updateAgent,
      narrowSubtreeDomains: AgentsRepo.prototype.narrowSubtreeDomains,
      transaction: (db as any).transaction,
    }
    AgentsRepo.prototype.updateAgent = async (input: any) => {
      updateInput = input
      return { ...agents[input.id], ...input }
    }
    AgentsRepo.prototype.narrowSubtreeDomains = async () => 0
    ;(db as any).transaction = async (fn: (tx: unknown) => unknown) => fn({})
  })
  after(async () => {
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
    const { db } = await import('@src/db/client.js')
    AgentsRepo.prototype.updateAgent = saved.updateAgent
    AgentsRepo.prototype.narrowSubtreeDomains = saved.narrowSubtreeDomains
    ;(db as any).transaction = saved.transaction
  })

  it('createAgent stores a COMMISSION tally with no domain as off, and keeps one with a domain on', async () => {
    const input = (over: Record<string, unknown>) => ({ schemeType: 'COMMISSION', allowedDomains: ['sports', 'casino'], username: 'tally_new', password: 'secret123', currency: 'INR', ...over })
    await m.createAgent(null, { input: input({ tallyEnabled: true, tallyDomains: [] }) }, asAdmin())
    assert.equal(createInput.tallyEnabled, false, 'on with no domain is paid as off, so it is stored as off')
    await m.createAgent(null, { input: input({ tallyEnabled: true, tallyDomains: ['sports', 'casino'] }) }, asAdmin())
    assert.equal(createInput.tallyEnabled, true)
    assert.deepEqual(createInput.tallyDomains, ['sports', 'casino'])
  })

  it('updateAgent stores an emptied tally as off, including when a narrowing removes its last domain', async () => {
    await m.updateAgent(null, { input: { id: K, tallyEnabled: true, tallyDomains: [] } }, asAdmin())
    assert.equal(updateInput.tallyEnabled, false)
    await m.updateAgent(null, { input: { id: K, tallyEnabled: true, tallyDomains: ['sports'] } }, asAdmin())
    assert.equal(updateInput.tallyEnabled, true)
    await m.updateAgent(null, { input: { id: P, allowedDomains: ['sports'], tallyEnabled: true, tallyDomains: ['casino'] } }, asAdmin())
    assert.equal(updateInput.tallyEnabled, false, 'casino is narrowed away, so nothing is left to tally')
  })

  it('an agent saving its sub-agent leaves the tally alone (it may not change it)', async () => {
    updateInput = null
    await m.updateAgent(null, { input: { id: C, allowedDomains: ['sports'], status: 'ACTIVE' } }, asAgent(P))
    assert.equal('tallyEnabled' in updateInput, false)
  })
})

describe('re-saving the rate in force adds no row (AGE-18)', () => {
  it('setSharingConfig returns the row in force instead of inserting the same rate again', async () => {
    const { AgentConfigsRepo } = await import('@src/repos/agents/AgentConfigsRepo.js')
    rates = {
      ['sharing:' + P + ':sports']: [{ effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null, rate: 0.3 }],
      ['sharing:' + C + ':sports']: [{ effectiveFrom: new Date('2026-10-21T00:00:00+05:30'), effectiveTo: null, rate: 0.1 }],
    }
    const inForce = { id: 'cfg-in-force', agentId: C, domain: 'sports', shareRate: '0.1', effectiveFrom: new Date('2026-10-21T00:00:00+05:30'), effectiveTo: null }
    stub(AgentConfigsRepo.prototype, 'getSharingConfig', async () => inForce)
    captured.length = 0
    const out = await m.setSharingConfig(null, { input: { agentId: C, domain: 'sports', shareRate: 0.1, effectiveFrom: '2026-11-02T19:13:23Z' } }, asAdmin())
    assert.equal(out, inForce)
    assert.equal(captured.length, 0, 'no second open row with the same rate')
    await m.setSharingConfig(null, { input: { agentId: C, domain: 'sports', shareRate: 0.12, effectiveFrom: '2026-11-02T19:13:23Z' } }, asAdmin())
    assert.equal(captured.length, 1, 'a changed rate is still inserted')
  })

  it('setCommissionConfig likewise', async () => {
    const { AgentConfigsRepo } = await import('@src/repos/agents/AgentConfigsRepo.js')
    rates = {
      ['commission:' + K5 + ':sports']: [{ effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null, rate: 0.05 }],
      ['commission:' + K + ':sports']: [{ effectiveFrom: new Date('2026-10-19T00:00:00+05:30'), effectiveTo: null, rate: 0.02 }],
    }
    const inForce = { id: 'cfg-commission', agentId: K, domain: 'sports', commissionRate: '0.02', effectiveFrom: new Date('2026-10-19T00:00:00+05:30'), effectiveTo: null }
    stub(AgentConfigsRepo.prototype, 'getCommissionConfig', async () => inForce)
    captured.length = 0
    assert.equal(await m.setCommissionConfig(null, { input: { agentId: K, domain: 'sports', commissionRate: 2, effectiveFrom: '2026-11-02T19:13:23Z' } }, asAdmin()), inForce)
    assert.equal(captured.length, 0)
  })
})
