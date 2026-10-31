/**
 * cancelCommissionAdjustment (agent features 2026-10-22, section 2; owner
 * decision 3: admins create, apply and cancel; agents only view).
 *
 * - The rules run through cancelPendingAdjustment with an in-memory repo and
 *   audit writer: PENDING only, same tenant, the race with apply, the audit row.
 * - The resolver runs with the repo prototype stubbed; every case stops before
 *   a write. No database row is read or written.
 * - The SDL shape is checked by building the schema.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/settlements/__tests__/commissionAdjustmentCancel.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema } from 'graphql'
import { CommissionAdjustmentsRepo, type CommissionAdjustmentRow } from '../../../repos/settlements/CommissionAdjustmentsRepo.js'
import { deriveAgentPermissions } from '../../agents/services/AgentPermissionsService.js'
import { settlementsMutationResolvers } from '../resolvers/mutations.js'
import { typeDefs } from '../../../types/graphql.js'
import { CANCEL_REASON_MAX, cancelPendingAdjustment, type CancelAdjustmentDeps } from '../services/commissionAdjustmentCancel.js'

const T = 't1'
const CA = '55555555-5555-4555-8555-555555555555'
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function adjustment(status: string): CommissionAdjustmentRow {
  return {
    id: ID, tenantId: T, agentId: CA, amount: -25.5,
    sourceCycleFrom: new Date('2026-10-11T18:30:00.000Z'), sourceCycleTo: new Date('2026-10-18T18:30:00.000Z'),
    targetCycleFrom: null, targetCycleTo: null, reason: 'Void', refMeta: null, status,
    createdAt: new Date('2026-10-20T10:00:00.000Z'), appliedAt: null,
  }
}

function fakeDeps(row: CommissionAdjustmentRow | null, cancelled: CommissionAdjustmentRow | null) {
  const calls = { getById: [] as unknown[][], cancel: [] as unknown[][], audit: [] as any[] }
  const deps: CancelAdjustmentDeps = {
    repo: {
      getById: async (id, tenantId) => {
        calls.getById.push([id, tenantId])
        return row
      },
      cancel: async (id, tenantId) => {
        calls.cancel.push([id, tenantId])
        return cancelled
      },
    },
    audit: async (entry) => {
      calls.audit.push(entry)
    },
  }
  return { deps, calls }
}
const scope = { tenant: T, actorId: '7' }

describe('cancelPendingAdjustment', () => {
  it('cancels a PENDING adjustment of the tenant and writes the audit row', async () => {
    const { deps, calls } = fakeDeps(adjustment('PENDING'), adjustment('CANCELLED'))
    const out = await cancelPendingAdjustment({ adjustmentId: ID, reason: '  Raised twice  ' }, scope, deps)
    assert.equal(out.success, true)
    assert.equal(out.message, 'Adjustment cancelled')
    assert.equal(out.adjustment?.status, 'CANCELLED')
    assert.equal(out.adjustment?.sourceCycleFrom, '2026-10-11T18:30:00.000Z')
    assert.equal(out.adjustment?.targetCycleFrom, null)
    assert.deepEqual(calls.getById, [[ID, T]])
    assert.deepEqual(calls.cancel, [[ID, T]])
    assert.deepEqual(calls.audit, [{
      tenant: T,
      actorId: '7',
      domain: 'settlements',
      action: 'commission_adjustment_cancel',
      resourceType: 'commission_adjustment',
      resourceId: ID,
      before: { status: 'PENDING', agentId: CA, amount: -25.5, sourceCycleFrom: '2026-10-11T18:30:00.000Z', sourceCycleTo: '2026-10-18T18:30:00.000Z', reason: 'Void' },
      after: { status: 'CANCELLED', cancelReason: 'Raised twice' },
    }])
  })

  for (const status of ['APPLIED', 'CANCELLED']) {
    it(`refuses a ${status} adjustment without writing`, async () => {
      const { deps, calls } = fakeDeps(adjustment(status), adjustment('CANCELLED'))
      const out = await cancelPendingAdjustment({ adjustmentId: ID }, scope, deps)
      assert.deepEqual(out, { success: false, message: `Only a PENDING adjustment can be cancelled (this one is ${status})`, adjustment: null })
      assert.equal(calls.cancel.length, 0)
      assert.equal(calls.audit.length, 0)
    })
  }

  it("another tenant's adjustment reads as not found", async () => {
    const { deps, calls } = fakeDeps(null, null)
    const out = await cancelPendingAdjustment({ adjustmentId: ID }, { tenant: 't2', actorId: '7' }, deps)
    assert.deepEqual(out, { success: false, message: 'Adjustment not found', adjustment: null })
    assert.deepEqual(calls.getById, [[ID, 't2']])
    assert.equal(calls.cancel.length, 0)
  })

  it('an apply that won the race leaves the row alone and is reported', async () => {
    const { deps, calls } = fakeDeps(adjustment('PENDING'), null)
    const out = await cancelPendingAdjustment({ adjustmentId: ID }, scope, deps)
    assert.deepEqual(out, { success: false, message: 'Adjustment is no longer PENDING; reload and try again', adjustment: null })
    assert.equal(calls.audit.length, 0)
  })

  it('a missing id is refused before any read', async () => {
    const { deps, calls } = fakeDeps(adjustment('PENDING'), adjustment('CANCELLED'))
    for (const adjustmentId of [undefined, null, '', '   ']) {
      const out = await cancelPendingAdjustment({ adjustmentId }, scope, deps)
      assert.deepEqual(out, { success: false, message: 'Missing adjustmentId', adjustment: null })
    }
    assert.equal(calls.getById.length, 0)
  })

  it('the reason is optional, trimmed and capped', async () => {
    const blank = fakeDeps(adjustment('PENDING'), adjustment('CANCELLED'))
    await cancelPendingAdjustment({ adjustmentId: ID, reason: '   ' }, scope, blank.deps)
    assert.equal(blank.calls.audit[0].after.cancelReason, null)
    const long = fakeDeps(adjustment('PENDING'), adjustment('CANCELLED'))
    await cancelPendingAdjustment({ adjustmentId: ID, reason: 'x'.repeat(CANCEL_REASON_MAX + 50) }, scope, long.deps)
    assert.equal(long.calls.audit[0].after.cancelReason.length, CANCEL_REASON_MAX)
  })

  it('a failed audit write does not undo the cancel', async () => {
    const { deps } = fakeDeps(adjustment('PENDING'), adjustment('CANCELLED'))
    deps.audit = async () => {
      throw new Error('audit down')
    }
    const out = await cancelPendingAdjustment({ adjustmentId: ID }, scope, deps)
    assert.equal(out.success, true)
  })
})

function agentCtx(agentId: string) {
  return { user: { sub: agentId, type: 'agent', agentId, roles: [] }, tenant: T, whitelabel: { id: T }, permissions: deriveAgentPermissions(['sports']) }
}
function adminCtx(permissions: { domain: string; actions: string[] }[]) {
  return { user: { sub: '7', roles: ['Whitelabel Admin'] }, tenant: T, whitelabel: { id: T }, permissions }
}
const anonymousCtx = { tenant: T, whitelabel: { id: T } }
const FINANCE_WRITE = [{ domain: 'finance', actions: ['write'] }]

const originals: Record<string, any> = {}
let stored: CommissionAdjustmentRow | null = null
let lookups: unknown[][] = []

before(() => {
  originals.getById = CommissionAdjustmentsRepo.prototype.getById
  originals.cancel = CommissionAdjustmentsRepo.prototype.cancel
  ;(CommissionAdjustmentsRepo.prototype as any).getById = async (...args: unknown[]) => {
    lookups.push(args)
    return stored
  }
  ;(CommissionAdjustmentsRepo.prototype as any).cancel = async () => {
    throw new Error('this write must not be reached')
  }
})

after(() => {
  CommissionAdjustmentsRepo.prototype.getById = originals.getById
  CommissionAdjustmentsRepo.prototype.cancel = originals.cancel
})

beforeEach(() => {
  stored = null
  lookups = []
})

const cancel = (ctx: any, args: Record<string, unknown> = { adjustmentId: ID }) =>
  (settlementsMutationResolvers as any).cancelCommissionAdjustment(null, args, ctx)

describe('cancelCommissionAdjustment resolver', () => {
  it('anonymous callers, agents and admins without settlements.commission:create are refused before any read', async () => {
    stored = adjustment('PENDING')
    await assert.rejects(cancel(anonymousCtx), /Unauthorized/)
    await assert.rejects(cancel(agentCtx(CA)), /Forbidden/)
    await assert.rejects(cancel(adminCtx([])), /Forbidden/)
    assert.deepEqual(lookups, [])
  })

  it("an admin's lookup is bound to its own tenant", async () => {
    stored = null
    const out = await cancel(adminCtx(FINANCE_WRITE))
    assert.deepEqual(out, { success: false, message: 'Adjustment not found', adjustment: null })
    assert.deepEqual(lookups, [[ID, T]])
  })

  it('an APPLIED adjustment is refused without a write', async () => {
    stored = adjustment('APPLIED')
    const out = await cancel(adminCtx(FINANCE_WRITE), { adjustmentId: ID, reason: 'wrong week' })
    assert.deepEqual(out, { success: false, message: 'Only a PENDING adjustment can be cancelled (this one is APPLIED)', adjustment: null })
  })
})

describe('schema', () => {
  it('declares cancelCommissionAdjustment(adjustmentId: ID!, reason: String): CancelCommissionAdjustmentPayload!', () => {
    const schema = buildSchema(typeDefs)
    const field = schema.getMutationType()!.getFields().cancelCommissionAdjustment
    assert.ok(field, 'the mutation exists')
    assert.equal(String(field.type), 'CancelCommissionAdjustmentPayload!')
    assert.deepEqual(field.args.map((arg) => [arg.name, String(arg.type)]), [['adjustmentId', 'ID!'], ['reason', 'String']])
  })
})
