import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  CONFIRM_LABELS,
  END_CONFIRM,
  DOMAIN_FILTER_OPTIONS,
  EMPTY_BONUS_FILTERS,
  STATUS_FILTER_OPTIONS,
  TYPE_FILTER_OPTIONS,
  activeBonusFilterCount,
  activeShareNote,
  bonusAmountDisplay,
  bonusAmountTypeLabel,
  bonusCampaignStats,
  bonusDisplayStatusKey,
  bonusDisplayStatusLabel,
  bonusDomainLabel,
  bonusExportColumns,
  bonusPageSlice,
  bonusPlayersCell,
  bonusStatusAction,
  bonusStatusKey,
  bonusStatusLabel,
  buildBonusCampaignsVariables,
  campaignCountLabel,
  canDistribute,
  canEnd,
  distributeBlocked,
  distributedMessage,
  formatBonusType,
  formatDistributionType,
  isDistributed,
  isPastEnd,
  pausedShareNote,
  type BonusCampaignRow,
} from './bonusesListModel'
import { OFFERED_BONUS_TYPES } from './bonusCreateModel'

function campaign(overrides: Partial<BonusCampaignRow> = {}): BonusCampaignRow {
  return {
    id: '7',
    name: 'Welcome 100%',
    domain: 'sports',
    type: 'deposit',
    status: 'active',
    budgetNumeric: 50000,
    currency: 'INR',
    distributionType: 'roll_over',
    amountType: 'fixed',
    amount: 1000,
    percentage: null,
    numberOfPlayers: null,
    usagePerPlayer: 1,
    startDate: '2026-09-22T09:00:00.000Z',
    endDate: null,
    distributedAt: null,
    ...overrides,
  }
}

const formatAmount = (amount: number, currency?: string) => `${currency ?? '?'} ${amount.toFixed(2)}`

describe('bonusesListModel', () => {
  test('builds the legacy variables: unset filters left out, lower-cased enums, a trimmed search', () => {
    assert.deepEqual(buildBonusCampaignsVariables(EMPTY_BONUS_FILTERS), {})
    assert.deepEqual(
      buildBonusCampaignsVariables({ search: '  diwali  ', status: 'Active', domain: 'Casino', type: 'direct_amount' }),
      { status: 'active', domain: 'casino', type: 'direct_amount', search: 'diwali' },
    )
    // Key order follows the legacy memo: status, domain, type, search.
    assert.deepEqual(
      Object.keys(buildBonusCampaignsVariables({ search: 'x', status: 'draft', domain: 'global', type: 'signup' })),
      ['status', 'domain', 'type', 'search'],
    )
    assert.deepEqual(buildBonusCampaignsVariables({ ...EMPTY_BONUS_FILTERS, search: '   ' }), {})
  })

  test('counts each set filter once, a whitespace search included, as the legacy badge did', () => {
    assert.equal(activeBonusFilterCount(EMPTY_BONUS_FILTERS), 0)
    assert.equal(activeBonusFilterCount({ search: ' ', status: 'draft', domain: '', type: 'signup' }), 3)
    assert.equal(activeBonusFilterCount({ search: 'a', status: 'a', domain: 'a', type: 'a' }), 4)
  })

  test('keeps the legacy status and domain lists behind an "All" choice', () => {
    assert.deepEqual(STATUS_FILTER_OPTIONS.map((option) => option.value), ['', 'draft', 'active', 'paused', 'ended'])
    assert.deepEqual(DOMAIN_FILTER_OPTIONS.map((option) => option.label), [
      'All domains', 'Sports', 'Casino', 'Matka', 'Global',
    ])
  })

  test('filters by every type the create form offers, labelled as the table labels it (MAR-03)', () => {
    assert.deepEqual(TYPE_FILTER_OPTIONS.map((option) => [option.value, option.label]), [
      ['', 'All types'],
      ['deposit', 'Deposit'],
      ['daily_first_deposit', 'First Day First Time Deposit'],
      ['signup', 'Signup'],
      ['direct_amount', 'Direct Bonus'],
      ['losing_bonus', 'Losing Bonus'],
      ['special', 'Special Bonus'],
    ])
    assert.deepEqual(TYPE_FILTER_OPTIONS.slice(1).map((option) => option.value), [...OFFERED_BONUS_TYPES])
  })

  test('slices client-side pages and clamps a page past the end to the last page', () => {
    const rows = Array.from({ length: 23 }, (_, index) => index + 1)
    assert.deepEqual(bonusPageSlice(rows, 1, 10), { rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page: 1 })
    assert.deepEqual(bonusPageSlice(rows, 3, 10), { rows: [21, 22, 23], page: 3 })
    assert.deepEqual(bonusPageSlice(rows, 9, 10), { rows: [21, 22, 23], page: 3 })
    assert.deepEqual(bonusPageSlice(rows, 2, 25), { rows, page: 1 })
    assert.deepEqual(bonusPageSlice([], 4, 10), { rows: [], page: 1 })
    assert.deepEqual(bonusPageSlice(rows, 0, 10).page, 1)
  })

  test('computes the legacy statistics, budgets as numbers or strings', () => {
    const stats = bonusCampaignStats([
      { status: 'active', budgetNumeric: 1000 },
      { status: 'active', budgetNumeric: '2500.50' },
      { status: 'draft', budgetNumeric: null },
      { status: 'paused', budgetNumeric: 0 },
      { status: 'ended' },
      { status: 'ended', budgetNumeric: '' },
    ])
    assert.deepEqual(stats, { total: 6, active: 2, expired: 0, draft: 1, paused: 1, totalBudget: 3500.5, activeRate: 33 })
    assert.equal(pausedShareNote(stats), '17% of total')
    assert.equal(activeShareNote(stats), '2 campaigns, 6 total')
    const none = bonusCampaignStats([])
    assert.deepEqual(none, { total: 0, active: 0, expired: 0, draft: 0, paused: 0, totalBudget: 0, activeRate: 0 })
    assert.equal(pausedShareNote(none), '—')
  })

  test('counts an active campaign past its end date apart from the live ones (MAR-18)', () => {
    const now = Date.parse('2026-11-03T08:00:00.000Z')
    const stats = bonusCampaignStats([
      { status: 'active', endDate: '2026-03-14T18:30:00.000Z' },
      { status: 'active', endDate: '2026-10-15T18:29:59.999Z' },
      { status: 'active', endDate: '2030-01-31T13:00:00.000Z' },
      { status: 'active', endDate: null },
      { status: 'ended', endDate: '2026-01-01T00:00:00.000Z' },
    ], now)
    assert.deepEqual([stats.active, stats.expired, stats.total, stats.activeRate], [2, 2, 5, 40])
    assert.equal(activeShareNote(stats), '2 past end date, 5 total')

    assert.equal(isPastEnd({ status: 'active', endDate: '2026-11-03T07:59:59.000Z' }, now), true)
    assert.equal(isPastEnd({ status: 'active', endDate: '2026-11-03T08:00:01.000Z' }, now), false)
    assert.equal(isPastEnd({ status: 'paused', endDate: '2026-01-01T00:00:00.000Z' }, now), false, 'only an active campaign expires')
    assert.equal(isPastEnd({ status: 'active', endDate: 'not a date' }, now), false)

    const expired = { status: 'active', endDate: '2026-03-14T18:30:00.000Z' }
    assert.deepEqual([bonusDisplayStatusKey(expired, now), bonusDisplayStatusLabel(expired, now)], ['expired', 'Expired'])
    assert.deepEqual([bonusDisplayStatusKey({ status: 'active' }, now), bonusDisplayStatusLabel({ status: 'archived' }, now)], ['active', 'Ended'])
  })

  test('reads Active, Draft and Paused by name and every other status as Ended', () => {
    assert.deepEqual(['active', 'draft', 'paused', 'ended', 'archived'].map(bonusStatusKey), [
      'active', 'draft', 'paused', 'ended', 'ended',
    ])
    assert.deepEqual(['active', 'draft', 'paused', 'ended', ''].map(bonusStatusLabel), [
      'Active', 'Draft', 'Paused', 'Ended', 'Ended',
    ])
  })

  test('labels types, distributions and domains as the legacy cells did', () => {
    assert.equal(formatBonusType('direct_amount'), 'Direct Bonus')
    assert.equal(formatBonusType('losing_bonus'), 'Losing Bonus')
    assert.equal(formatBonusType('special'), 'Special Bonus')
    assert.equal(formatBonusType('daily_first_deposit'), 'First Day First Time Deposit')
    assert.equal(formatBonusType('referral_deposit'), 'Referral Deposit')
    assert.equal(formatBonusType('deposit_match'), 'Deposit Match')
    assert.equal(formatDistributionType('instant_otp'), 'Instant Otp')
    assert.equal(formatDistributionType(null), '—')
    assert.equal(formatDistributionType(''), '—')
    assert.equal(bonusDomainLabel('global'), 'All')
    assert.equal(bonusDomainLabel('casino'), 'CASINO')
  })

  test('shows the amount and its type caption', () => {
    assert.equal(bonusAmountDisplay(campaign(), formatAmount), 'INR 1000.00')
    assert.equal(bonusAmountDisplay(campaign({ amount: null }), formatAmount), 'INR 0.00')
    assert.equal(bonusAmountDisplay(campaign({ amountType: 'percentage', percentage: 12.5 }), formatAmount), '12.5%')
    assert.equal(bonusAmountDisplay(campaign({ amountType: 'percentage', percentage: null }), formatAmount), '0%')
    assert.equal(bonusAmountDisplay(campaign({ amountType: null }), formatAmount), '—')
    assert.equal(bonusAmountTypeLabel(campaign()), 'Fixed')
    assert.equal(bonusAmountTypeLabel(campaign({ amountType: 'percentage' })), 'Percentage')
    assert.equal(bonusAmountTypeLabel(campaign({ amountType: null })), null)
  })

  test('shows the player cap or ∞ with the per-player use where the legacy cell did', () => {
    assert.deepEqual(bonusPlayersCell(campaign({ numberOfPlayers: 1500, usagePerPlayer: 2 })), {
      count: (1500).toLocaleString(),
      perPlayer: '(2/player)',
    })
    assert.deepEqual(bonusPlayersCell(campaign({ numberOfPlayers: 10, usagePerPlayer: null })), {
      count: '10',
      perPlayer: null,
    })
    assert.deepEqual(bonusPlayersCell(campaign({ usagePerPlayer: 3 })), { count: '∞', perPlayer: '(3/player)' })
    // Unlimited signup and direct bonuses never showed the per-player use.
    assert.deepEqual(bonusPlayersCell(campaign({ type: 'signup', usagePerPlayer: 3 })), { count: '∞', perPlayer: null })
    assert.deepEqual(bonusPlayersCell(campaign({ type: 'direct_amount', usagePerPlayer: 1 })), {
      count: '∞',
      perPlayer: null,
    })
    assert.deepEqual(bonusPlayersCell(campaign({ type: 'direct_amount', numberOfPlayers: 5, usagePerPlayer: 1 })), {
      count: '5',
      perPlayer: '(1/player)',
    })
  })

  test('offers Distribute to undistributed direct bonuses and tags distributed ones', () => {
    assert.equal(canDistribute(campaign({ type: 'direct_amount' })), true)
    assert.equal(canDistribute(campaign({ type: 'direct_amount', distributedAt: '2026-10-01T10:00:00.000Z' })), false)
    assert.equal(canDistribute(campaign({ type: 'deposit' })), false)
    assert.equal(isDistributed(campaign({ type: 'direct_amount', distributedAt: '2026-10-01T10:00:00.000Z' })), true)
    assert.equal(isDistributed(campaign({ type: 'signup', distributedAt: '2026-10-01T10:00:00.000Z' })), false)
  })

  test('keeps the legacy confirmation copy for status changes, and says what End does (MAR-07)', () => {
    assert.deepEqual(bonusStatusAction(campaign({ status: 'active' })), {
      action: 'deactivate',
      tooltip: 'Deactivate',
      title: 'Deactivate campaign?',
      description: 'This will pause the campaign and prevent new awards.',
    })
    for (const status of ['draft', 'paused']) {
      assert.deepEqual(bonusStatusAction(campaign({ status })), {
        action: 'activate',
        tooltip: 'Activate',
        title: 'Activate campaign?',
        description: 'This will make the campaign active and allow new awards.',
      })
    }
    assert.deepEqual(bonusStatusAction(campaign({ status: 'ended' })), {
      action: 'activate',
      tooltip: 'Reactivate',
      title: 'Reactivate campaign?',
      description: 'This ended campaign becomes active again and allows new awards.',
    })
    assert.deepEqual(END_CONFIRM, {
      title: 'End campaign?',
      description: 'It stops new awards. The campaign stays in the list and can be activated again.',
    })
    assert.deepEqual(['draft', 'active', 'paused', 'ended'].map((status) => canEnd({ status })), [true, true, true, false])
    assert.deepEqual(CONFIRM_LABELS, { confirmLabel: 'Yes', cancelLabel: 'No' })
  })

  test('blocks Distribute until a usable preview is here', () => {
    const preview = {
      eligibleCount: 12,
      campaignName: 'Launch',
      campaignType: 'direct_amount',
      alreadyDistributed: false,
      distributedAt: null,
    }
    assert.equal(distributeBlocked(true, preview), true)
    assert.equal(distributeBlocked(false, null), true)
    assert.equal(distributeBlocked(false, { ...preview, alreadyDistributed: true }), true)
    assert.equal(distributeBlocked(false, { ...preview, eligibleCount: 0 }), true)
    assert.equal(distributeBlocked(false, preview), false)
    assert.equal(distributedMessage(12), 'Distributed to 12 users')
    assert.equal(distributedMessage(null), 'Distributed to 0 users')
    assert.equal(distributedMessage(undefined), 'Distributed to 0 users')
    assert.equal(campaignCountLabel(1), '1 campaign')
    assert.equal(campaignCountLabel(0), '0 campaigns')
  })

  test('keeps the legacy export columns, with Type and Status read as the table reads them (MAR-05)', () => {
    const formatDate = (date?: string | null) => (date ? `on ${date}` : '—')
    const columns = bonusExportColumns(formatAmount, formatDate, Date.parse('2026-11-03T08:00:00.000Z'))
    assert.deepEqual(columns.map((column) => [column.header, column.key, column.width]), [
      ['Campaign', 'name', 24],
      ['Domain', 'domain', 10],
      ['Type', 'type', 16],
      ['Status', 'status', 10],
      ['Distribution', 'distributionType', 14],
      ['Amount', 'amount', 14],
      ['Players', 'numberOfPlayers', 10],
      ['Start Date', 'startDate', 18],
      ['End Date', 'endDate', 18],
      ['Currency', 'currency', 10],
    ])
    const row = (overrides: Partial<BonusCampaignRow>) => columns.map((column) => column.getter(campaign(overrides)))
    assert.deepEqual(row({}), [
      'Welcome 100%', 'SPORTS', 'Deposit', 'Active', 'Roll Over', 'INR 1000.00', '—',
      'on 2026-09-22T09:00:00.000Z', '—', 'INR',
    ])
    assert.deepEqual(row({
      domain: 'global', type: 'daily_first_deposit', distributionType: null, amountType: 'percentage', percentage: null,
      numberOfPlayers: 0,
    }).slice(1, 7), ['All', 'First Day First Time Deposit', 'Active', '', '0%', 0])
    // A fixed amount with no figure exports a dash (the table shows 0).
    assert.equal(row({ amount: null })[5], '—')
    assert.equal(row({ type: 'special' })[2], 'Special Bonus')
    assert.deepEqual(row({ type: 'losing_bonus', status: 'paused' }).slice(2, 4), ['Losing Bonus', 'Paused'])
    assert.equal(row({ endDate: '2026-10-15T18:29:59.999Z' })[3], 'Expired')
  })
})
