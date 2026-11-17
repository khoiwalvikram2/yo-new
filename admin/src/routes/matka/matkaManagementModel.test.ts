import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  BET_TYPES,
  BID_TYPE_OPTIONS,
  bidRuleError,
  bidRuleInput,
  bidRuleMarketKind,
  bidTypeOptionsFor,
  buildMatkaFilters,
  cloneVariables,
  coreTotalsFrom,
  defaultRatesInput,
  drawerStatusFor,
  hydrateRateRows,
  initialBidRuleDraft,
  matkaErrorText,
  matkaStatus,
  patchLimits,
  patchRisk,
  percentage,
  recordChanged,
  reorderMatkaRows,
  reorderMutationInput,
  scheduleSummary,
  scheduleTimeRange,
  scheduleWeekdays,
  settingsPayload,
  sortMatkasByPriority,
  statusLabel,
  statusMutationTarget,
  statusTone,
  subtractMinutes,
  tierPatch,
  toggleCurrentPageSelection,
  toggleMatkaSelection,
  type MatkaRecord,
} from './matkaManagementModel'

function matka(patch: Partial<MatkaRecord> = {}): MatkaRecord {
  return {
    id: 'm1',
    name: 'Kalyan',
    code: 'KLN',
    timezone: 'Asia/Kolkata',
    schedule: {},
    status: 'ACTIVE',
    limits: {},
    visibility: {},
    priority: 1,
    settings: {},
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...patch,
  }
}

describe('matkaManagementModel', () => {
  test('builds the exact paginated filters and keeps the two-character search rule', () => {
    assert.deepEqual(buildMatkaFilters('  ka  ', 'ACTIVE', 3, 50), {
      query: 'ka', status: 'ACTIVE', page: 3, limit: 50,
    })
    assert.deepEqual(buildMatkaFilters(' k ', '', 1, 20), {
      query: undefined, status: undefined, page: 1, limit: 20,
    })
  })

  test('sorts and reorders without mutating the query array', () => {
    const source = [matka({ id: 'b', priority: 2 }), matka({ id: 'a', priority: 1 })]
    assert.deepEqual(sortMatkasByPriority(source).map((item) => item.id), ['a', 'b'])
    assert.deepEqual(source.map((item) => item.id), ['b', 'a'])

    const reordered = reorderMatkaRows(source, 'b', 'a')
    assert.deepEqual(reordered.map(({ id, priority }) => ({ id, priority })), [
      { id: 'a', priority: 1 }, { id: 'b', priority: 2 },
    ])
    assert.deepEqual(reorderMutationInput(reordered), [
      { id: 'a', priority: 1 }, { id: 'b', priority: 2 },
    ])
    assert.deepEqual(reorderMatkaRows(source, 'missing', 'a'), source)
  })

  test('preserves the historical selection semantics across the current page', () => {
    const initial = new Set(['off-page'])
    assert.deepEqual([...toggleMatkaSelection(initial, 'm1')], ['off-page', 'm1'])
    assert.deepEqual([...toggleMatkaSelection(new Set(['m1']), 'm1')], [])
    assert.deepEqual([...toggleCurrentPageSelection(initial, [matka({ id: 'm1' }), matka({ id: 'm2' })])], ['m1', 'm2'])
    assert.deepEqual([...toggleCurrentPageSelection(new Set(['m1', 'm2']), [matka({ id: 'm1' }), matka({ id: 'm2' })])], [])
  })

  test('normalises mixed API/client status spellings and derives statistics', () => {
    assert.equal(matkaStatus(' active '), 'ACTIVE')
    assert.equal(statusLabel('suspend'), 'SUSPEND')
    assert.equal(statusTone('INACTIVE'), 'muted')
    assert.equal(statusTone('unknown'), 'neutral')
    assert.equal(drawerStatusFor('SUSPEND'), 'suspend')
    assert.equal(drawerStatusFor('ACTIVE'), true)
    assert.equal(drawerStatusFor('INACTIVE'), false)
    assert.equal(statusMutationTarget('suspend'), 'SUSPEND')
    assert.equal(statusMutationTarget(true), 'ACTIVE')
    assert.equal(statusMutationTarget(false), 'INACTIVE')
    assert.deepEqual(coreTotalsFrom([
      matka({ status: 'ACTIVE' }), matka({ id: 'm2', status: 'inactive' }), matka({ id: 'm3', status: 'SUSPEND' }),
    ]), { total: 3, active: 1, inactive: 1, suspended: 1 })
    assert.equal(percentage(1, 3), '33%')
    assert.equal(percentage(0, 0), '—')
  })

  test('summarises schedules and wraps cut-off times across midnight', () => {
    assert.equal(scheduleSummary({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }), 'Daily')
    assert.equal(scheduleSummary({ daysOfWeek: [1, 2, 3, 4, 5] }), 'Weekdays')
    assert.equal(scheduleSummary({ daysOfWeek: [0, 6] }), 'Weekend')
    assert.equal(scheduleSummary({ daysOfWeek: [1, 3, 5] }), '3 days/week')
    assert.equal(scheduleSummary(undefined), '—')
    assert.equal(scheduleTimeRange({ openTime: '10:00', closeTime: '12:00' }), '10:00 - 12:00')
    assert.equal(scheduleTimeRange({ openTime: '10:00' }), '—')
    assert.equal(scheduleWeekdays({ daysOfWeek: [0, 2, 6] }), 'Sun, Tue, Sat')
    assert.equal(subtractMinutes('00:10', 20), '23:50')
    assert.equal(subtractMinutes('10:05', 15), '09:50')
    assert.equal(subtractMinutes('bad', 15), '')
  })

  test('collects only supplied settings and preserves all three apply modes', () => {
    const payload = settingsPayload({ minBet: '10', maxBet: '', riskLevel: 'high', riskThreshold: 25 })
    assert.deepEqual(payload, { minBet: '10', riskLevel: 'high', riskThreshold: 25 })

    assert.deepEqual(patchLimits({ minBet: 5, maxBet: 100 }, { minBet: '10', maxBet: 100 }, 'overwrite'), {
      minBet: 10, maxBet: 100,
    })
    assert.deepEqual(patchLimits({ minBet: 5 }, { minBet: 10, maxBet: '100' }, 'fill-empty'), {
      minBet: 5, maxBet: 100,
    })
    assert.deepEqual(patchLimits({ minBet: 5, untouched: true }, { minBet: '10' }, 'replace-all'), {
      minBet: 10, untouched: true,
    })
    assert.deepEqual(patchRisk({ riskLevel: 'low' }, { riskLevel: 'high', riskThreshold: '50' }, 'fill-empty'), {
      riskLevel: 'low', riskThreshold: 50,
    })
    assert.deepEqual(tierPatch({ minBet: '10', riskLevel: 'high' }, 'limits'), { minBet: 10 })
    assert.deepEqual(tierPatch({ minBet: '10', riskLevel: 'high', riskThreshold: '20' }, 'risk'), {
      riskLevel: 'high', riskThreshold: 20,
    })
    assert.equal(recordChanged({ a: 1 }, { a: 1 }), false)
    assert.equal(recordChanged({ a: 1 }, { a: 2 }), true)
  })

  test('hydrates and serialises all ten default-rate rows in the contract order', () => {
    const rows = hydrateRateRows([{ betType: 'JODI', payoutMultiplier: 95, minOdds: 1, maxOdds: 3 }])
    assert.deepEqual(rows.map((row) => row.betType), BET_TYPES.map((item) => item.key))
    assert.deepEqual(rows[0], { betType: 'SINGLE', payoutMultiplier: 0, minOdds: null, maxOdds: null })
    assert.deepEqual(rows[1], { betType: 'JODI', payoutMultiplier: 95, minOdds: 1, maxOdds: 3 })
    assert.deepEqual(defaultRatesInput(rows)[0], { betType: 'JODI', payoutMultiplier: 95, minOdds: 1, maxOdds: 3 })
  })

  test('retains all configured Pana rates when the defaults editor is opened and saved', () => {
    const entries = [
      { betType: 'SINGLE_PANNA', payoutMultiplier: 150, minOdds: null, maxOdds: null },
      { betType: 'DOUBLE_PANNA', payoutMultiplier: 300, minOdds: null, maxOdds: null },
      { betType: 'TRIPLE_PANNA', payoutMultiplier: 1000, minOdds: null, maxOdds: null },
    ]
    assert.deepEqual(defaultRatesInput(hydrateRateRows(entries)), entries)
    const legacy = entries.map(entry => ({ ...entry, betType: entry.betType.replace('_PANNA', '_PAANA') }))
    assert.deepEqual(defaultRatesInput(hydrateRateRows(legacy)), entries)
  })

  test('builds bid-rule and clone mutation variables exactly', () => {
    const draft = { ...initialBidRuleDraft(), bidType: 'JODI', percentage: 25, includeAll: false, includedPlayers: ['u1', 'u2'] }
    assert.equal(bidRuleError(initialBidRuleDraft()), 'Please select bid type')
    assert.equal(bidRuleError({ ...initialBidRuleDraft(), bidType: 'JODI' }), 'Please enter percentage')
    assert.equal(bidRuleError(draft), null)
    assert.deepEqual(bidRuleInput(matka(), draft), {
      matkaId: 'm1',
      matkaType: 'worli',
      marketName: 'Kalyan',
      marketSession: null,
      bidType: 'JODI',
      percentage: 25,
      includeAll: false,
      includedPlayers: { playerIds: ['u1', 'u2'] },
      minStake: null,
      maxStake: null,
      exposureCap: null,
      status: 'active',
      notes: null,
    })
    assert.deepEqual(cloneVariables(matka()), { id: 'm1', name: 'Kalyan Copy', code: 'KLN-copy' })
    // The rule names the market's own kind rather than always "worli".
    assert.equal(bidRuleInput(matka({ settings: { matkaType: 'starline' } }), draft).matkaType, 'starline')
  })

  test('offers only the bid types the server accepts for the market kind (allowedBids in shared/src/matka/rules.ts)', () => {
    const values = (settings: unknown) => bidTypeOptionsFor(settings).map((option) => option.value)
    const worli = ['SINGLE', 'JODI', 'SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA', 'HALF_SANGAM', 'FULL_SANGAM']
    // A Worli market offered Satta AB, A and B too; the server refused them ("This bid type is unavailable for the market").
    assert.deepEqual(values({ matkaType: 'worli' }), worli)
    assert.deepEqual(values({}), worli, 'an unset kind is Worli, as the server reads it')
    assert.deepEqual(values(null), worli)
    assert.deepEqual(values({ matkaType: 'WORLI' }), worli)
    assert.deepEqual(values({ matkaType: 'starline' }), ['SINGLE', 'SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA'])
    assert.deepEqual(values({ matkaType: 'jackpot' }), ['JODI'])
    for (const kind of ['sattaMatka', 'sattamatka', 'satta_matka']) assert.deepEqual(values({ matkaType: kind }), ['AB', 'A', 'B'], kind)
    assert.deepEqual(bidTypeOptionsFor({ matkaType: 'sattaMatka' }), [
      { value: 'AB', label: 'Satta AB' }, { value: 'A', label: 'Satta A' }, { value: 'B', label: 'Satta B' },
    ])
    // A kind the server does not know keeps the full list; the server's refusal names the problem.
    assert.equal(bidRuleMarketKind({ matkaType: 'bogus' }), null)
    assert.deepEqual(bidTypeOptionsFor({ matkaType: 'bogus' }), BID_TYPE_OPTIONS)
  })

  test('a refused mutation reports the server reason, never a driver error', () => {
    const fallback = 'The bid configuration could not be created.'
    const refused = Object.assign(new Error('Response not successful'), { graphQLErrors: [{ message: 'Bid percentage must be between 0 and 100' }] })
    assert.equal(matkaErrorText(refused, fallback), 'Bid percentage must be between 0 and 100')
    assert.equal(matkaErrorText(new Error('Network down'), fallback), 'Network down')
    const driver = { graphQLErrors: [{ message: 'Failed query: insert into "matka_bid_rules" ("id") values ($1)\nparams: 7' }] }
    assert.equal(matkaErrorText(driver, fallback), fallback)
    assert.equal(matkaErrorText(null, fallback), fallback)
  })
})
