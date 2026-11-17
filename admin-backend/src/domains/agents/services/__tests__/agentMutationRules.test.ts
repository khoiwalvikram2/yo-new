/**
 * Pure rules behind the agent mutation guards (services/agentMutationRules.ts)
 * and the agent access verdict (AgentPermissionsService.agentAccessVerdict).
 * No database.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertLevelAllowed,
  assertDomainsWithinParent,
  domainsOutsideParent,
  removedDomains,
  restrictedAgentFieldChanges,
  rateAt,
  governingWindow,
  rateChangePoints,
  firstCapBreach,
  firstChildAbove,
  firstRatePeriodStart,
  clampFirstRateEffectiveFrom,
  tallyIsOn,
  isRedundantRateRow,
  type RateRow,
} from '../agentMutationRules.js'
import { agentAccessVerdict } from '../AgentPermissionsService.js'

const d = (iso: string) => new Date(iso)
const row = (from: string, rate: number, to: string | null = null): RateRow => ({
  effectiveFrom: d(from),
  effectiveTo: to ? d(to) : null,
  rate,
})

describe('assertLevelAllowed', () => {
  it('caps SHARING and CREDIT at level 4', () => {
    assert.doesNotThrow(() => assertLevelAllowed('SHARING', 4))
    assert.throws(() => assertLevelAllowed('SHARING', 5), /Maximum hierarchy depth/)
    assert.throws(() => assertLevelAllowed('CREDIT', 5), /Maximum hierarchy depth/)
  })
  it('leaves COMMISSION unlimited, so agents deeper than 4 stay editable', () => {
    assert.doesNotThrow(() => assertLevelAllowed('COMMISSION', 6))
    assert.doesNotThrow(() => assertLevelAllowed('COMMISSION', 12))
  })
  it('refuses levels below 1 for every scheme', () => {
    assert.throws(() => assertLevelAllowed('COMMISSION', 0), /at least 1/)
    assert.throws(() => assertLevelAllowed('SHARING', -1), /at least 1/)
  })
})

describe('domain subset rule', () => {
  it('accepts a subset of the parent domains', () => {
    assert.doesNotThrow(() => assertDomainsWithinParent(['sports'], ['sports', 'casino']))
    assert.doesNotThrow(() => assertDomainsWithinParent([], ['sports']))
  })
  it('refuses a domain the parent lacks', () => {
    assert.deepEqual(domainsOutsideParent(['sports', 'matka'], ['sports']), ['matka'])
    assert.throws(() => assertDomainsWithinParent(['sports', 'matka'], ['sports']), /'matka' is not allowed/)
  })
  it('reports what a narrowing removes, and nothing when domains are not sent', () => {
    assert.deepEqual(removedDomains(['sports', 'casino', 'matka'], ['sports']), ['casino', 'matka'])
    assert.deepEqual(removedDomains(['sports'], ['sports', 'casino']), [])
    assert.deepEqual(removedDomains(['sports'], undefined), [])
  })
})

describe('restrictedAgentFieldChanges', () => {
  const current = { levelIndex: 2, tallyEnabled: false, tallyDomains: ['sports'] }
  it('ignores echoed, unchanged values', () => {
    assert.deepEqual(restrictedAgentFieldChanges(current, { levelIndex: 2, tallyEnabled: false, tallyDomains: ['sports'] }), [])
    assert.deepEqual(restrictedAgentFieldChanges(current, {}), [])
  })
  it('names level and tally changes', () => {
    assert.deepEqual(restrictedAgentFieldChanges(current, { levelIndex: 3 }), ['levelIndex'])
    assert.deepEqual(restrictedAgentFieldChanges(current, { tallyEnabled: true, tallyDomains: ['casino'] }), [
      'tallyEnabled',
      'tallyDomains',
    ])
  })
})

describe('rate history resolution', () => {
  const rows = [row('2026-01-01T00:00:00Z', 0.3), row('2026-03-01T00:00:00Z', 0.2)]
  it('resolves like AgentConfigsRepo: latest started row wins', () => {
    assert.equal(rateAt(rows, d('2025-12-31T00:00:00Z')), null)
    assert.equal(rateAt(rows, d('2026-02-01T00:00:00Z')), 0.3)
    assert.equal(rateAt(rows, d('2026-04-01T00:00:00Z')), 0.2)
  })
  it('honours effectiveTo', () => {
    assert.equal(rateAt([row('2026-01-01T00:00:00Z', 0.3, '2026-02-01T00:00:00Z')], d('2026-02-02T00:00:00Z')), null)
  })
  it('a new row governs until the next own row', () => {
    const w = governingWindow(rows, d('2026-02-01T00:00:00Z'), null)
    assert.equal(w.end?.toISOString(), '2026-03-01T00:00:00.000Z')
    assert.equal(governingWindow(rows, d('2026-04-01T00:00:00Z'), null).end, null)
  })
  it('collects the other side change points inside the window', () => {
    const pts = rateChangePoints({ start: d('2026-01-15T00:00:00Z'), end: null }, rows).map((p) => p.toISOString())
    assert.deepEqual(pts, ['2026-01-15T00:00:00.000Z', '2026-03-01T00:00:00.000Z'])
  })
})

describe('cap checks over the governing window', () => {
  const parent = [row('2026-01-01T00:00:00Z', 0.3), row('2026-06-01T00:00:00Z', 0.2)]
  it('checks the cap at effectiveFrom, not now: a future-dated child row meets the future parent rate', () => {
    // Allowed today (parent 30%), refused from June when the parent drops to 20%.
    const breach = firstCapBreach({
      rate: 0.25,
      window: { start: d('2026-07-01T00:00:00Z'), end: null },
      parentRows: parent,
      fallbackCap: undefined,
    })
    assert.equal(breach?.source, 'parent')
    assert.equal(breach?.cap, 0.2)
  })
  it('catches a parent drop inside the window', () => {
    const breach = firstCapBreach({
      rate: 0.25,
      window: { start: d('2026-02-01T00:00:00Z'), end: null },
      parentRows: parent,
      fallbackCap: undefined,
    })
    assert.equal(breach?.at.toISOString(), '2026-06-01T00:00:00.000Z')
  })
  it('a parent without a rate falls back to the whitelabel cap', () => {
    const over = firstCapBreach({ rate: 0.5, window: { start: d('2026-01-01T00:00:00Z'), end: null }, parentRows: [], fallbackCap: 0.4 })
    assert.equal(over?.source, 'whitelabel')
    const ok = firstCapBreach({ rate: 0.4, window: { start: d('2026-01-01T00:00:00Z'), end: null }, parentRows: [], fallbackCap: 0.4 })
    assert.equal(ok, null)
    const missing = firstCapBreach({ rate: 0.1, window: { start: d('2026-01-01T00:00:00Z'), end: null }, parentRows: [], fallbackCap: null })
    assert.equal(missing?.cap, null)
  })
  it('refuses lowering a parent below a direct child', () => {
    const child = [row('2026-01-01T00:00:00Z', 0.25)]
    const hit = firstChildAbove({ rate: 0.2, window: { start: d('2026-02-01T00:00:00Z'), end: null }, childRows: child })
    assert.equal(hit?.childRate, 0.25)
    assert.equal(firstChildAbove({ rate: 0.25, window: { start: d('2026-02-01T00:00:00Z'), end: null }, childRows: child }), null)
  })
})

describe('first rate config is back-dated to the first period', () => {
  const createdAt = d('2026-10-21T10:00:00+05:30') // a Wednesday
  it('SHARING/CREDIT: start of the creation day in IST', () => {
    assert.equal(firstRatePeriodStart('SHARING', createdAt).toISOString(), d('2026-10-21T00:00:00+05:30').toISOString())
    assert.equal(firstRatePeriodStart('CREDIT', createdAt, 'Asia/Kolkata').toISOString(), d('2026-10-21T00:00:00+05:30').toISOString())
  })
  it('SHARING: the earlier day start when the whitelabel settles in another zone', () => {
    const early = d('2026-10-21T03:00:00+05:30') // still 20 Oct in UTC
    assert.equal(firstRatePeriodStart('SHARING', early, 'UTC').toISOString(), '2026-10-20T00:00:00.000Z')
  })
  it('COMMISSION: Monday 00:00 IST of the creation cycle', () => {
    assert.equal(firstRatePeriodStart('COMMISSION', createdAt).toISOString(), d('2026-10-19T00:00:00+05:30').toISOString())
  })
  it('clamps only the first row', () => {
    const periodStart = d('2026-10-21T00:00:00+05:30')
    const requested = d('2026-10-21T15:00:00+05:30')
    assert.equal(
      clampFirstRateEffectiveFrom({ requested, earliestExisting: null, periodStart }).toISOString(),
      periodStart.toISOString()
    )
    // A later rate change keeps its own date.
    assert.equal(
      clampFirstRateEffectiveFrom({ requested, earliestExisting: periodStart, periodStart }).toISOString(),
      requested.toISOString()
    )
    // A row back-dated before the period start is not moved forward.
    const earlier = d('2026-10-01T00:00:00Z')
    assert.equal(clampFirstRateEffectiveFrom({ requested: earlier, earliestExisting: null, periodStart }).toISOString(), earlier.toISOString())
  })
})

describe('agentAccessVerdict (owner decision 1)', () => {
  it('lets an ACTIVE agent with ACTIVE ancestors in, read-write', () => {
    assert.deepEqual(agentAccessVerdict('ACTIVE', []), { allowed: true, isReadOnly: false })
  })
  it('keeps the agent itself SUSPENDED or BLOCKED out', () => {
    assert.equal(agentAccessVerdict('SUSPENDED', []).allowed, false)
    assert.equal(agentAccessVerdict('BLOCKED', []).allowed, false)
  })
  it('blocks the whole subtree of a SUSPENDED or BLOCKED ancestor', () => {
    assert.deepEqual(agentAccessVerdict('ACTIVE', ['SUSPENDED']), { allowed: false, isReadOnly: true, reason: 'ancestor_suspended' })
    assert.equal(agentAccessVerdict('ACTIVE', ['INACTIVE', 'BLOCKED']).allowed, false)
  })
  it('makes the subtree of an INACTIVE ancestor read-only, as INACTIVE is for the agent itself', () => {
    assert.deepEqual(agentAccessVerdict('ACTIVE', ['INACTIVE']), { allowed: true, isReadOnly: true })
    assert.deepEqual(agentAccessVerdict('INACTIVE', []), { allowed: true, isReadOnly: true })
  })
})

describe('tallyIsOn (the tally the commission engine applies)', () => {
  it('is on only with the flag and at least one domain', () => {
    assert.equal(tallyIsOn(true, ['sports']), true)
    assert.equal(tallyIsOn(true, ['casino', 'matka']), true)
    assert.equal(tallyIsOn(true, []), false, 'a flag with nothing to tally pays as off')
    assert.equal(tallyIsOn(true, null), false)
    assert.equal(tallyIsOn(false, ['sports', 'casino']), false)
    assert.equal(tallyIsOn(undefined, ['sports']), false)
  })
  it('counts only the three domains, as applyTallyRulesForSettlement does', () => {
    assert.equal(tallyIsOn(true, ['poker']), false)
    assert.equal(tallyIsOn(true, ['poker', 'matka']), true)
  })
})

describe('isRedundantRateRow (re-saving the rate in force adds no row)', () => {
  const open = [row('2026-10-01T00:00:00Z', 0.02)]
  it('the same rate again, open-ended, after the open row in force, is redundant', () => {
    assert.equal(isRedundantRateRow(open, { effectiveFrom: d('2026-11-02T19:13:23Z'), effectiveTo: null, rate: 0.02 }), true)
    assert.equal(isRedundantRateRow(open, { effectiveFrom: d('2026-11-02T19:13:23Z'), effectiveTo: null, rate: 0.020000000001 }), true, 'float noise is not a new rate')
  })
  it('a new rate, an end date, or no row in force is a real change', () => {
    assert.equal(isRedundantRateRow(open, { effectiveFrom: d('2026-11-02T00:00:00Z'), effectiveTo: null, rate: 0.025 }), false)
    assert.equal(isRedundantRateRow(open, { effectiveFrom: d('2026-11-02T00:00:00Z'), effectiveTo: d('2026-12-01T00:00:00Z'), rate: 0.02 }), false)
    assert.equal(isRedundantRateRow([], { effectiveFrom: d('2026-11-02T00:00:00Z'), effectiveTo: null, rate: 0.02 }), false)
  })
  it('a re-dated row is not swallowed: one dated before the row in force, or with a later row after it', () => {
    assert.equal(isRedundantRateRow(open, { effectiveFrom: d('2026-09-01T00:00:00Z'), effectiveTo: null, rate: 0.02 }), false)
    const withFuture = [row('2026-10-01T00:00:00Z', 0.02), row('2026-12-01T00:00:00Z', 0.03)]
    assert.equal(isRedundantRateRow(withFuture, { effectiveFrom: d('2026-11-02T00:00:00Z'), effectiveTo: null, rate: 0.02 }), false)
  })
  it('a row in force that has an end is not extended silently', () => {
    const ending = [row('2026-10-01T00:00:00Z', 0.02, '2026-12-31T00:00:00Z')]
    assert.equal(isRedundantRateRow(ending, { effectiveFrom: d('2026-11-02T00:00:00Z'), effectiveTo: null, rate: 0.02 }), false)
  })
})
