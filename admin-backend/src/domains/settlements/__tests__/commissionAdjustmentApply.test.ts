/**
 * applyCommissionAdjustment applies a PENDING adjustment only (agent features
 * 2026-10-22, section 2). It used to refuse APPLIED alone, so a CANCELLED
 * adjustment could still be applied and counted in a payable.
 *
 * Repository methods are stubbed on their prototypes. Every case stops before
 * a write and before the audit row; nothing reads or writes the database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/settlements/__tests__/commissionAdjustmentApply.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AgentsRepo } from '../../../repos/agents/AgentsRepo.js'
import { CommissionPayoutsRepo } from '../../../repos/settlements/CommissionPayoutsRepo.js'
import { CommissionAdjustmentsRepo, type CommissionAdjustmentRow } from '../../../repos/settlements/CommissionAdjustmentsRepo.js'
import { deriveAgentPermissions } from '../../agents/services/AgentPermissionsService.js'
import { settlementsMutationResolvers } from '../resolvers/mutations.js'

const T = 't1'
const CA = '55555555-5555-4555-8555-555555555555'
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function adjustment(status: string): CommissionAdjustmentRow {
  return {
    id: ID, tenantId: T, agentId: CA, amount: -25.5,
    sourceCycleFrom: new Date('2026-10-04T18:30:00.000Z'), sourceCycleTo: new Date('2026-10-11T18:30:00.000Z'),
    targetCycleFrom: null, targetCycleTo: null, reason: 'Void', refMeta: null, status,
    createdAt: new Date('2026-10-12T10:00:00.000Z'), appliedAt: null,
  }
}
function agentCtx(agentId: string) {
  return { user: { sub: agentId, type: 'agent', agentId, roles: [] }, tenant: T, whitelabel: { id: T }, permissions: deriveAgentPermissions(['sports']) }
}
function adminCtx(permissions: { domain: string; actions: string[] }[]) {
  return { user: { sub: '7', roles: ['Whitelabel Admin'] }, tenant: T, whitelabel: { id: T }, permissions }
}
const FINANCE_WRITE = [{ domain: 'finance', actions: ['write'] }]

const originals: Record<string, any> = {}
let stored: CommissionAdjustmentRow | null = null
let applied: CommissionAdjustmentRow | null = null
let payoutLookup: 'refuse' | 'none' = 'refuse'
let lookups: unknown[][] = []
let applyCalls: unknown[][] = []

before(() => {
  originals.findById = AgentsRepo.prototype.findById
  originals.getById = CommissionAdjustmentsRepo.prototype.getById
  originals.apply = CommissionAdjustmentsRepo.prototype.apply
  originals.getPayoutForCycle = CommissionPayoutsRepo.prototype.getPayoutForCycle
  ;(AgentsRepo.prototype as any).findById = async (id: string) =>
    id === CA ? { id: CA, tenantId: T, schemeType: 'COMMISSION', status: 'ACTIVE', parentAgentId: null } : null
  ;(CommissionAdjustmentsRepo.prototype as any).getById = async (...args: unknown[]) => {
    lookups.push(args)
    return stored
  }
  ;(CommissionAdjustmentsRepo.prototype as any).apply = async (...args: unknown[]) => {
    applyCalls.push(args)
    return applied
  }
  ;(CommissionPayoutsRepo.prototype as any).getPayoutForCycle = async () => {
    if (payoutLookup === 'refuse') throw new Error('payouts must not be read for this adjustment')
    return null
  }
})

after(() => {
  AgentsRepo.prototype.findById = originals.findById
  CommissionAdjustmentsRepo.prototype.getById = originals.getById
  CommissionAdjustmentsRepo.prototype.apply = originals.apply
  CommissionPayoutsRepo.prototype.getPayoutForCycle = originals.getPayoutForCycle
})

beforeEach(() => {
  stored = null
  applied = null
  payoutLookup = 'refuse'
  lookups = []
  applyCalls = []
})

// Mon 12 Oct 2026 -> Mon 19 Oct 2026, IST.
const apply = (ctx: any) =>
  (settlementsMutationResolvers as any).applyCommissionAdjustment(
    null,
    { input: { adjustmentId: ID, targetCycleFrom: '2026-10-12', targetCycleTo: '2026-10-19' } },
    ctx,
  )

describe('applyCommissionAdjustment: PENDING only', () => {
  it('a CANCELLED adjustment is refused before any payout read or write', async () => {
    stored = adjustment('CANCELLED')
    const out = await apply(adminCtx(FINANCE_WRITE))
    assert.deepEqual(out, { success: false, message: 'Only a PENDING adjustment can be applied (this one is CANCELLED)', adjustment: null })
    assert.deepEqual(lookups, [[ID, T]])
    assert.deepEqual(applyCalls, [])
  })

  it('an APPLIED adjustment keeps its message', async () => {
    stored = adjustment('APPLIED')
    const out = await apply(adminCtx(FINANCE_WRITE))
    assert.deepEqual(out, { success: false, message: 'Adjustment already applied', adjustment: null })
    assert.deepEqual(applyCalls, [])
  })

  it('a PENDING adjustment cancelled between the read and the write is reported, not applied', async () => {
    stored = adjustment('PENDING')
    payoutLookup = 'none'
    applied = null
    const out = await apply(adminCtx(FINANCE_WRITE))
    assert.deepEqual(out, { success: false, message: 'Adjustment is no longer PENDING; reload and try again', adjustment: null })
    assert.equal(applyCalls.length, 1)
    assert.equal(applyCalls[0][0], ID)
    assert.equal(applyCalls[0][1], T)
    assert.equal((applyCalls[0][2] as { targetCycleFrom: Date }).targetCycleFrom.toISOString(), '2026-10-11T18:30:00.000Z')
  })

  it('agents and admins without settlements.commission:create are refused before any read', async () => {
    stored = adjustment('PENDING')
    await assert.rejects(apply(agentCtx(CA)), /Forbidden/)
    await assert.rejects(apply(adminCtx([])), /Forbidden/)
    assert.deepEqual(lookups, [])
  })
})
