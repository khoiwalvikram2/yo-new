/**
 * The credit statement's maths (services/creditStatement.ts): opening and
 * running balance, the player P&L sign, a settlement returning the balance to
 * 0, informational rows, range edges, paging and cents. Pure: no database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/players/__tests__/creditStatement.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCreditStatement,
  isMoneyRow,
  normalizeStatementPaging,
  roundMoney,
  STATEMENT_DEFAULT_LIMIT,
  STATEMENT_MAX_LIMIT,
  type CreditStatementEntry,
} from '../services/creditStatement.js'

const FROM = new Date('2026-09-30T18:30:00.000Z') // 1 Oct 00:00 IST
const TO = new Date('2026-10-07T18:29:59.999Z') // 7 Oct 23:59:59.999 IST

function bet(id: string, at: string, amount: number, domain: 'sports' | 'casino' | 'matka' = 'sports'): CreditStatementEntry {
  return { id, type: 'BET_SETTLED', occurredAt: new Date(at), domain, reference: `ref ${id}`, details: null, amount, valueBefore: null, valueAfter: null }
}
function settlement(id: string, at: string, settledBalance: number): CreditStatementEntry {
  return { id, type: 'SETTLEMENT', occurredAt: new Date(at), domain: null, reference: 'Settlement', details: null, amount: roundMoney(-settledBalance), valueBefore: settledBalance, valueAfter: 0 }
}
function limitChange(id: string, at: string, before: number, after: number): CreditStatementEntry {
  return { id, type: 'LIMIT_CHANGE', occurredAt: new Date(at), domain: null, reference: null, details: 'limit', amount: after - before, valueBefore: before, valueAfter: after }
}
function build(entries: CreditStatementEntry[], currentBalance: number, movementAfterRange = 0, paging = { limit: 200, offset: 0 }) {
  return buildCreditStatement({ entries, currentBalance, movementAfterRange, dateFrom: FROM, dateTo: TO, ...paging })
}

describe('buildCreditStatement: opening and running balance', () => {
  it('opening = current − movement after the range − movement inside it', () => {
    const s = build([bet('a', '2026-10-02T10:00:00Z', 500), bet('b', '2026-10-03T10:00:00Z', -200)], 1000, 100)
    assert.equal(s.closingBalance, 900)
    assert.equal(s.openingBalance, 600)
  })

  it('walks forward from the opening balance and returns rows newest first', () => {
    const s = build([bet('a', '2026-10-02T10:00:00Z', 500), bet('b', '2026-10-03T10:00:00Z', -200)], 1000, 100)
    assert.deepEqual(s.rows.map((r) => [r.id, r.balanceAfter]), [['b', 900], ['a', 1100]])
    assert.equal(s.rows[0].balanceAfter, s.closingBalance)
  })

  it('uses the player P&L sign: a win raises the balance, a loss lowers it', () => {
    const s = build([bet('win', '2026-10-02T10:00:00Z', 300), bet('loss', '2026-10-02T11:00:00Z', -120, 'casino')], 180)
    assert.equal(s.openingBalance, 0)
    const byId = Object.fromEntries(s.rows.map((r) => [r.id, r.balanceAfter]))
    assert.equal(byId.win, 300)
    assert.equal(byId.loss, 180)
    assert.deepEqual(s.totals, { totalWon: 300, totalLost: 120, netResult: 180, settlementsTotal: 0, settlementCount: 0, betCount: 2 })
  })

  it('a settlement row takes the running balance back to 0', () => {
    const s = build([bet('a', '2026-10-02T10:00:00Z', 300), settlement('s', '2026-10-04T10:00:00Z', 300), bet('c', '2026-10-05T10:00:00Z', -50)], -50)
    assert.equal(s.openingBalance, 0)
    const settled = s.rows.find((r) => r.id === 's')!
    assert.equal(settled.balanceAfter, 0)
    assert.equal(settled.affectsBalance, true)
    assert.equal(s.totals.settlementsTotal, -300)
    assert.equal(s.totals.settlementCount, 1)
  })

  it('a player who owed (negative balance) settles for a positive amount, also back to 0', () => {
    const s = build([bet('a', '2026-10-02T10:00:00Z', -400), settlement('s', '2026-10-03T10:00:00Z', -400)], 0)
    const settled = s.rows.find((r) => r.id === 's')!
    assert.equal(settled.amount, 400)
    assert.equal(settled.balanceAfter, 0)
  })

  it('informational rows carry no balance and do not move it', () => {
    const s = build([bet('a', '2026-10-02T10:00:00Z', 100), limitChange('l', '2026-10-03T10:00:00Z', 1000, 1500), bet('b', '2026-10-04T10:00:00Z', 50)], 150)
    const info = s.rows.find((r) => r.id === 'l')!
    assert.equal(info.affectsBalance, false)
    assert.equal(info.balanceAfter, null)
    assert.equal(s.openingBalance, 0)
    assert.equal(s.rows.find((r) => r.id === 'b')!.balanceAfter, 150)
  })

  it('ignores entries outside the range (the movement after the range is passed separately)', () => {
    const s = build([bet('before', '2026-09-30T18:29:59.999Z', 999), bet('in', '2026-10-02T10:00:00Z', 10), bet('after', '2026-10-07T18:30:00.000Z', 999)], 10)
    assert.deepEqual(s.rows.map((r) => r.id), ['in'])
    assert.equal(s.openingBalance, 0)
  })

  it('includes rows exactly on both boundaries', () => {
    const s = build([bet('first', '2026-09-30T18:30:00.000Z', 5), bet('last', '2026-10-07T18:29:59.999Z', 7)], 12)
    assert.deepEqual(s.rows.map((r) => r.id), ['last', 'first'])
  })

  it('an empty range: opening = closing = current − movement after', () => {
    const s = build([], 250, 75)
    assert.equal(s.openingBalance, 175)
    assert.equal(s.closingBalance, 175)
    assert.equal(s.totalRows, 0)
  })

  it('rows at the same instant are ordered by id, so balances never swap between reads', () => {
    const at = '2026-10-02T10:00:00Z'
    const s = build([bet('b', at, 20), bet('a', at, 10)], 30)
    assert.deepEqual(s.rows.map((r) => [r.id, r.balanceAfter]), [['b', 30], ['a', 10]])
  })

  it('cents never drift over many rows', () => {
    const entries = Array.from({ length: 10 }, (_, i) => bet(`r${i}`, `2026-10-02T10:00:0${i}Z`, 0.1))
    const s = build(entries, 1)
    assert.equal(s.openingBalance, 0)
    assert.deepEqual(s.rows.map((r) => r.balanceAfter).reverse(), [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
  })
})

describe('buildCreditStatement: paging and totals', () => {
  const five = ['1', '2', '3', '4', '5'].map((d) => bet(`b${d}`, `2026-10-0${d}T10:00:00Z`, Number(d)))

  it('slices the newest-first rows and reports the full count', () => {
    const s = build(five, 15, 0, { limit: 2, offset: 1 })
    assert.deepEqual(s.rows.map((r) => r.id), ['b4', 'b3'])
    assert.equal(s.totalRows, 5)
  })

  it('a page keeps the balances of the whole range', () => {
    const s = build(five, 15, 0, { limit: 2, offset: 1 })
    assert.deepEqual(s.rows.map((r) => r.balanceAfter), [10, 6])
  })

  it('totals cover the whole range, not the page', () => {
    const s = build(five, 15, 0, { limit: 1, offset: 0 })
    assert.equal(s.totals.totalWon, 15)
    assert.equal(s.totals.betCount, 5)
  })
})

describe('normalizeStatementPaging', () => {
  it('defaults to 200 rows from the top', () => {
    assert.deepEqual(normalizeStatementPaging(undefined, null), { limit: STATEMENT_DEFAULT_LIMIT, offset: 0 })
    assert.equal(STATEMENT_DEFAULT_LIMIT, 200)
  })
  it('clamps a limit above 1000 to 1000', () => {
    assert.equal(normalizeStatementPaging(5000, 0).limit, STATEMENT_MAX_LIMIT)
    assert.equal(STATEMENT_MAX_LIMIT, 1000)
  })
  it('refuses a limit below 1 or a fraction', () => {
    assert.throws(() => normalizeStatementPaging(0, 0), /limit must be a positive integer/)
    assert.throws(() => normalizeStatementPaging(1.5, 0), /limit must be a positive integer/)
  })
  it('refuses a negative offset', () => {
    assert.throws(() => normalizeStatementPaging(10, -1), /offset must be a non-negative integer/)
  })
})

describe('roundMoney and isMoneyRow', () => {
  it('rounds half away from zero at the cent and never returns −0', () => {
    assert.equal(roundMoney(1.005), 1.01)
    assert.equal(roundMoney(-1.005), -1.01)
    assert.ok(Object.is(roundMoney(-0.001), 0))
    assert.equal(roundMoney(0.1 + 0.2), 0.3)
  })
  it('only BET_SETTLED and SETTLEMENT move the balance', () => {
    assert.deepEqual(
      (['BET_SETTLED', 'SETTLEMENT', 'LIMIT_CHANGE', 'CREDIT_USED_CHANGE', 'ALLOCATION'] as const).map((t) => isMoneyRow(t)),
      [true, true, false, false, false],
    )
  })
})
