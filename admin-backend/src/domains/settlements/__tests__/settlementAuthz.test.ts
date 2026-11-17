/**
 * Who may settle, pay and read in the settlement domain (agent-schemes
 * hardening, W3). Repository methods are stubbed on their prototypes, so no
 * test here reads or writes the database: every case is decided before the
 * resolver reaches a query, and a stub that must not be reached throws.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/settlements/__tests__/settlementAuthz.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AgentsRepo } from '../../../repos/agents/AgentsRepo.js'
import { CommissionPayoutsRepo } from '../../../repos/settlements/CommissionPayoutsRepo.js'
import { CommissionCycleService } from '../../agents/services/CommissionCycleService.js'
import { deriveAgentPermissions } from '../../agents/services/AgentPermissionsService.js'
import {
  settlementsMutationResolvers,
  agentMaySettle,
  requireSettleAgentPermission,
} from '../resolvers/mutations.js'
import { settlementsQueryResolvers, requireSettlementRead } from '../resolvers/queries.js'
import { CREDIT_MOVES_AS_CHIPS } from '../schemeIsolation.js'

const T = 't1'
// Credit hierarchy: P → C → G, plus an unrelated root O. CREDIT moves chips by Deposit / Withdraw since
// 2026-11-02, so settling any of them is refused once the caller is past every gate.
const P = '11111111-1111-4111-8111-111111111111'
const C = '22222222-2222-4222-8222-222222222222'
const G = '33333333-3333-4333-8333-333333333333'
const O = '44444444-4444-4444-8444-444444444444'
// Commission hierarchy: CP → CC → CG, and CC's sibling CS.
const CP = '55555555-5555-4555-8555-555555555555'
const CC = '66666666-6666-4666-8666-666666666666'
const CG = '77777777-7777-4777-8777-777777777777'
const CS = '88888888-8888-4888-8888-888888888888'
// A commission agent in another whitelabel.
const XT = '99999999-9999-4999-8999-999999999999'

function agentRow(id: string, schemeType: 'CREDIT' | 'SHARING' | 'COMMISSION', parentAgentId: string | null, tenantId = T) {
  return {
    id,
    tenantId,
    schemeType,
    status: 'ACTIVE',
    allowedDomains: ['sports'],
    phone: null,
    parentAgentId,
    levelIndex: null,
    tallyEnabled: false,
    tallyDomains: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    username: id.slice(0, 4),
    tokenVersion: 0,
  }
}

const AGENTS = new Map<string, any>([
  [P, agentRow(P, 'CREDIT', null)],
  [C, agentRow(C, 'CREDIT', P)],
  [G, agentRow(G, 'CREDIT', C)],
  [O, agentRow(O, 'CREDIT', null)],
  [CP, agentRow(CP, 'COMMISSION', null)],
  [CC, agentRow(CC, 'COMMISSION', CP)],
  [CG, agentRow(CG, 'COMMISSION', CC)],
  [CS, agentRow(CS, 'COMMISSION', CP)],
  [XT, agentRow(XT, 'COMMISSION', null, 't2')],
])
const SUBTREE: Record<string, string[]> = {
  [P]: [P, C, G],
  [C]: [C, G],
  [CP]: [CP, CC, CG, CS],
  [CC]: [CC, CG],
}

function agentCtx(agentId: string) {
  return {
    user: { sub: agentId, type: 'agent', agentId, roles: [] },
    tenant: T,
    whitelabel: { id: T },
    permissions: deriveAgentPermissions(['sports']),
  }
}
function adminCtx(permissions: { domain: string; actions: string[] }[]) {
  return { user: { sub: '7', roles: ['Whitelabel Admin'] }, tenant: T, whitelabel: { id: T }, permissions }
}
const anonymousCtx = { tenant: T, whitelabel: { id: T } }

const originals: Record<string, any> = {}
let creditFieldCalls: string[] = []
let payoutLookups = 0

before(() => {
  originals.findById = AgentsRepo.prototype.findById
  originals.getCreditFields = AgentsRepo.prototype.getCreditFields
  originals.getDescendantIds = AgentsRepo.prototype.getDescendantIds
  originals.listChildren = AgentsRepo.prototype.listChildren
  originals.getPayoutForCycle = CommissionPayoutsRepo.prototype.getPayoutForCycle
  originals.listCyclesForAgent = CommissionCycleService.prototype.listCyclesForAgent

  ;(AgentsRepo.prototype as any).findById = async (id: string) => AGENTS.get(id) ?? null
  ;(AgentsRepo.prototype as any).getCreditFields = async (id: string) => {
    // The retired CREDIT settlement balance: nothing may read it any more.
    creditFieldCalls.push(id)
    return {
      creditLimit: 1000, creditUsed: 0, creditAvailable: 1000, creditAlertThreshold: 80,
      settlementBalance: 0, settlementBalanceSports: 0, settlementBalanceCasino: 0, settlementBalanceMatka: 0,
    }
  }
  ;(AgentsRepo.prototype as any).getDescendantIds = async (id: string) => SUBTREE[id] ?? [id]
  ;(AgentsRepo.prototype as any).listChildren = async (id: string) =>
    [...AGENTS.values()].filter((a) => a.parentAgentId === id)
  ;(CommissionPayoutsRepo.prototype as any).getPayoutForCycle = async () => {
    payoutLookups++
    throw new Error('payout figures must not be read for this caller')
  }
  ;(CommissionCycleService.prototype as any).listCyclesForAgent = async () => [
    { from: new Date('2026-09-28T18:30:00Z'), to: new Date('2026-10-05T18:30:00Z'), status: 'PAID', paidAmount: 10 },
  ]
})

after(() => {
  AgentsRepo.prototype.findById = originals.findById
  AgentsRepo.prototype.getCreditFields = originals.getCreditFields
  AgentsRepo.prototype.getDescendantIds = originals.getDescendantIds
  AgentsRepo.prototype.listChildren = originals.listChildren
  CommissionPayoutsRepo.prototype.getPayoutForCycle = originals.getPayoutForCycle
  CommissionCycleService.prototype.listCyclesForAgent = originals.listCyclesForAgent
})

beforeEach(() => {
  creditFieldCalls = []
  payoutLookups = 0
})

const settle = (agentId: string, ctx: any) =>
  (settlementsMutationResolvers as any).settleAgent(
    null,
    { input: { agentId, settlementType: 'CREDIT', direction: 'TO_AGENT', amount: 0, notes: 'w3 settle test' } },
    ctx,
  )

describe('settleAgent: agents settle direct children only', () => {
  it('agentMaySettle: direct child yes; self, grandchild, stranger, no caller id: no', () => {
    assert.equal(agentMaySettle(P, AGENTS.get(C)), true)
    assert.equal(agentMaySettle(P, AGENTS.get(P)), false)
    assert.equal(agentMaySettle(P, AGENTS.get(G)), false)
    assert.equal(agentMaySettle(P, AGENTS.get(O)), false)
    assert.equal(agentMaySettle(undefined, AGENTS.get(C)), false)
  })

  it('an agent passes the permission gate on its derived permissions (was Forbidden for every agent)', () => {
    assert.doesNotThrow(() => requireSettleAgentPermission(agentCtx(P)))
  })

  it('an admin still needs settlements.agent:create — agents:manage alone does not settle', () => {
    assert.throws(
      () => requireSettleAgentPermission(adminCtx([{ domain: 'agents', actions: ['view', 'manage', 'read'] }])),
      /Forbidden/,
    )
    assert.doesNotThrow(() => requireSettleAgentPermission(adminCtx([{ domain: 'finance', actions: ['write'] }])))
    assert.throws(() => requireSettleAgentPermission(anonymousCtx), /Unauthorized/)
  })

  it('agent settles its direct child: passes every gate, then a CREDIT child is refused as chips', async () => {
    const result = await settle(C, agentCtx(P))
    assert.equal(result.success, false)
    assert.equal(result.message, CREDIT_MOVES_AS_CHIPS)
    assert.equal(result.settlement, null)
    assert.deepEqual(creditFieldCalls, [], 'the retired settlement balance is never read')
  })

  it('agent settling itself is refused before any balance is read', async () => {
    const result = await settle(P, agentCtx(P))
    assert.equal(result.success, false)
    assert.equal(result.message, 'You can only settle your direct sub-agents.')
    assert.deepEqual(creditFieldCalls, [])
  })

  it('agent settling a grandchild is refused before any balance is read', async () => {
    const result = await settle(G, agentCtx(P))
    assert.equal(result.success, false)
    assert.equal(result.message, 'You can only settle your direct sub-agents.')
    assert.deepEqual(creditFieldCalls, [])
  })

  it('agent settling an unrelated agent is refused', async () => {
    const result = await settle(O, agentCtx(P))
    assert.equal(result.message, 'You can only settle your direct sub-agents.')
    assert.deepEqual(creditFieldCalls, [])
  })

  it('bulkSettleAgents settles no CREDIT agent and reads no balance', async () => {
    const result = await (settlementsMutationResolvers as any).bulkSettleAgents(null, { agentIds: [P, C, G, O] }, agentCtx(P))
    assert.equal(result.settledCount, 0)
    assert.equal(result.failedCount, 4)
    assert.deepEqual(creditFieldCalls, [])
  })

  it('an admin with finance write gets past the gate, and a CREDIT agent is refused as chips', async () => {
    const result = await settle(G, adminCtx([{ domain: 'finance', actions: ['write'] }]))
    assert.equal(result.success, false)
    assert.equal(result.message, CREDIT_MOVES_AS_CHIPS)
    assert.deepEqual(creditFieldCalls, [])
  })
})

const pay = (agentId: string, ctx: any, withPeriod = true) =>
  (settlementsMutationResolvers as any).payCommission(
    null,
    {
      input: {
        agentId,
        amount: 123.45,
        notes: 'w3 pay test',
        ...(withPeriod ? { periodFrom: '2025-03-03T00:00:00+05:30', periodTo: '2025-03-10T00:00:00+05:30' } : {}),
      },
    },
    ctx,
  )

describe('payCommission: the direct-child check comes before any payout figure', () => {
  for (const [label, caller, target] of [
    ['a grandchild', CP, CG],
    ['its own parent', CC, CP],
    ['a sibling', CC, CS],
    ['itself', CC, CC],
  ] as const) {
    it(`an agent paying ${label} is refused without reading payouts`, async () => {
      const result = await pay(target, agentCtx(caller))
      assert.equal(result.success, false)
      assert.equal(result.message, 'You can only pay commission for your direct sub-agents.')
      assert.equal(result.payout, null)
      assert.equal(payoutLookups, 0)
    })
  }

  it('an agent paying its direct child gets past the check (stops at the missing period)', async () => {
    const result = await pay(CC, agentCtx(CP), false)
    assert.equal(result.success, false)
    assert.match(result.message, /Period required/)
  })

  it('an admin may not pay a sub-agent directly — its parent pays it — and no payout is read', async () => {
    const result = await pay(CC, adminCtx([{ domain: 'all', actions: ['*'] }]))
    assert.equal(result.success, false)
    assert.match(result.message, /sub-agent/)
    assert.equal(payoutLookups, 0)
  })

  it('an admin paying a top-level commission agent gets past the check', async () => {
    const result = await pay(CP, adminCtx([{ domain: 'all', actions: ['*'] }]), false)
    assert.match(result.message, /Period required/)
  })
})

describe("the credit-limit model's player credit operations are gone (spec 2026-11-02 §6)", () => {
  it('adjustPlayerCredit and playerCreditAdjustments are no longer in the settlement maps', () => {
    // A credit player's chips move only by Deposit / Withdraw from its direct parent (ChipService).
    assert.equal((settlementsMutationResolvers as any).adjustPlayerCredit, undefined)
    assert.equal((settlementsQueryResolvers as any).playerCreditAdjustments, undefined)
  })
})

describe('the settlement centre leaves CREDIT out', () => {
  it('a CREDIT agent gets empty pending lists, with no further read', async () => {
    const originalList = AgentsRepo.prototype.list
    ;(AgentsRepo.prototype as any).list = async (tenant: string) => [...AGENTS.values()].filter((a) => a.tenantId === tenant)
    try {
      const ctx = agentCtx(P)
      assert.deepEqual(await (settlementsQueryResolvers as any).pendingSettlements(null, {}, ctx), [])
      assert.deepEqual(await (settlementsQueryResolvers as any).enhancedPendingSettlements(null, {}, ctx), [])
      assert.deepEqual(await (settlementsQueryResolvers as any).subAgentsPendingSettlements(null, {}, ctx), [])
      assert.deepEqual(creditFieldCalls, [])
    } finally {
      AgentsRepo.prototype.list = originalList
    }
  })
})

describe('settlement reads need a session and the right permission', () => {
  const reads: Array<[string, any]> = [
    ['pendingSettlements', {}],
    ['enhancedPendingSettlements', {}],
    ['settlementDetails', { settlementId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    ['agentSettlementContributions', { agentId: C, periodFrom: '2026-01-01', periodTo: '2026-02-01' }],
    ['allSettlementHistory', {}],
  ]
  for (const [name, args] of reads) {
    it(`${name}: anonymous caller (whitelabel header only) is refused`, async () => {
      await assert.rejects((settlementsQueryResolvers as any)[name](null, args, anonymousCtx), /Unauthorized/)
    })
    it(`${name}: an admin without settlements.center:view is refused`, async () => {
      await assert.rejects((settlementsQueryResolvers as any)[name](null, args, adminCtx([])), /Forbidden/)
    })
  }

  it('requireSettlementRead: an agent passes on its derived permissions; a finance reader passes', () => {
    assert.doesNotThrow(() => requireSettlementRead(agentCtx(P)))
    assert.doesNotThrow(() => requireSettlementRead(adminCtx([{ domain: 'finance', actions: ['read'] }])))
  })

  it('allSettlementHistory still refuses an agent with its own message', async () => {
    await assert.rejects(
      (settlementsQueryResolvers as any).allSettlementHistory(null, {}, agentCtx(P)),
      /Agents cannot access all settlement history/,
    )
  })

  it('the other ungated reads now refuse an anonymous caller', async () => {
    for (const name of ['agentSettlementTransactions', 'commissionPayouts', 'commissionCycleReadiness', 'commissionCyclesForAgent']) {
      await assert.rejects(
        (settlementsQueryResolvers as any)[name](null, { agentId: CC, cycleFrom: '2025-03-03', cycleTo: '2025-03-10' }, anonymousCtx),
        /Unauthorized/,
        name,
      )
    }
  })
})

describe('commission reads: tenant and subtree', () => {
  const summaries = (ctx: any, agentId?: string) =>
    (settlementsQueryResolvers as any).subAgentCommissionSummaries(null, { agentId }, ctx)

  it('subAgentCommissionSummaries: anonymous with an agentId is refused', async () => {
    await assert.rejects(summaries(anonymousCtx, CP), /Unauthorized/)
  })

  it('subAgentCommissionSummaries: an admin without a commission read permission is refused', async () => {
    await assert.rejects(summaries(adminCtx([]), CP), /Forbidden/)
  })

  it("subAgentCommissionSummaries: another whitelabel's agent reads as empty", async () => {
    assert.deepEqual(await summaries(adminCtx([{ domain: 'agents', actions: ['view'] }]), XT), [])
  })

  const adjustments = (ctx: any, agentId: string) =>
    (settlementsQueryResolvers as any).commissionAdjustments(null, { agentId }, ctx)

  it('commissionAdjustments: an agent outside the target subtree gets nothing', async () => {
    assert.deepEqual(await adjustments(agentCtx(CC), CS), [])
    assert.deepEqual(await adjustments(agentCtx(CC), CP), [])
  })

  it('commissionAdjustments: anonymous and permissionless admins are refused', async () => {
    await assert.rejects(adjustments(anonymousCtx, CC), /Unauthorized/)
    await assert.rejects(adjustments(adminCtx([]), CC), /Forbidden/)
  })

  it('commissionCyclesForAgent: a grandparent reads a grandchild (View Bets at depth 2); a stranger does not', async () => {
    const forGrandchild = await (settlementsQueryResolvers as any).commissionCyclesForAgent(null, { agentId: CG }, agentCtx(CP))
    assert.equal(forGrandchild.length, 1)
    const forSibling = await (settlementsQueryResolvers as any).commissionCyclesForAgent(null, { agentId: CS }, agentCtx(CC))
    assert.deepEqual(forSibling, [])
  })
})

describe('commissionAdjustments passes the caller tenant to the repo', () => {
  it("an admin reads the agent's adjustments of its own tenant only", async () => {
    const { CommissionAdjustmentsRepo } = await import('../../../repos/settlements/CommissionAdjustmentsRepo.js')
    const original = CommissionAdjustmentsRepo.prototype.listByAgent
    const seen: unknown[][] = []
    ;(CommissionAdjustmentsRepo.prototype as any).listByAgent = async (...args: unknown[]) => {
      seen.push(args)
      return []
    }
    try {
      const rows = await (settlementsQueryResolvers as any).commissionAdjustments(
        null,
        { agentId: CC, limit: 20 },
        adminCtx([{ domain: 'finance', actions: ['read'] }]),
      )
      assert.deepEqual(rows, [])
      assert.deepEqual(seen, [[T, CC, 20, 0]])
    } finally {
      CommissionAdjustmentsRepo.prototype.listByAgent = original
    }
  })
})

describe('SCO-09: the settlement reads that needed only a session', () => {
  // Measured 2026-11-03 against the live roles before gating: every role that opens the agent profile holds
  // settlements.center:view, and grandwinn-com/Finance Manager opens the settlement centre (whose Pay dialog reads the
  // commission cycles) holding settlements.center:view and no commission read. Its grants, as the role carries them:
  const FINANCE_MANAGER = [
    { domain: 'credit.management', actions: ['view'] },
    { domain: 'payments.deposits', actions: ['view', 'approve', 'reject'] },
    { domain: 'settlements.center', actions: ['view'] },
  ]
  const JACKPOTS_ONLY = [{ domain: 'jackpots', actions: ['read'] }]
  const UNKNOWN = 'abababab-abab-4bab-8bab-abababababab'
  let txReads = 0
  const txOriginals: Record<string, any> = {}

  before(async () => {
    const { AgentSettlementTransactionsRepo } = await import('../../../repos/settlements/AgentSettlementTransactionsRepo.js')
    txOriginals.repo = AgentSettlementTransactionsRepo
    txOriginals.list = AgentSettlementTransactionsRepo.prototype.list
    txOriginals.summary = AgentSettlementTransactionsRepo.prototype.summary
    ;(AgentSettlementTransactionsRepo.prototype as any).list = async () => { txReads++; return [] }
    ;(AgentSettlementTransactionsRepo.prototype as any).summary = async () => ({ total: 0, totalPaid: 0, totalReceived: 0, net: 0 })
  })
  after(() => {
    txOriginals.repo.prototype.list = txOriginals.list
    txOriginals.repo.prototype.summary = txOriginals.summary
  })
  beforeEach(() => { txReads = 0 })

  const transactions = (ctx: any, args: Record<string, unknown> = {}) => (settlementsQueryResolvers as any).agentSettlementTransactions(null, args, ctx)
  const transactionsPage = (ctx: any) => (settlementsQueryResolvers as any).agentSettlementTransactionsPage(null, { limit: 5 }, ctx)
  const cycles = (ctx: any, agentId = CP) => (settlementsQueryResolvers as any).commissionCyclesForAgent(null, { agentId }, ctx)
  const readiness = (ctx: any, agentId = UNKNOWN) =>
    (settlementsQueryResolvers as any).commissionCycleReadiness(null, { agentId, cycleFrom: '2026-09-28', cycleTo: '2026-10-05' }, ctx)

  it('agentSettlementTransactions(Page): an admin needs settlements.center:view, and a refused one reads nothing', async () => {
    await assert.rejects(transactions(anonymousCtx), /Unauthorized/)
    await assert.rejects(transactions(adminCtx(JACKPOTS_ONLY)), /Forbidden: insufficient permissions to view settlements \(settlements\.center:view\)/)
    await assert.rejects(transactionsPage(adminCtx(JACKPOTS_ONLY)), /Forbidden/)
    // A commission read is not the settlement centre's read.
    await assert.rejects(transactions(adminCtx([{ domain: 'settlements.commission', actions: ['view'] }])), /Forbidden/)
    assert.equal(txReads, 0, 'the transactions were read for a refused caller')
  })

  it('agentSettlementTransactions(Page): the settlement centre readers still list them', async () => {
    for (const perms of [FINANCE_MANAGER, [{ domain: 'finance', actions: ['read'] }], [{ domain: 'all', actions: ['*'] }]]) {
      assert.deepEqual(await transactions(adminCtx(perms)), [])
    }
    const page = await transactionsPage(adminCtx(FINANCE_MANAGER))
    assert.deepEqual(page.items, [])
    assert.equal(txReads, 4)
  })

  it('agentSettlementTransactions: the agent branch is unchanged (its own rows; a commission agent is refused)', async () => {
    assert.deepEqual(await transactions(agentCtx(P)), [])
    assert.equal(txReads, 1)
    await assert.rejects(transactions(agentCtx(CP)), /Commission agents cannot access settlement transactions/)
    await assert.rejects(transactions(agentCtx(P), { agentId: O }), /Forbidden: cannot access this agent's settlement data/)
  })

  it('commissionCyclesForAgent: an admin needs a commission read or the settlement centre read', async () => {
    await assert.rejects(cycles(anonymousCtx), /Unauthorized/)
    await assert.rejects(cycles(adminCtx(JACKPOTS_ONLY)), /Forbidden: insufficient permissions to view commission/)
    await assert.rejects(cycles(adminCtx([])), /Forbidden/)
    for (const perms of [
      [{ domain: 'settlements.commission', actions: ['view'] }],
      [{ domain: 'agents.commission', actions: ['view'] }],
      FINANCE_MANAGER,
      [{ domain: 'finance', actions: ['read'] }],
      [{ domain: 'all', actions: ['*'] }],
    ]) {
      assert.equal((await cycles(adminCtx(perms))).length, 1, JSON.stringify(perms))
    }
  })

  it('commissionCyclesForAgent: an agent principal without an agent id is refused; an agent keeps its subtree', async () => {
    await assert.rejects(cycles({ ...agentCtx(CP), user: { sub: CP, type: 'agent', roles: [] } }), /Forbidden/)
    assert.equal((await cycles(agentCtx(CP), CC)).length, 1)
    assert.deepEqual(await cycles(agentCtx(CC), CS), [])
  })

  it('commissionCycleReadiness: an admin needs a commission read or the settlement centre read', async () => {
    await assert.rejects(readiness(anonymousCtx), /Unauthorized/)
    await assert.rejects(readiness(adminCtx(JACKPOTS_ONLY)), /Forbidden: insufficient permissions to view commission/)
    // Past the gate, an agent outside the tenant answers "not ready" before any figure is read.
    for (const perms of [[{ domain: 'agents.commission', actions: ['view'] }], FINANCE_MANAGER, [{ domain: 'all', actions: ['*'] }]]) {
      const out = await readiness(adminCtx(perms))
      assert.equal(out.ready, false)
      assert.equal(out.payableAmount, 0)
    }
    assert.equal((await readiness(adminCtx(FINANCE_MANAGER), XT)).ready, false)
  })

  it("commissionCycleReadiness: an agent is still held to itself and its direct children", async () => {
    const out = await readiness(agentCtx(CC), CP)
    assert.deepEqual(out.reasons, ['Unauthorized'])
  })
})
