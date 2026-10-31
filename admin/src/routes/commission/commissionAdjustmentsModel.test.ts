import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  ADJUSTMENT_NOTE_MAX,
  ADJUSTMENT_REASONS,
  adjustmentEffect,
  adjustmentSourceCycles,
  adjustmentStatusLabel,
  adjustmentStatusTone,
  adjustmentTargetCycles,
  adjustmentWeekLabel,
  applyAdjustmentInput,
  createAdjustmentInput,
  cycleStateWord,
  deductionExceedsPayable,
  reviewAdjustmentsHref,
  signedAdjustmentAmount,
} from './commissionAdjustmentsModel'

// Oldest first, as commissionCyclesForAgent returns them.
const zero = { from: '2026-09-27T18:30:00.000Z', to: '2026-10-04T18:30:00.000Z', status: 'SETTLED', paidAmount: 0, payableAmount: 0, zeroCommission: true, fromDate: '2026-09-28', toDate: '2026-10-05' }
const paid = { from: '2026-10-04T18:30:00.000Z', to: '2026-10-11T18:30:00.000Z', status: 'SETTLED', paidAmount: 80, payableAmount: 0, zeroCommission: false, fromDate: '2026-10-05', toDate: '2026-10-12' }
const unpaid = { from: '2026-10-11T18:30:00.000Z', to: '2026-10-18T18:30:00.000Z', status: 'CLOSED_UNSETTLED', paidAmount: 0, payableAmount: 120, fromDate: '2026-10-12', toDate: '2026-10-19' }
const open = { from: '2026-10-18T18:30:00.000Z', to: '2026-10-25T18:30:00.000Z', status: 'OPEN', paidAmount: 0, fromDate: '2026-10-19', toDate: '2026-10-26' }
const cycles = [zero, paid, unpaid, open]

describe('adjustment weeks', () => {
  test('source weeks: every closed week, paid or not, newest first; never the open week', () => {
    assert.deepEqual(adjustmentSourceCycles(cycles), [unpaid, paid, zero])
    assert.deepEqual(adjustmentSourceCycles(null), [])
  })
  test('target weeks: unpaid closed weeks and the open week, oldest first; never a paid or settled week', () => {
    assert.deepEqual(adjustmentTargetCycles(cycles), [unpaid, open])
    assert.deepEqual(adjustmentTargetCycles([{ ...unpaid, paidAmount: 5 }]), [])
    assert.deepEqual(adjustmentTargetCycles(undefined), [])
  })
  test('a week reads as no commission, paid, unpaid or current week', () => {
    assert.deepEqual(cycles.map((cycle) => cycleStateWord(cycle)), ['no commission', 'paid', 'unpaid', 'current week'])
  })
  test('week labels are the IST Monday to Sunday of the stored bounds', () => {
    assert.equal(adjustmentWeekLabel(unpaid.from, unpaid.to), '12 Oct – 18 Oct 2026')
    assert.equal(adjustmentWeekLabel(null, null), '—')
  })
})

describe('create input', () => {
  test("Add sends a positive amount and Deduct a negative one, for the week's IST dates", () => {
    assert.deepEqual(createAdjustmentInput('a1', unpaid, 'add', 25.5, 'Correction', ''), {
      agentId: 'a1', amount: 25.5, sourceCycleFrom: '2026-10-12', sourceCycleTo: '2026-10-19', reason: 'Correction',
    })
    assert.equal(createAdjustmentInput('a1', paid, 'deduct', 25.5, 'Void', '')?.amount, -25.5)
    assert.equal(signedAdjustmentAmount('deduct', -3), -3)
    assert.equal(signedAdjustmentAmount('add', -3), 3)
  })
  test('the optional note goes to refMeta.note, trimmed and capped', () => {
    assert.equal(createAdjustmentInput('a1', unpaid, 'add', 10, 'Other', '  Duplicate bet  ')?.refMeta, '{"note":"Duplicate bet"}')
    const long = createAdjustmentInput('a1', unpaid, 'add', 10, 'Other', 'x'.repeat(ADJUSTMENT_NOTE_MAX + 20))
    assert.equal((JSON.parse(long?.refMeta ?? '{}') as { note: string }).note.length, ADJUSTMENT_NOTE_MAX)
    assert.equal('refMeta' in (createAdjustmentInput('a1', unpaid, 'add', 10, 'Other', '   ') ?? {}), false)
  })
  test('nothing is sent without an agent, a closed week, a positive amount and a listed reason', () => {
    for (const amount of [null, 0, -5, 0.004, NaN, Infinity]) assert.equal(createAdjustmentInput('a1', unpaid, 'add', amount, 'Void', ''), null)
    assert.equal(createAdjustmentInput('a1', open, 'add', 10, 'Void', ''), null)
    assert.equal(createAdjustmentInput('a1', undefined, 'add', 10, 'Void', ''), null)
    assert.equal(createAdjustmentInput(undefined, unpaid, 'add', 10, 'Void', ''), null)
    assert.equal(createAdjustmentInput('a1', unpaid, 'add', 10, '', ''), null)
    assert.equal(createAdjustmentInput('a1', unpaid, 'add', 10, 'Bonus', ''), null)
    assert.deepEqual([...ADJUSTMENT_REASONS], ['Void', 'Refund', 'Rollback', 'Correction', 'Other'])
  })
  test('amounts are rounded to cents', () => {
    assert.equal(createAdjustmentInput('a1', unpaid, 'add', 10.006, 'Void', '')?.amount, 10.01)
  })
})

describe('apply input and the deduction warning', () => {
  test("apply sends the target week's IST dates", () => {
    assert.deepEqual(applyAdjustmentInput('adj-1', unpaid), { adjustmentId: 'adj-1', targetCycleFrom: '2026-10-12', targetCycleTo: '2026-10-19' })
    assert.equal(applyAdjustmentInput('adj-1', undefined), null)
    assert.equal(applyAdjustmentInput(undefined, unpaid), null)
  })
  test("a deduction above a closed week's payable is flagged; the open week and additions are not", () => {
    assert.equal(deductionExceedsPayable(-150, unpaid), true)
    assert.equal(deductionExceedsPayable(-120, unpaid), false)
    assert.equal(deductionExceedsPayable(150, unpaid), false)
    assert.equal(deductionExceedsPayable(-150, open), false)
    assert.equal(deductionExceedsPayable(-150, undefined), false)
  })
})

describe('labels and the review link', () => {
  test('status words, tones and the Add / Deduct word', () => {
    assert.deepEqual(['PENDING', 'APPLIED', 'CANCELLED', 'ODD'].map((status) => adjustmentStatusLabel(status)), ['Pending', 'Applied', 'Cancelled', 'ODD'])
    assert.deepEqual(['PENDING', 'APPLIED', 'CANCELLED', 'ODD'].map((status) => adjustmentStatusTone(status)), ['warn', 'ok', 'muted', 'neutral'])
    assert.equal(adjustmentEffect(-1), 'Deduct')
    assert.equal(adjustmentEffect(1), 'Add')
  })
  test("the readiness link opens the agent profile's Commission tab at the Adjustments card", () => {
    assert.equal(reviewAdjustmentsHref('sub-1'), '/agents/sub-1?tab=commission#commission-adjustments')
  })
})
