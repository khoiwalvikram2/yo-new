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
import { db } from '../../../db/client.js'
import {
  settlementsMutationResolvers,
  agentMaySettle,
  requireSettleAgentPermission,
} from '../resolvers/mutations.js'
import { settlementsQueryResolvers, requireSettlementRead } from '../resolvers/queries.js'

const T = 't1'
// Credit hierarchy: P → C → G, plus an unrelated root O.
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
  originals.select = (db as any).select

  ;(AgentsRepo.prototype as any).findById = async (id: string) => AGENTS.get(id) ?? null
  ;(AgentsRepo.prototype as any).getCreditFields = async (id: string) => {
    creditFieldCalls.push(id)
    // A zero balance makes executeSettleAgent stop with "Cannot settle CREDIT
    // agent with zero …" — proof the caller got past every gate, with no write.
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
  ;(db as any).select = originals.select
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

  it('agent settles its direct child: passes every gate and reaches the balance read', async () => {
    const result = await settle(C, agentCtx(P))
    assert.equal(result.success, false)
    assert.match(result.message, /zero/i, `expected the zero-balance stop, got: ${result.message}`)
    assert.deepEqual(creditFieldCalls, [C])
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

  it('bulkSettleAgents holds an agent to the same rule: only the direct child reaches the balance read', async () => {
    const result = await (settlementsMutationResolvers as any).bulkSettleAgents(null, { agentIds: [P, C, G, O] }, agentCtx(P))
    assert.equal(result.settledCount, 0)
    assert.equal(result.failedCount, 4)
    assert.deepEqual(creditFieldCalls, [C])
  })

  it('an admin with finance write settles any agent of the tenant (gate unchanged)', async () => {
    const result = await settle(G, adminCtx([{ domain: 'finance', actions: ['write'] }]))
    assert.match(result.message, /zero/i)
    assert.deepEqual(creditFieldCalls, [G])
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

describe('adjustPlayerCredit: whitelabel credit players are admin-only', () => {
  it('an agent is refused for a WHITELABEL_CREDIT player', async () => {
    const wlPlayer = {
      id: 501, tenant: T, playerType: 'WHITELABEL_CREDIT', agentId: null, name: 'WL Player', username: 'wlp',
      creditLimit: '100', creditUsed: '0', settlementBalance: '0',
    }
    // The resolver's only read before the decision is the player lookup.
    ;(db as any).select = () => ({ from: () => ({ where: () => ({ limit: async () => [wlPlayer] }) }) })
    try {
      const result = await (settlementsMutationResolvers as any).adjustPlayerCredit(
        null,
        { input: { playerId: '501', adjustmentType: 'LIMIT_CHANGE', amount: 5000, notes: 'raise' } },
        agentCtx(P),
      )
      assert.equal(result.success, false)
      assert.match(result.message, /Only an admin/)
      assert.equal(result.adjustment, null)
    } finally {
      ;(db as any).select = originals.select
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
    for (const name of ['agentSettlementTransactions', 'commissionPayouts', 'playerCreditAdjustments', 'commissionCycleReadiness', 'commissionCyclesForAgent']) {
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
