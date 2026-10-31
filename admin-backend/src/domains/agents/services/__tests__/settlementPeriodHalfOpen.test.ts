/**
 * SHARING multi-period settlement: periods are half-open [from, to).
 *
 * deriveSinceLastPeriod starts a new period at exactly the previous periodTo.
 * The ledger reads used closed overlaps (periodFrom <= to AND periodTo >= from),
 * so the previous period's SHARE and SETTLEMENT lines matched the new window by
 * that shared instant: the second settlement re-used the old SHARE total,
 * subtracted the old settlement from it and said "already fully settled".
 *
 * No database: the SQL rule is checked by rendering it, the period derivation
 * runs against a stubbed last settlement and an in-memory ledger.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/settlementPeriodHalfOpen.test.ts
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../../../db/client.js'
import { agentLedger } from '@shared/db/schema.js'
import {
  ledgerWindowOverlap,
  overlapsHalfOpen,
  shareLinesForExactWindow,
} from '../../../../repos/agents/AgentLedgerRepo.js'
import { AgentSettlementsRepo } from '../../../../repos/agents/AgentSettlementsRepo.js'
import { deriveSinceLastPeriod } from '../SettlementPeriodUtils.js'

const AGENT = '12121212-1212-4212-8212-121212121212'
const at = (iso: string) => new Date(iso)
// Period 1 runs [A, B); B is where period 2 starts.
const Z = at('2026-01-01T00:00:00.000Z')
const A = at('2026-02-01T00:00:00.000Z')
const B = at('2026-02-10T23:59:59.999Z')
const LATER = at('2026-02-20T23:59:59.999Z')

type Line = {
  agentId: string
  lineType: 'SHARE' | 'SETTLEMENT' | 'COMMISSION' | 'ADJUSTMENT'
  domain: 'sports' | 'casino' | 'matka'
  periodFrom: Date
  periodTo: Date
  amount: number
  createdAt: Date
}

const closedOverlap = (lf: Date, lt: Date, from: Date, to: Date) => lf <= to && lt >= from

/** An in-memory AgentLedgerRepo, with the window rule passed in. */
function fakeLedger(lines: Line[], overlap: (lf: Date, lt: Date, from: Date, to: Date) => boolean) {
  return {
    async list(agentId: string, from: Date, to: Date) {
      return lines
        .filter((l) => l.agentId === agentId && overlap(l.periodFrom, l.periodTo, from, to))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    },
    async sumSettlementLinesInPeriod(agentId: string, from: Date, to: Date) {
      const raw = lines
        .filter((l) => l.agentId === agentId && l.lineType === 'SETTLEMENT' && overlap(l.periodFrom, l.periodTo, from, to))
        .reduce((s, l) => s + l.amount, 0)
      return -raw
    },
  }
}

/** executeSettleAgent's cap for a SHARING window, as it now computes it. */
async function remainingNow(ledger: ReturnType<typeof fakeLedger>, lines: Line[], from: Date, to: Date, freshShare: number) {
  let share = shareLinesForExactWindow(await ledger.list(AGENT, from, to), from, to)
  if (share.length === 0) {
    // computeAndPost posts the window's SHARE lines.
    lines.push({ agentId: AGENT, lineType: 'SHARE', domain: 'sports', periodFrom: from, periodTo: to, amount: freshShare, createdAt: new Date() })
    share = shareLinesForExactWindow(await ledger.list(AGENT, from, to), from, to)
  }
  const total = share.reduce((s, l) => s + l.amount, 0)
  const settled = await ledger.sumSettlementLinesInPeriod(AGENT, from, to)
  return Math.max(0, Math.abs(total) - Math.abs(settled))
}

/** The same cap as it was computed before (any overlapping SHARE line). */
async function remainingBefore(ledger: ReturnType<typeof fakeLedger>, from: Date, to: Date) {
  const total = (await ledger.list(AGENT, from, to)).filter((l) => l.lineType === 'SHARE').reduce((s, l) => s + l.amount, 0)
  const settled = await ledger.sumSettlementLinesInPeriod(AGENT, from, to)
  return Math.max(0, Math.abs(total) - Math.abs(settled))
}

describe('ledger window rule', () => {
  it('the SQL is half-open: period_from < to AND period_to > from', () => {
    const { sql, params } = db.select().from(agentLedger).where(ledgerWindowOverlap(A, B)).toSQL()
    assert.match(sql, /"period_from" < \$1 and "agent_ledger"\."period_to" > \$2/)
    assert.equal(new Date(params[0] as any).getTime(), B.getTime())
    assert.equal(new Date(params[1] as any).getTime(), A.getTime())
  })

  it('a line that only touches the window at its boundary does not overlap it', () => {
    assert.equal(overlapsHalfOpen(A, B, B, LATER), false, 'previous period ends where this one starts')
    assert.equal(overlapsHalfOpen(B, LATER, A, B), false, 'next period starts where this one ends')
    assert.equal(overlapsHalfOpen(A, B, A, B), true, 'the same window')
    assert.equal(overlapsHalfOpen(A, LATER, A, B), true, 'a longer window containing it')
    assert.equal(overlapsHalfOpen(Z, B, A, LATER), true, 'a straddling window')
  })
})

describe('shareLinesForExactWindow', () => {
  const line = (over: Partial<Line>): Line => ({
    agentId: AGENT, lineType: 'SHARE', domain: 'sports', periodFrom: A, periodTo: B, amount: 1, createdAt: at('2026-02-11T00:00:00Z'), ...over,
  })

  it('takes only SHARE lines posted for exactly [from, to)', () => {
    const lines = [
      line({ amount: 100 }),
      line({ domain: 'casino', amount: 40 }),
      line({ periodFrom: Z, periodTo: A, amount: 999 }), // previous period
      line({ periodTo: at('2026-02-05T23:59:59.999Z'), amount: 7 }), // shorter, earlier window
      line({ lineType: 'SETTLEMENT', amount: -140 }),
    ]
    const picked = shareLinesForExactWindow(lines, A, B)
    assert.deepEqual(picked.map((l) => l.amount).sort((x, y) => x - y), [40, 100])
  })

  it('counts a domain once when two attempts both posted it (newest wins), so a total is never doubled', () => {
    const lines = [
      line({ amount: 100, createdAt: at('2026-02-11T00:00:00Z') }),
      line({ amount: 120, createdAt: at('2026-02-11T00:00:05Z') }),
    ]
    assert.deepEqual(shareLinesForExactWindow(lines, A, B).map((l) => l.amount), [120])
  })
})

describe('second SHARING settlement', () => {
  const original = AgentSettlementsRepo.prototype.getLastPostedSettlement
  before(() => {
    ;(AgentSettlementsRepo.prototype as any).getLastPostedSettlement = async () => ({ periodFrom: A, periodTo: B })
  })
  after(() => {
    AgentSettlementsRepo.prototype.getLastPostedSettlement = original
  })

  it('after a fully settled period, the next period is open with only its own share', async () => {
    // Period 1: share 1000 owed to the agent, settled in full (SETTLEMENT line +1000).
    const lines: Line[] = [
      { agentId: AGENT, lineType: 'SHARE', domain: 'sports', periodFrom: A, periodTo: B, amount: 1000, createdAt: at('2026-02-10T10:00:00Z') },
      { agentId: AGENT, lineType: 'SETTLEMENT', domain: 'sports', periodFrom: A, periodTo: B, amount: 1000, createdAt: at('2026-02-10T10:00:01Z') },
    ]
    const ledger = fakeLedger(lines, overlapsHalfOpen)
    const { periodFrom, periodTo } = await deriveSinceLastPeriod({
      agentId: AGENT,
      agentCreatedAt: Z,
      whitelabelTimezone: 'Asia/Kolkata',
      ledgerRepo: ledger as any,
      getTotalShareForPeriod: async () => 1000,
    })
    assert.equal(periodFrom.getTime(), B.getTime(), 'period 2 starts where period 1 ended')

    // The old closed-overlap reads find period 1's lines again: nothing left to settle.
    assert.equal(await remainingBefore(fakeLedger(lines, closedOverlap), periodFrom, periodTo), 0)

    // Half-open: period 1's lines are not part of period 2; its own share (250) is settleable.
    assert.equal(await remainingNow(ledger, lines, periodFrom, periodTo, 250), 250)
    assert.equal(Math.abs(await ledger.sumSettlementLinesInPeriod(AGENT, periodFrom, periodTo)), 0)
  })

  it('a partially settled period stays open and settles only what is left of it', async () => {
    // Period 1: share 1400, only 300 settled.
    const lines: Line[] = [
      { agentId: AGENT, lineType: 'SHARE', domain: 'sports', periodFrom: A, periodTo: B, amount: 1400, createdAt: at('2026-02-10T10:00:00Z') },
      { agentId: AGENT, lineType: 'SETTLEMENT', domain: 'sports', periodFrom: A, periodTo: B, amount: 300, createdAt: at('2026-02-10T10:00:01Z') },
      // A settlement of the period before, ending exactly at A: not part of this one.
      { agentId: AGENT, lineType: 'SETTLEMENT', domain: 'sports', periodFrom: Z, periodTo: A, amount: 5000, createdAt: at('2026-01-31T10:00:00Z') },
    ]
    const ledger = fakeLedger(lines, overlapsHalfOpen)
    const { periodFrom, periodTo } = await deriveSinceLastPeriod({
      agentId: AGENT,
      agentCreatedAt: Z,
      whitelabelTimezone: 'Asia/Kolkata',
      ledgerRepo: ledger as any,
      getTotalShareForPeriod: async () => 1400,
    })
    assert.equal(periodFrom.getTime(), A.getTime(), 'not advanced: period 1 is only partly settled')
    assert.ok(periodTo.getTime() > B.getTime(), 'and it now runs to the end of today')

    // The extended window's share is computed afresh (1500 with the later days),
    // and the 300 already settled inside it is subtracted — not the 5000 of the
    // period before, which only touches it at A.
    assert.equal(await remainingNow(ledger, lines, periodFrom, periodTo, 1500), 1200)
  })
})
