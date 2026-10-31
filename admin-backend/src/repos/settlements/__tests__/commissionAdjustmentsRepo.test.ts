/**
 * CommissionAdjustmentsRepo status and tenant rules (agent features
 * 2026-10-22, section 2).
 *
 * - CANCELLED never counts: the payable sums read APPLIED rows only and
 *   readiness counts PENDING rows only.
 * - listByAgent is tenant-filtered.
 * - apply and cancel change a row only while it is PENDING (a conditional
 *   update), so an apply racing a cancel can never flip a final row.
 *
 * db.select / db.update are replaced by stubs that capture the WHERE
 * condition, which is rendered with PgDialect. Nothing reaches PostgreSQL.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/settlements/__tests__/commissionAdjustmentsRepo.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'
import { db } from '../../../db/client.js'
import { CommissionAdjustmentsRepo, COMMISSION_ADJUSTMENT_STATUS } from '../CommissionAdjustmentsRepo.js'

const dialect = new PgDialect()
const T = 't1'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
// IST week Mon 12 Oct 2026 -> Mon 19 Oct 2026, and the end of the week after it.
const FROM = new Date('2026-10-11T18:30:00.000Z')
const TO = new Date('2026-10-18T18:30:00.000Z')
const NEXT_TO = new Date('2026-10-25T18:30:00.000Z')

function dbRow(status: string) {
  return {
    id: ID, tenantId: T, agentId: A, amount: '-25.50', sourceCycleFrom: FROM, sourceCycleTo: TO,
    targetCycleFrom: null, targetCycleTo: null, reason: 'Void', refMeta: { note: 'dup' }, status,
    createdAt: new Date('2026-10-20T10:00:00.000Z'), appliedAt: null,
  }
}

let wheres: unknown[] = []
let sets: Record<string, unknown>[] = []
let selectRows: unknown[] = []
let updateRows: unknown[] = []
const originals: Record<string, unknown> = {}

before(() => {
  originals.select = (db as any).select
  originals.update = (db as any).update
  ;(db as any).select = () => ({
    from: () => ({
      where: (condition: unknown) => {
        wheres.push(condition)
        const rows = selectRows
        const result: any = Promise.resolve(rows)
        result.orderBy = () => ({ limit: async () => rows })
        result.limit = async () => rows
        return result
      },
    }),
  })
  ;(db as any).update = () => ({
    set: (values: Record<string, unknown>) => {
      sets.push(values)
      return {
        where: (condition: unknown) => {
          wheres.push(condition)
          return { returning: async () => updateRows }
        },
      }
    },
  })
})

after(() => {
  ;(db as any).select = originals.select
  ;(db as any).update = originals.update
})

beforeEach(() => {
  wheres = []
  sets = []
  selectRows = []
  updateRows = []
})

/** The one captured WHERE, as PostgreSQL would receive it. */
function onlyWhere(): { sql: string; params: unknown[] } {
  assert.equal(wheres.length, 1, 'exactly one statement')
  const q = dialect.sqlToQuery(wheres[0] as any)
  return { sql: q.sql.replace(/\s+/g, ' '), params: q.params }
}
const STATUS_EQ = /"commission_adjustments"\."status" = \$\d+/
const TENANT_EQ = /"commission_adjustments"\."tenant_id" = \$\d+/
const AGENT_EQ = /"commission_adjustments"\."agent_id" = \$\d+/
const ID_EQ = /"commission_adjustments"\."id" = \$\d+/

const repo = new CommissionAdjustmentsRepo()

describe('statuses', () => {
  it('names the three statuses', () => {
    assert.deepEqual({ ...COMMISSION_ADJUSTMENT_STATUS }, { PENDING: 'PENDING', APPLIED: 'APPLIED', CANCELLED: 'CANCELLED' })
  })
})

describe('CANCELLED never counts', () => {
  it('sumAppliedForCycle sums APPLIED rows of the tenant, agent and target week only', async () => {
    selectRows = [{ amount: '40.00' }, { amount: '-15.25' }]
    assert.equal(await repo.sumAppliedForCycle(T, A, FROM, TO), 24.75)
    const { sql, params } = onlyWhere()
    assert.match(sql, STATUS_EQ)
    assert.match(sql, TENANT_EQ)
    assert.match(sql, AGENT_EQ)
    assert.ok(params.includes('APPLIED'))
    assert.ok(!params.includes('CANCELLED') && !params.includes('PENDING'))
  })

  it('sumAppliedByTargetCycle reads APPLIED rows only', async () => {
    selectRows = [{ amount: '10.00', targetCycleFrom: FROM }]
    const byCycle = await repo.sumAppliedByTargetCycle(T, A, FROM, NEXT_TO)
    assert.deepEqual([...byCycle.entries()], [['2026-10-12', 10]])
    const { sql, params } = onlyWhere()
    assert.match(sql, STATUS_EQ)
    assert.ok(params.includes('APPLIED'))
    assert.ok(!params.includes('CANCELLED') && !params.includes('PENDING'))
  })

  it('countPendingForSourceCycle counts PENDING rows only (a cancelled one no longer blocks its week)', async () => {
    selectRows = [{ n: 2 }]
    assert.equal(await repo.countPendingForSourceCycle(T, A, FROM, TO), 2)
    const { sql, params } = onlyWhere()
    assert.match(sql, STATUS_EQ)
    assert.match(sql, TENANT_EQ)
    assert.ok(params.includes('PENDING'))
    assert.ok(!params.includes('CANCELLED') && !params.includes('APPLIED'))
  })
})

describe('listByAgent is tenant-filtered', () => {
  it('filters by tenant and agent and maps the rows', async () => {
    selectRows = [dbRow('CANCELLED')]
    const rows = await repo.listByAgent(T, A, 50)
    const { sql, params } = onlyWhere()
    assert.match(sql, TENANT_EQ)
    assert.match(sql, AGENT_EQ)
    assert.ok(params.includes(T) && params.includes(A))
    assert.equal(rows[0].status, 'CANCELLED')
    assert.equal(rows[0].amount, -25.5)
  })
})

describe('apply and cancel change a PENDING row only', () => {
  it('apply sets APPLIED and the target week, guarded by id, tenant and status PENDING', async () => {
    updateRows = [{ ...dbRow('APPLIED'), targetCycleFrom: TO, targetCycleTo: NEXT_TO, appliedAt: new Date('2026-10-21T10:00:00.000Z') }]
    const row = await repo.apply(ID, T, { targetCycleFrom: TO, targetCycleTo: NEXT_TO })
    assert.equal(row?.status, 'APPLIED')
    assert.equal(sets[0].status, 'APPLIED')
    assert.equal(sets[0].targetCycleFrom, TO)
    const { sql, params } = onlyWhere()
    assert.match(sql, ID_EQ)
    assert.match(sql, TENANT_EQ)
    assert.match(sql, STATUS_EQ)
    assert.ok(params.includes('PENDING'))
  })

  it('apply returns null when the row was no longer PENDING', async () => {
    updateRows = []
    assert.equal(await repo.apply(ID, T, { targetCycleFrom: TO, targetCycleTo: NEXT_TO }), null)
  })

  it('cancel sets CANCELLED and nothing else, guarded by id, tenant and status PENDING', async () => {
    updateRows = [dbRow('CANCELLED')]
    const row = await repo.cancel(ID, T)
    assert.equal(row?.status, 'CANCELLED')
    assert.deepEqual(sets[0], { status: 'CANCELLED' })
    const { sql, params } = onlyWhere()
    assert.match(sql, ID_EQ)
    assert.match(sql, TENANT_EQ)
    assert.match(sql, STATUS_EQ)
    assert.ok(params.includes('PENDING') && params.includes(ID) && params.includes(T))
  })

  it('cancel returns null when the row was no longer PENDING', async () => {
    updateRows = []
    assert.equal(await repo.cancel(ID, T), null)
  })
})
