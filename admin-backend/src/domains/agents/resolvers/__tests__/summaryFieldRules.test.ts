/**
 * W10 (agent-schemes hardening): the commission / settlement summary field rules.
 *
 * - commissionSummary exposes the GROSS (Receivable) and NET-effective (My Share)
 *   figures whatever the caller's mode (B1).
 * - commissionHistory shows another agent's GROSS, and the caller's own NET (B1):
 *   the pay dialog's bet count and amounts match the payable.
 * - settlementSummary.settlementDirection follows the engine's sign (B2).
 * - the breakdown rows mean what the engine's breakdown means (F10).
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/resolvers/__tests__/summaryFieldRules.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  commissionHistoryMode,
  commissionSummaryCarryFields,
  commissionSummaryGrossNetFields,
  settlementBreakdownItem,
  settlementSummaryDirection,
} from '../summaryFieldRules.js'
import type { CommissionSummary } from '../../services/CommissionCalculationService.js'

function summary(over: Partial<CommissionSummary>): CommissionSummary {
  return {
    agentId: 'a', periodFrom: new Date(0), periodTo: new Date(0), totalCommission: 0,
    sportsCommission: 0, casinoCommission: 0, matkaCommission: 0, commissionRate: 0, totalGGR: 0, currency: 'INR',
    sportsGGR: 0, casinoGGR: 0, matkaGGR: 0, sportsCommissionRate: 0, casinoCommissionRate: 0, matkaCommissionRate: 0,
    effectiveCalculatedTotal: 0, effectiveSportsCommission: 0, effectiveCasinoCommission: 0, effectiveMatkaCommission: 0,
    ...over,
  }
}

describe('commissionSummary gross / net fields (B1)', () => {
  // A 10% -> B 8%; B's players lose 1000 sports: A gross 100, owes B 80, A net 20.
  const gross = { grossSportsCommission: 100, grossCasinoCommission: -5, grossMatkaCommission: 0,
    grossEffectiveSportsCommission: 100, grossEffectiveCasinoCommission: 0, grossEffectiveMatkaCommission: 0,
    grossEffectiveCalculatedTotal: 100, netEffectiveCalculatedTotal: 20 }

  it('admin caller (gross mode): gross from the summary, net-effective per domain from the net-mode summary', () => {
    const main = summary({ ...gross, effectiveSportsCommission: 100, effectiveCalculatedTotal: 100 })
    const net = summary({ ...gross, effectiveSportsCommission: 20, effectiveCasinoCommission: 0, effectiveMatkaCommission: 0, effectiveCalculatedTotal: 20 })
    assert.deepEqual(commissionSummaryGrossNetFields(main, 'gross', net), {
      grossSportsCommission: 100, grossCasinoCommission: -5, grossMatkaCommission: 0,
      grossEffectiveSportsCommission: 100, grossEffectiveCasinoCommission: 0, grossEffectiveMatkaCommission: 0,
      grossEffectiveCalculatedTotal: 100,
      netEffectiveSportsCommission: 20, netEffectiveCasinoCommission: 0, netEffectiveMatkaCommission: 0,
      netEffectiveCalculatedTotal: 20,
    })
  })

  it('agent caller (net mode): the gross is still exposed; its own effective* are the net ones', () => {
    const main = summary({ ...gross, effectiveSportsCommission: 20, effectiveCalculatedTotal: 20 })
    const out = commissionSummaryGrossNetFields(main, 'net')
    assert.equal(out.grossEffectiveCalculatedTotal, 100, 'Receivable = what the payer owes, not GGR x one rate')
    assert.equal(out.netEffectiveSportsCommission, 20)
    assert.equal(out.netEffectiveCalculatedTotal, 20)
  })

  it('missing figures are null, never NaN', () => {
    const out = commissionSummaryGrossNetFields(summary({ grossEffectiveCalculatedTotal: Number.NaN }), 'gross', null)
    assert.equal(out.grossEffectiveCalculatedTotal, null)
    assert.equal(out.grossSportsCommission, null)
    assert.equal(out.netEffectiveSportsCommission, null)
  })
})

describe('commissionHistory mode (B1)', () => {
  it('an agent reading its own history sees its net', () => {
    assert.equal(commissionHistoryMode({ type: 'agent', agentId: 'parent' }, 'parent'), 'net')
  })
  it('an agent reading a child (the Pay dialog) sees the child\'s gross, as paid', () => {
    assert.equal(commissionHistoryMode({ type: 'agent', agentId: 'parent' }, 'child'), 'gross')
  })
  it('admins see the gross', () => {
    assert.equal(commissionHistoryMode({ type: 'admin' }, 'child'), 'gross')
    assert.equal(commissionHistoryMode(undefined, 'child'), 'gross')
  })
})

describe('settlementSummary direction (B2)', () => {
  it('positive = TO_AGENT, negative = FROM_AGENT, ~0 = NONE (the engine sign)', () => {
    assert.equal(settlementSummaryDirection({ settlementDue: 120 }), 'TO_AGENT')
    assert.equal(settlementSummaryDirection({ settlementDue: -40 }), 'FROM_AGENT')
    assert.equal(settlementSummaryDirection({ settlementDue: 0.001 }), 'NONE')
  })
  it('the engine direction wins when it is set', () => {
    assert.equal(settlementSummaryDirection({ settlementDue: 120, settlementDirection: 'TO_AGENT' }), 'TO_AGENT')
    assert.equal(settlementSummaryDirection({ settlementDue: -40, settlementDirection: 'NONE' }), 'FROM_AGENT')
  })
})

describe('settlementSummary breakdown rows (F10 meanings)', () => {
  it('players lost 1000 at 20%: amount −1000 (players\' P/L), agentShare +200 (agent earns), cut 800 (never negative)', () => {
    assert.deepEqual(settlementBreakdownItem('sports', { pl: -1000, share: 200, sharePct: 20, totalAbsPl: 1250 }), {
      domain: 'sports', amount: -1000, percentage: 80, shareRate: 20, agentShare: 200, cutAmount: 800, cutPercentage: 80,
    })
  })
  it('players won 250 at 20%: agentShare −50 (agent pays), cut 200', () => {
    const row = settlementBreakdownItem('casino', { pl: 250, share: -50, sharePct: 20, totalAbsPl: 1250 })
    assert.equal(row.agentShare, -50)
    assert.equal(row.cutAmount, 200)
    assert.equal(row.percentage, 20)
  })
})

describe('commissionSummary loss carry-forward fields (spec §3)', () => {
  it('passes the carry figures through', () => {
    assert.deepEqual(commissionSummaryCarryFields(summary({ carriedLoss: 200, carryApplied: 150, lossThisCycle: 30 })), { carriedLoss: 200, carryApplied: 150, lossThisCycle: 30 })
  })
  it('a summary without them (or with a bad figure) gives null, never NaN', () => {
    assert.deepEqual(commissionSummaryCarryFields(summary({})), { carriedLoss: null, carryApplied: null, lossThisCycle: null })
    assert.deepEqual(commissionSummaryCarryFields(summary({ carriedLoss: Number.NaN, carryApplied: 0 })), { carriedLoss: null, carryApplied: 0, lossThisCycle: null })
  })
})
