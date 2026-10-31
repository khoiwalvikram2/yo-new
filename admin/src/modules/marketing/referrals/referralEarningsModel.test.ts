import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  EARNINGS_DATE_PRESETS,
  RULE_TYPE_FILTER_OPTIONS,
  TIER_FILTER_OPTIONS,
  applyColumnFilters,
  columnFilterCount,
  displayedEarnings,
  earningsDatePreset,
  earningsEmptyTitle,
  earningsFilterCount,
  earningsQueryVariables,
  earningsTotalLabel,
  earningsTotals,
  hasEarningsFilters,
  mergeRefereeOptions,
  mergeReferrerOptions,
  pageOf,
  refereeEmptyText,
  refereeLoading,
  refereePlaceholder,
  referrerEmptyText,
  ruleTypeText,
  searchKeyAction,
  sortEarnings,
  tierText,
  userToOption,
  type ReferralEarning,
} from './referralEarningsModel'

function earning(id: string, overrides: Partial<ReferralEarning> = {}): ReferralEarning {
  return {
    id,
    referrerId: 1,
    refereeId: 2,
    referrerName: 'Vijay',
    referrerPhone: '9876500001',
    refereeName: 'Sunita',
    refereePhone: '9876500002',
    tier: 1,
    ruleType: 'SIGNUP_CPA',
    grossAmount: 100,
    netAmount: 90,
    currency: 'INR',
    calculatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

describe('people and the search fields', () => {
  test('an option reads name · phone, falling back to the id', () => {
    assert.deepEqual(userToOption({ id: 7, name: 'Ravi', phone: '98765' }), { value: '7', label: 'Ravi · 98765' })
    assert.deepEqual(userToOption({ id: 8, name: 'Ravi', phone: null }), { value: '8', label: 'Ravi' })
    assert.deepEqual(userToOption({ id: 9, name: null, phone: null }), { value: '9', label: '9' })
  })

  test('referrer options: the chosen one, the one found through a referee, then results, each once', () => {
    const chosen = { value: '1', label: 'A' }
    const viaReferee = { value: '2', label: 'B' }
    assert.deepEqual(
      mergeReferrerOptions(chosen, viaReferee, [{ value: '2', label: 'B2' }, { value: '3', label: 'C' }]),
      [chosen, viaReferee, { value: '3', label: 'C' }],
    )
    assert.deepEqual(mergeReferrerOptions(null, null, []), [])
  })

  test('referee options keep the chosen referee listed', () => {
    const chosen = { value: '5', label: 'E' }
    assert.deepEqual(mergeRefereeOptions(chosen, [{ value: '6', label: 'F' }]), [chosen, { value: '6', label: 'F' }])
    assert.deepEqual(mergeRefereeOptions(chosen, [chosen]), [chosen])
    assert.deepEqual(mergeRefereeOptions(null, [chosen]), [chosen])
  })

  test('the legacy empty, loading and placeholder copy', () => {
    assert.equal(referrerEmptyText('ra'), 'Type 3+ chars')
    assert.equal(referrerEmptyText('  ram '), 'No users found')
    assert.equal(refereePlaceholder(undefined), 'Referee (search name or phone)')
    assert.equal(refereePlaceholder('4'), "Referee (this referrer's referrals)")
    const idle = { refereesLoading: false, usersSearchLoading: false, search: '', referrerId: undefined }
    assert.equal(refereeEmptyText(idle), 'Type 3+ chars')
    assert.equal(refereeEmptyText({ ...idle, referrerId: '4' }), 'No referees')
    assert.equal(refereeEmptyText({ ...idle, search: 'sun' }), 'No one found')
    assert.equal(refereeEmptyText({ ...idle, referrerId: '4', search: 'sun' }), 'No one found')
    assert.equal(refereeEmptyText({ ...idle, refereesLoading: true }), null)
    assert.equal(refereeEmptyText({ ...idle, usersSearchLoading: true }), null)
    assert.equal(refereeLoading({ ...idle, usersSearchLoading: true }), false)
    assert.equal(refereeLoading({ ...idle, usersSearchLoading: true, search: 'sun' }), true)
    assert.equal(refereeLoading({ ...idle, usersSearchLoading: true, search: 'sun', referrerId: '4' }), false)
    assert.equal(refereeLoading({ ...idle, refereesLoading: true }), true)
  })

  test('Enter or Tab picks the first person only when the list is open and nothing is active', () => {
    const open = { listOpen: true, optionActive: false, hasOptions: true }
    assert.equal(searchKeyAction('Enter', open), 'pickFirst')
    assert.equal(searchKeyAction('Tab', open), 'pickFirst')
    assert.equal(searchKeyAction('ArrowDown', open), 'none')
    assert.equal(searchKeyAction('Enter', { ...open, optionActive: true }), 'none')
    assert.equal(searchKeyAction('Enter', { ...open, listOpen: false }), 'none')
    assert.equal(searchKeyAction('Enter', { ...open, hasOptions: false }), 'none')
  })
})

describe('filters and variables', () => {
  test('no filter sends every variable undefined, in the legacy order', () => {
    const variables = earningsQueryVariables({})
    assert.deepEqual(Object.keys(variables), ['referrerId', 'refereeId', 'ruleType', 'tier', 'fromDate', 'toDate'])
    assert.deepEqual(Object.values(variables), [undefined, undefined, undefined, undefined, undefined, undefined])
  })

  test('ids are trimmed, and a date range is the IST start of its first day to the IST end of its last', () => {
    assert.deepEqual(
      earningsQueryVariables({
        referrerId: ' 12 ',
        refereeId: '',
        ruleType: 'SIGNUP_CPA',
        dateRange: { from: '2026-09-22', to: '2026-09-30' },
      }),
      {
        referrerId: '12',
        refereeId: undefined,
        ruleType: 'SIGNUP_CPA',
        tier: undefined,
        fromDate: '2026-09-21T18:30:00.000Z',
        toDate: '2026-09-30T18:29:59.999Z',
      },
    )
  })

  test('each filter counts once; a range is one filter', () => {
    assert.equal(earningsFilterCount({}), 0)
    assert.equal(hasEarningsFilters({}), false)
    assert.equal(earningsFilterCount({ referrerId: '', ruleType: '' }), 0)
    assert.equal(
      earningsFilterCount({
        referrerId: '1', refereeId: '2', ruleType: 'SIGNUP_CPA', tier: 0, dateRange: { from: '2026-09-01', to: '2026-09-02' },
      }),
      5,
    )
    assert.equal(hasEarningsFilters({ dateRange: { from: '2026-09-01', to: '2026-09-02' } }), true)
  })

  test('date presets: All dates is the unfiltered state', () => {
    assert.deepEqual(EARNINGS_DATE_PRESETS.map((preset) => preset.label), ['All dates', 'Custom range'])
    assert.equal(earningsDatePreset(undefined), 'all')
    assert.equal(earningsDatePreset({ from: '2026-09-01', to: '2026-09-02' }), 'custom')
  })
})

describe('the table', () => {
  test('REVSHARE is never listed', () => {
    const rows = [earning('1'), earning('2', { ruleType: 'REVSHARE' })]
    assert.deepEqual(displayedEarnings(rows).map((row) => row.id), ['1'])
  })

  test('the column filters: any chosen tier, any chosen rule type, both together', () => {
    const rows = [
      earning('1', { tier: 1, ruleType: 'SIGNUP_CPA' }),
      earning('2', { tier: 2, ruleType: 'FIRST_DEPOSIT_PCT' }),
      earning('3', { tier: 2, ruleType: 'SIGNUP_CPA' }),
    ]
    const ids = (tiers: string[], ruleTypes: string[]) =>
      applyColumnFilters(rows, { tiers, ruleTypes }).map((row) => row.id)
    assert.deepEqual(ids([], []), ['1', '2', '3'])
    assert.deepEqual(ids(['2'], []), ['2', '3'])
    assert.deepEqual(ids([], ['SIGNUP_CPA']), ['1', '3'])
    assert.deepEqual(ids(['1', '2'], ['FIRST_DEPOSIT_PCT']), ['2'])
    assert.equal(columnFilterCount({ tiers: ['1'], ruleTypes: [] }), 1)
    assert.equal(columnFilterCount({ tiers: ['1'], ruleTypes: ['SIGNUP_CPA'] }), 2)
    assert.deepEqual(TIER_FILTER_OPTIONS.map((option) => option.label), ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5'])
    assert.deepEqual(RULE_TYPE_FILTER_OPTIONS.map((option) => option.value), [
      'SIGNUP_CPA', 'FIRST_DEPOSIT_PCT', 'RELOAD_DEPOSITS_PCT', 'DEPOSITS_WINDOW_PCT', 'ACTIVITY_MILESTONE',
    ])
  })

  test('the legacy sorters, ascending and descending, stable, and no sort keeps the server order', () => {
    const rows = [
      earning('1', { referrerName: 'Meera', refereeName: null, tier: 2, grossAmount: '50', netAmount: 45, calculatedAt: '2026-10-02T00:00:00Z' }),
      earning('2', { referrerName: null, refereeName: 'Arif', tier: 1, grossAmount: 300, netAmount: '290', calculatedAt: null }),
      earning('3', { referrerName: 'Arjun', refereeName: 'Zoya', tier: 2, grossAmount: 120, netAmount: 100, calculatedAt: '2026-09-30T00:00:00Z' }),
    ]
    const order = (key: string, dir: 'asc' | 'desc' = 'asc') => sortEarnings(rows, { key, dir }).map((row) => row.id)
    assert.deepEqual(order('referrer'), ['2', '3', '1'])
    assert.deepEqual(order('referrer', 'desc'), ['1', '3', '2'])
    assert.deepEqual(order('referee'), ['1', '2', '3'])
    assert.deepEqual(order('tier'), ['2', '1', '3'])
    assert.deepEqual(order('grossAmount'), ['1', '3', '2'])
    assert.deepEqual(order('netAmount', 'desc'), ['2', '3', '1'])
    assert.deepEqual(order('calculatedAt'), ['2', '3', '1'])
    assert.deepEqual(sortEarnings(rows, null).map((row) => row.id), ['1', '2', '3'])
    assert.deepEqual(sortEarnings(rows, { key: 'ruleType', dir: 'asc' }).map((row) => row.id), ['1', '2', '3'])
  })

  test('a page of rows, a page past the end showing the last one, and the legacy total text', () => {
    const rows = Array.from({ length: 45 }, (_, index) => index + 1)
    assert.deepEqual(pageOf(rows, 1, 20), rows.slice(0, 20))
    assert.deepEqual(pageOf(rows, 3, 20), [41, 42, 43, 44, 45])
    assert.deepEqual(pageOf(rows, 9, 20), [41, 42, 43, 44, 45])
    assert.deepEqual(pageOf([], 4, 20), [])
    assert.equal(earningsTotalLabel(45), 'Total 45 earnings')
  })

  test('totals over the listed rows in the first row’s currency', () => {
    assert.deepEqual(
      earningsTotals([
        earning('1', { netAmount: '90.5', grossAmount: 100, currency: 'AED' }),
        earning('2', { netAmount: null, grossAmount: '25.25', currency: 'INR' }),
      ]),
      { net: 90.5, gross: 125.25, count: 2, currency: 'AED' },
    )
    assert.deepEqual(earningsTotals([]), { net: 0, gross: 0, count: 0, currency: 'INR' })
  })

  test('cell text and the empty title', () => {
    assert.equal(tierText(3), 'L3')
    assert.equal(tierText(null), '—')
    assert.equal(ruleTypeText('FIRST_DEPOSIT_PCT'), 'FIRST DEPOSIT PCT')
    assert.equal(ruleTypeText(null), '—')
    assert.equal(earningsEmptyTitle(true), 'No earnings match your filters')
    assert.equal(earningsEmptyTitle(false), 'No earnings data available')
  })
})
