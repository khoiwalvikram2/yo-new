/**
 * The COMMISSION export's per-cycle rows and the SETTLEMENTS export's rows (agent features spec §4).
 * Pure: the cycles are built here with the engine's own week helpers.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/agentExportRows.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cycleBoundsFromKey, cycleKeyIST, cycleKeysInRange } from '@src/domains/agents/services/commissionCycleMath.js'
import {
  buildCommissionCycleRows,
  countCommissionCycleRows,
  cycleOverlapsWindow,
  orderScopeAgents,
  settlementAgentIds,
  toAgentSettlementRow,
} from '../services/agentExportRows.js'

const ist = (local: string) => new Date(`${local}+05:30`)

function cycle(key: string, extra: Record<string, unknown> = {}) {
  return {
    ...cycleBoundsFromKey(key),
    status: 'CLOSED_UNSETTLED',
    payableAmount: 120,
    paidAmount: 0,
    calculatedTotal: 150,
    adjustmentAmount: -30,
    zeroCommission: false,
    ...extra,
  }
}

describe('cycleOverlapsWindow', () => {
  const week = cycleBoundsFromKey('2026-10-12') // Mon 12 Oct 00:00 IST -> Mon 19 Oct 00:00 IST

  it('takes a week that shares any instant with the period', () => {
    assert.equal(cycleOverlapsWindow(week, {}), true)
    assert.equal(cycleOverlapsWindow(week, { from: ist('2026-10-18T23:59:59.999'), to: ist('2026-10-25T00:00:00') }), true)
    assert.equal(cycleOverlapsWindow(week, { from: ist('2026-10-01T00:00:00'), to: ist('2026-10-12T00:00:00.001') }), true)
  })

  it('leaves out a week that ends when the period starts, or starts when or after it ends', () => {
    assert.equal(cycleOverlapsWindow(week, { from: ist('2026-10-19T00:00:00') }), false)
    assert.equal(cycleOverlapsWindow(week, { to: ist('2026-10-11T23:59:59.999') }), false)
    assert.equal(cycleOverlapsWindow(week, { to: ist('2026-10-12T00:00:00') }), false)
  })
})

describe('orderScopeAgents', () => {
  it('puts the scope agent first, then its sub-agents by username, nameless last', () => {
    const ordered = orderScopeAgents(
      [{ id: 'c', username: 'zed' }, { id: 'root', username: 'mia' }, { id: 'b', username: 'amy' }, { id: 'a', username: null }],
      'root',
    )
    assert.deepEqual(ordered.map((a) => a.id), ['root', 'b', 'c', 'a'])
  })
})

describe('buildCommissionCycleRows', () => {
  it('one row per agent per week in the period, the agent first, an OPEN week with no payable yet', () => {
    const agents = [{ id: 'root', username: 'mia' }, { id: 'child', username: 'amy' }]
    const cycles = new Map([
      ['root', [
        cycle('2026-09-28'),
        cycle('2026-10-05'),
        cycle('2026-10-12', { status: 'SETTLED', payableAmount: 0, paidAmount: 120 }),
        cycle('2026-10-19', { status: 'OPEN', payableAmount: null }),
      ]],
      ['child', [cycle('2026-10-12', { carriedLoss: 40, carryApplied: 25, lossThisCycle: 0 })]],
    ])
    const rows = buildCommissionCycleRows(agents, cycles as never, {
      window: { from: ist('2026-10-06T00:00:00'), to: ist('2026-10-20T23:59:59.999') },
      scopeAgentId: 'root',
      currency: 'INR',
    })
    assert.deepEqual(rows.map((r) => [r.agentId, r.cycleFrom.slice(0, 10), r.status, r.relation]), [
      ['root', '2026-10-04', 'CLOSED_UNSETTLED', 'SELF'],
      ['root', '2026-10-11', 'SETTLED', 'SELF'],
      ['root', '2026-10-18', 'OPEN', 'SELF'],
      ['child', '2026-10-11', 'CLOSED_UNSETTLED', 'SUB_AGENT'],
    ])
    assert.equal(rows[0].payable, 120)
    assert.equal(rows[0].gross, 150)
    assert.equal(rows[0].adjustments, -30)
    assert.equal(rows[1].paid, 120)
    assert.equal(rows[2].payable, '', 'an OPEN week has no payable yet')
    assert.equal(rows[0].carriedLoss, '', 'no carry fields from the engine: blank, not 0')
    assert.equal(rows[0].carryApplied, '')
    assert.equal(rows[0].lossThisCycle, '')
    assert.equal(rows[3].carriedLoss, 40)
    assert.equal(rows[3].carryApplied, 25)
    assert.equal(rows[3].lossThisCycle, 0)
    assert.equal(rows[3].name, 'amy')
    assert.equal(rows[0].currency, 'INR')
    assert.equal(rows[0].id, `root:${rows[0].cycleFrom}`)
  })
})

describe('countCommissionCycleRows', () => {
  it('counts what buildCommissionCycleRows lists for the same agents, weeks and period', () => {
    const now = ist('2026-10-22T12:00:00')
    const created = [ist('2026-10-01T10:00:00'), ist('2026-10-13T09:00:00')]
    const window = { from: ist('2026-10-06T00:00:00'), to: ist('2026-10-14T23:59:59.999') }
    const end = cycleBoundsFromKey(cycleKeyIST(now)).to
    const cycles = new Map(
      created.map((c, i): [string, ReturnType<typeof cycle>[]] => [
        `a${i}`,
        cycleKeysInRange(cycleBoundsFromKey(cycleKeyIST(c)).from, end).map((key) => cycle(key)),
      ]),
    )
    const listed = buildCommissionCycleRows([{ id: 'a0', username: null }, { id: 'a1', username: null }], cycles as never, {
      window,
      scopeAgentId: 'a0',
      currency: '',
    })
    assert.equal(listed.length, 3, 'a0: weeks of 5 and 12 Oct; a1 (created 13 Oct): week of 12 Oct')
    assert.equal(countCommissionCycleRows(created, window, now), listed.length)
  })

  it('an unreadable creation date counts from the current week, as the engine does', () => {
    assert.equal(countCommissionCycleRows(['not a date'], {}, ist('2026-10-22T12:00:00')), 1)
  })
})

describe('settlement rows', () => {
  it('the agents: the scope agent and its direct children, each once', () => {
    assert.deepEqual(settlementAgentIds('root', ['c1', 'root', 'c1', 'c2']), ['root', 'c1', 'c2'])
    assert.deepEqual(settlementAgentIds('root', []), ['root'])
  })

  it('a row says whose settlement it is, with numbers for amounts', () => {
    const row = toAgentSettlementRow(
      {
        id: 's1',
        agentId: 'c1',
        settlementType: 'P_L',
        amount: '1250.50',
        direction: 'TO_AGENT',
        previousBalance: '-1250.50',
        newBalance: null,
        notes: null,
        settledBy: null,
        createdAt: new Date('2026-10-20T06:00:00.000Z'),
      },
      { username: 'amy', schemeType: 'SHARING' },
      { scopeAgentId: 'root', periodFrom: '2026-10-01T00:00:00.000Z', periodTo: undefined, currency: 'INR' },
    )
    assert.deepEqual(row, {
      id: 's1',
      agentId: 'c1',
      name: 'amy',
      type: 'SHARING',
      relation: 'DIRECT_SUB_AGENT',
      periodFrom: '2026-10-01T00:00:00.000Z',
      periodTo: '',
      totalAmount: 1250.5,
      currency: 'INR',
      status: 'PROFIT_LOSS',
      postedAt: '2026-10-20T06:00:00.000Z',
      postedBy: '',
      direction: 'TO_AGENT',
      previousBalance: -1250.5,
      newBalance: 0,
      notes: '',
    })
    const own = toAgentSettlementRow({ id: 's2', agentId: 'root', settlementType: 'CREDIT' }, undefined, { scopeAgentId: 'root', currency: 'INR' })
    assert.equal(own.relation, 'SELF')
    assert.equal(own.status, 'CREDIT')
  })
})
