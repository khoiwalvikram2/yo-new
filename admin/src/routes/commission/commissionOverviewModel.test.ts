import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { blockingReadinessReasons, carryDeductionLabel, commissionCarryLines, commissionCycleWeeks, commissionPayoutInput, commissionRateLabel, commissionSegments, cyclePeriod, cycleRangeLabel, payableCommissionCycles, readinessReasonText, zeroCommissionCycleCount } from './commissionOverviewModel'
describe('commission overview payment contract', () => {
  const cycle = { from: '2026-09-27T18:30:00Z', to: '2026-10-04T18:30:00Z' }
  test('pays exactly the readiness amount for the selected full cycle', () => {
    assert.deepEqual(commissionPayoutInput('sub', cycle, { ready: true, payableAmount: 100.25 }, ''), {
      agentId: 'sub', amount: 100.25, periodFrom: cycle.from, periodTo: cycle.to, notes: 'Commission payout (full cycle IST)',
    })
    assert.equal(commissionPayoutInput('sub', cycle, { ready: true, payableAmount: 100 }, 'Reviewed')?.notes, 'Reviewed')
  })
  test('cannot pay without readiness, a complete cycle or a positive finite amount', () => {
    for (const amount of [0, -1, NaN, Infinity]) assert.equal(commissionPayoutInput('sub', cycle, { ready: true, payableAmount: amount }, ''), null)
    assert.equal(commissionPayoutInput('sub', cycle, { ready: false, payableAmount: 100 }, ''), null)
    assert.equal(commissionPayoutInput('sub', undefined, { ready: true, payableAmount: 100 }, ''), null)
    assert.equal(commissionPayoutInput(undefined, cycle, { ready: true, payableAmount: 100 }, ''), null)
  })
  test('retains fractional-rate display and legacy receivable percentage normalization', () => {
    assert.equal(commissionRateLabel(0.075), '7.50%')
    assert.equal(commissionRateLabel(7.5, 2, true), '7.50%')
    assert.equal(commissionRateLabel(-0.1), '-10.00%')
  })
})
describe('commission cycles', () => {
  const closed = { from: '2026-09-27T18:30:00.000Z', to: '2026-10-04T18:30:00.000Z', status: 'CLOSED_UNSETTLED', payableAmount: 40, fromDate: '2026-09-28', toDate: '2026-10-05' }
  const open = { from: '2026-10-04T18:30:00.000Z', to: '2026-10-11T18:30:00.000Z', status: 'OPEN', fromDate: '2026-10-05', toDate: '2026-10-12' }
  const zero = { from: '2026-09-20T18:30:00.000Z', to: '2026-09-27T18:30:00.000Z', status: 'SETTLED', zeroCommission: true }
  const paid = { from: '2026-09-13T18:30:00.000Z', to: '2026-09-20T18:30:00.000Z', status: 'SETTLED', zeroCommission: false }
  test('only closed, unsettled weeks are payable; zero-commission weeks count as settled', () => {
    assert.deepEqual(payableCommissionCycles([closed, open, zero, paid]), [closed])
    assert.deepEqual(payableCommissionCycles(undefined), [])
    assert.equal(zeroCommissionCycleCount([closed, open, zero, paid]), 1)
    assert.equal(zeroCommissionCycleCount(null), 0)
  })
  test('a cycle is paid and labelled with its IST calendar dates, whatever the browser zone', () => {
    assert.deepEqual(cyclePeriod(closed), { periodFrom: '2026-09-28', periodTo: '2026-10-05' })
    assert.deepEqual(cyclePeriod({ from: closed.from, to: closed.to }), { periodFrom: closed.from, periodTo: closed.to })
    assert.equal(cycleRangeLabel(closed), '28 Sep – 04 Oct 2026')
    assert.equal(cycleRangeLabel({ from: closed.from, to: closed.to }), '28 Sep – 04 Oct 2026')
    assert.deepEqual(commissionPayoutInput('sub', closed, { ready: true, payableAmount: 40 }, ''), { agentId: 'sub', amount: 40, periodFrom: '2026-09-28', periodTo: '2026-10-05', notes: 'Commission payout (full cycle IST)' })
  })
  test('the open and last closed weeks come from currentCommissionCycle, with no browser date maths', () => {
    assert.deepEqual(commissionCycleWeeks({ ...open, previousFromDate: '2026-09-28', previousToDate: '2026-10-05' }), { currentFrom: '2026-10-05', currentTo: '2026-10-12', lastFrom: '2026-09-28', lastTo: '2026-10-05' })
    // An older backend without the date fields: the ISO bounds read in IST; the last week is unknown.
    assert.deepEqual(commissionCycleWeeks({ from: open.from, to: open.to }), { currentFrom: '2026-10-05', currentTo: '2026-10-12', lastFrom: null, lastTo: null })
    assert.deepEqual(commissionCycleWeeks(null), { currentFrom: null, currentTo: null, lastFrom: null, lastTo: null })
  })
  test('readiness: open bets and unresolved adjustments block in words; a ledger gap and zero payable do not', () => {
    assert.deepEqual(blockingReadinessReasons({ ready: false, payableAmount: 40, reasons: ['MISSING_BETS', 'UNRESOLVED_ADJUSTMENT', 'LEDGER_GAP', 'READY', 'ZERO_PAYABLE_NET'], openBets: 1, unresolvedAdjustments: 2 }), [
      '1 bet placed in this week is still open. Pay after they settle, so they are included.',
      '2 adjustments raised against this week are still pending.',
    ])
    assert.deepEqual(blockingReadinessReasons({ ready: true, payableAmount: 40, reasons: ['MISSING_BETS'] }), [])
    assert.deepEqual(blockingReadinessReasons(undefined), [])
    assert.equal(readinessReasonText('MISSING_BETS'), 'Bets placed in this week are still open. Pay after they settle, so they are included.')
    assert.equal(readinessReasonText('NOT_CLOSED'), 'This week is still open. Only closed weeks (Monday to Monday, IST) can be paid.')
    assert.equal(readinessReasonText('SOMETHING_NEW'), 'SOMETHING_NEW')
  })
})
describe('commission segments (Receivable / Payable / My Share)', () => {
  const own = { sportsGGR: 1000, casinoGGR: 200, matkaGGR: -50, directSportsGGR: 100, directCasinoGGR: 50, directMatkaGGR: -10,
    sportsCommissionRate: 0.1, casinoCommissionRate: 0.05, matkaCommissionRate: 0.2, sportsCommission: 10, casinoCommission: 20, matkaCommission: -5,
    grossEffectiveSportsCommission: 30, grossEffectiveCasinoCommission: 15, grossEffectiveMatkaCommission: -5, grossEffectiveCalculatedTotal: 41,
    netEffectiveSportsCommission: 10, netEffectiveCasinoCommission: 20, netEffectiveMatkaCommission: -5, netEffectiveCalculatedTotal: 26 }
  const children = [
    { sportsGGR: 200, casinoGGR: -100, matkaGGR: 0, sportsCommission: 18, casinoCommission: -5, matkaCommission: 0, effectiveSportsCommission: 20, effectiveCasinoCommission: -5, effectiveMatkaCommission: 0, effectiveCalculatedTotal: 15 },
    { sportsGGR: 50, casinoGGR: 0, matkaGGR: 0, sportsCommission: 5, casinoCommission: 0, matkaCommission: 0, effectiveSportsCommission: 0, effectiveCasinoCommission: 0, effectiveMatkaCommission: 0, effectiveCalculatedTotal: 0 },
  ]
  test('Receivable is the backend gross after tally (not GGR x rate), Payable sums the children\'s effective (their gross), My Share is the backend net', () => {
    const { receivable, payable, myShare } = commissionSegments(own, children)
    // The backend totals win over the domain sums (Receivable 41 vs 40, My Share 26 vs 25).
    assert.deepEqual(receivable, { sports: { ggr: 1000, commission: 30 }, casino: { ggr: 200, commission: 15 }, matka: { ggr: -50, commission: -5 }, totalGgr: 1150, totalCommission: 41 })
    assert.deepEqual(payable, { sports: { ggr: 250, commission: 20 }, casino: { ggr: -100, commission: -5 }, matka: { ggr: 0, commission: 0 }, totalGgr: 150, totalCommission: 15 })
    // My Share's GGR is the agent's direct players' only.
    assert.deepEqual(myShare, { sports: { ggr: 100, commission: 10 }, casino: { ggr: 50, commission: 20 }, matka: { ggr: -10, commission: -5 }, totalGgr: 140, totalCommission: 26 })
  })
  test('without the net fields My Share is Receivable − Payable; the payable total is the domain sum unless every child has its total', () => {
    const noNet = { ...own, netEffectiveSportsCommission: null, netEffectiveCasinoCommission: undefined, netEffectiveMatkaCommission: null, netEffectiveCalculatedTotal: null }
    const partial = [children[0], { ...children[1], effectiveSportsCommission: 2, effectiveCalculatedTotal: null }]
    const { payable, myShare } = commissionSegments(noNet, partial)
    assert.deepEqual([payable.sports.commission, payable.casino.commission, payable.matka.commission, payable.totalCommission], [22, -5, 0, 17])
    assert.deepEqual([myShare.sports.commission, myShare.casino.commission, myShare.matka.commission, myShare.totalCommission], [8, 20, -5, 23])
  })
  test('an older backend without gross fields falls back to GGR x rate, the children\'s raw commission and the own commission', () => {
    const legacy = { sportsGGR: 1000, casinoGGR: 200, matkaGGR: -50, sportsCommissionRate: 0.1, casinoCommissionRate: 0.05, matkaCommissionRate: 0.2, sportsCommission: 10, casinoCommission: 20, matkaCommission: -5 }
    const { receivable, payable, myShare } = commissionSegments(legacy, [{ sportsGGR: 200, sportsCommission: 18, casinoCommission: -5 }])
    assert.deepEqual([receivable.sports.commission, receivable.casino.commission, receivable.matka.commission, receivable.totalCommission], [100, 10, -10, 100])
    assert.deepEqual([payable.sports.commission, payable.casino.commission, payable.matka.commission, payable.totalCommission], [18, -5, 0, 13])
    assert.deepEqual([myShare.sports.commission, myShare.casino.commission, myShare.matka.commission, myShare.totalCommission, myShare.totalGgr], [10, 20, -5, 25, 0])
  })
  test('missing or non-finite figures count as zero', () => {
    const zero = { sports: { ggr: 0, commission: 0 }, casino: { ggr: 0, commission: 0 }, matka: { ggr: 0, commission: 0 }, totalGgr: 0, totalCommission: 0 }
    assert.deepEqual(commissionSegments(null, null), { receivable: zero, payable: zero, myShare: zero })
    assert.deepEqual(commissionSegments({ sportsGGR: Number.NaN, grossEffectiveSportsCommission: Number.POSITIVE_INFINITY }, []).receivable.sports, { ggr: 0, commission: 0 })
  })
})

describe('loss carry-forward (one week)', () => {
  test('a loss carried in and partly recovered: the rest is forgiven; this week\'s own loss carries on', () => {
    assert.deepEqual(commissionCarryLines({ carriedLoss: 200, carryApplied: 100, lossThisCycle: 30 }), { carriedLoss: 200, carryApplied: 100, forgiven: 100, lossThisCycle: 30 })
    assert.deepEqual(commissionCarryLines({ carriedLoss: 200, carryApplied: 200, lossThisCycle: 0 }), { carriedLoss: 200, carryApplied: 200, forgiven: 0, lossThisCycle: 0 })
  })
  test('the applied part never exceeds the carried loss', () => {
    assert.deepEqual(commissionCarryLines({ carriedLoss: 50, carryApplied: 80 }), { carriedLoss: 50, carryApplied: 50, forgiven: 0, lossThisCycle: 0 })
  })
  test('nothing to show: no loss either way, an older backend without the fields, or bad figures', () => {
    assert.equal(commissionCarryLines({ carriedLoss: 0, carryApplied: 0, lossThisCycle: 0 }), null)
    assert.equal(commissionCarryLines({}), null)
    assert.equal(commissionCarryLines(null), null)
    assert.equal(commissionCarryLines({ carriedLoss: Number.NaN, lossThisCycle: -5 }), null)
  })
  test('a carry figure reads as a deduction', () => {
    const format = (value: number) => `INR ${value.toFixed(2)}`
    assert.equal(carryDeductionLabel(200, format), '\u2212INR 200.00')
    assert.equal(carryDeductionLabel(0, format), 'INR 0.00')
    assert.equal(carryDeductionLabel(Number.NaN, format), 'INR 0.00')
  })
  test('MISSING_BETS also names the open bets of the week before, whose loss carries into this week', () => {
    assert.equal(readinessReasonText('MISSING_BETS', { openBets: 0, previousCycleOpenBets: 3 }), "3 bets placed in the week before are still open. That week's loss carries into this one, so pay after they settle.")
    assert.equal(readinessReasonText('MISSING_BETS', { openBets: 2, previousCycleOpenBets: 1 }), "2 bets placed in this week are still open. Pay after they settle, so they are included. 1 bet placed in the week before is still open. That week's loss carries into this one, so pay after they settle.")
    assert.equal(readinessReasonText('MISSING_BETS', { openBets: 1, previousCycleOpenBets: 0 }), '1 bet placed in this week is still open. Pay after they settle, so they are included.')
  })
})
