import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import type { ProviderWithVendors } from '@/modules/casino/types'
import {
  ANALYTICS_PRESETS,
  EMPTY_VENDOR_ANALYTICS,
  PROVIDER_COMPARATORS,
  PROVIDER_STATUS_OPTIONS,
  VENDOR_COMPARATORS,
  absoluteGgrTotal,
  addDays,
  analyticsDrawerTitle,
  analyticsProviderIds,
  analyticsTitle,
  avgBet,
  configuredCount,
  contributionPercent,
  filterProviderSettings,
  filterVendorOverrides,
  formatRangeDay,
  gameCountLabel,
  gameOverridesEmptyText,
  gameSubLine,
  gamesLabel,
  ggrTrend,
  hasShareChanges,
  isSuperAdminRole,
  legacySortCycle,
  messageOr,
  normaliseProviderStatus,
  overrideSwitchLabel,
  playersFigure,
  presetRange,
  projectedShare,
  providerAnalyticsSummary,
  providerCountLabel,
  providerOptions,
  providerPerformance,
  providerSettingsEmptyText,
  providerStats,
  providerStatusLabel,
  providerStatusMessage,
  providerStatusOptions,
  rangeLabel,
  rangeVariables,
  selectedProviderLabel,
  shareDraft,
  shareFromField,
  shareMeterTone,
  shareUpsertVariables,
  statsAnalyticsVariables,
  statusUpdateVariables,
  sumTransactions,
  toProviderRows,
  toVendorRows,
  totalShare,
  totalShareTone,
  trendWord,
  vendorAnalyticsMap,
  vendorOptionsFor,
  vendorOverridesEmptyText,
  vendorRowKey,
  vendorStatsFor,
  vendorsCardSub,
  vendorsEmptyText,
  vendorsSummary,
  whitelabelOptions,
  withProviderStatus,
  yesNo,
  type ProviderSettingRow,
  type VendorOverrideRow,
  type VendorRow,
} from './providersPageModel'

function provider(id: string, name: string, overrides: Partial<ProviderWithVendors> = {}): ProviderWithVendors {
  return {
    id,
    key: name.toLowerCase(),
    name,
    status: 'ACTIVE',
    lastSyncAt: null,
    vendors: [],
    vendorStats: [],
    ...overrides,
  }
}

const QTECH = provider('p1', 'QTech', {
  vendors: [
    { id: 'v1', name: 'Evolution', slug: 'evolution' },
    { id: 'v2', name: 'Ezugi', slug: 'ezugi' },
  ],
  vendorStats: [
    { vendorId: 'v1', vendorName: 'Evolution', totalGames: 120, activeGames: 100 },
    { vendorId: 'v2', vendorName: 'Ezugi', totalGames: 40, activeGames: 0 },
  ],
})
const SPRIBE = provider('p2', 'spribe', {
  status: 'suspended',
  vendors: [{ id: 'v3', name: 'Aviator', slug: 'aviator' }],
  vendorStats: [{ vendorId: 'v3', vendorName: 'Aviator', totalGames: 1, activeGames: 1 }],
})

describe('roles and errors', () => {
  test('the super admin test keeps every legacy spelling', () => {
    assert.equal(isSuperAdminRole(['Super Admin']), true)
    assert.equal(isSuperAdminRole(['super_admin']), true)
    assert.equal(isSuperAdminRole(['SUPER_ADMIN']), true)
    assert.equal(isSuperAdminRole(['Platform SuperAdmin']), true)
    assert.equal(isSuperAdminRole(['Admin', 'Whitelabel Admin']), false)
    assert.equal(isSuperAdminRole(['supervisor']), false)
    assert.equal(isSuperAdminRole([]), false)
  })

  test('an error message wins over the fallback, even when empty (?? semantics)', () => {
    assert.equal(messageOr(new Error('Tenant missing'), 'Failed'), 'Tenant missing')
    assert.equal(messageOr({}, 'Failed'), 'Failed')
    assert.equal(messageOr(null, 'Failed'), 'Failed')
    assert.equal(messageOr({ message: '' }, 'Failed'), '')
  })
})

describe('options', () => {
  test('providers, the chosen label, a provider\'s vendors and whitelabels', () => {
    const options = providerOptions([QTECH, SPRIBE])
    assert.deepEqual(options, [{ label: 'QTech', value: 'p1' }, { label: 'spribe', value: 'p2' }])
    assert.equal(selectedProviderLabel(options, 'p2'), 'spribe')
    assert.equal(selectedProviderLabel(options, 'missing'), '')
    assert.equal(selectedProviderLabel(options, undefined), '')
    assert.deepEqual(vendorOptionsFor([QTECH, SPRIBE], 'p1'), [
      { label: 'Evolution', value: 'v1' },
      { label: 'Ezugi', value: 'v2' },
    ])
    assert.deepEqual(vendorOptionsFor([QTECH], undefined), [])
    assert.deepEqual(vendorOptionsFor([QTECH], 'p9'), [])
    assert.deepEqual(whitelabelOptions([{ id: 'wl-1', name: 'Royal Bet' }]), [{ label: 'Royal Bet', value: 'wl-1' }])
  })
})

describe('per-whitelabel visibility', () => {
  const settings: ProviderSettingRow[] = [
    { id: 's1', providerId: 7, providerKey: 'qtech', providerName: 'QTech', enabled: true },
    { id: 's2', providerId: 8, providerKey: 'evo', providerName: 'Evolution Direct', enabled: false },
  ]
  const overrides: VendorOverrideRow[] = [
    { id: 'o1', vendorId: 11, vendorName: 'Evolution', providerId: 7, providerKey: 'qtech', disabled: false },
    { id: 'o2', vendorId: 12, vendorName: 'Ezugi', providerId: 7, providerKey: 'qtech', disabled: true },
    { id: 'o3', vendorId: 13, vendorName: 'Lightning', providerId: 8, providerKey: 'evo', disabled: false },
  ]

  test('provider rows match a trimmed, case-insensitive name or key; a blank search keeps the same rows', () => {
    assert.equal(filterProviderSettings(settings, ''), settings)
    assert.equal(filterProviderSettings(settings, '   '), settings)
    assert.deepEqual(filterProviderSettings(settings, ' EVO ').map((r) => r.id), ['s2'])
    assert.deepEqual(filterProviderSettings(settings, 'direct').map((r) => r.id), ['s2'])
    assert.deepEqual(filterProviderSettings(settings, 'zzz'), [])
  })

  test('vendor rows filter by provider id as a string, then by vendor name or provider key', () => {
    assert.equal(filterVendorOverrides(overrides, undefined, ''), overrides)
    assert.deepEqual(filterVendorOverrides(overrides, '7', '').map((r) => r.id), ['o1', 'o2'])
    assert.deepEqual(filterVendorOverrides(overrides, undefined, ' EVO').map((r) => r.id), ['o1', 'o3'])
    assert.deepEqual(filterVendorOverrides(overrides, '7', 'ezu').map((r) => r.id), ['o2'])
    assert.deepEqual(filterVendorOverrides(overrides, '8', 'ezu'), [])
  })

  test('empty texts follow the untrimmed search and the filters', () => {
    assert.equal(providerSettingsEmptyText(''), 'No providers')
    assert.equal(providerSettingsEmptyText(' '), 'No providers match your search')
    assert.equal(vendorOverridesEmptyText('', undefined), 'No vendors')
    assert.equal(vendorOverridesEmptyText('', '7'), 'No vendors match filters')
    assert.equal(gameOverridesEmptyText('', undefined, undefined), 'Select provider (and optionally vendor) to list games')
    assert.equal(gameOverridesEmptyText('', 'p1', undefined), 'No games match filters')
    assert.equal(gameOverridesEmptyText('', undefined, 'v1'), 'No games match filters')
    assert.equal(gameOverridesEmptyText('ab', undefined, undefined), 'No games match filters')
  })

  test('game lines, counts and the switch name', () => {
    assert.equal(gameCountLabel(20, 45), '20 of 45 games')
    assert.equal(gameCountLabel(3, 0), '3 games')
    assert.equal(gameSubLine({ providerKey: 'qtech', vendorName: 'Evolution' }), 'qtech • Evolution')
    assert.equal(overrideSwitchLabel('QTech'), 'QTech disabled')
    assert.equal(yesNo(true), 'Yes')
    assert.equal(yesNo(false), 'No')
  })
})

describe('providers table', () => {
  test('rows keep the legacy shape', () => {
    const rows = toProviderRows([QTECH, provider('p3', 'Bare', { vendors: undefined as never, lastSyncAt: '2026-10-01T10:00:00Z' })])
    assert.deepEqual(rows[0], {
      id: 'p1',
      key: 'qtech',
      name: 'QTech',
      status: 'ACTIVE',
      lastSyncAt: undefined,
      vendorCount: 2,
      vendors: QTECH.vendors,
    })
    assert.equal(rows[1].vendorCount, 0)
    assert.deepEqual(rows[1].vendors, [])
    assert.equal(rows[1].lastSyncAt, '2026-10-01T10:00:00Z')
  })

  test('comparators lower-case names and statuses and compare counts as numbers', () => {
    const rows = toProviderRows([QTECH, SPRIBE, provider('p4', 'aardvark', { status: 'Inactive' })])
    const byName = [...rows].sort(PROVIDER_COMPARATORS.name).map((r) => r.name)
    assert.deepEqual(byName, ['aardvark', 'QTech', 'spribe'])
    const byStatus = [...rows].sort(PROVIDER_COMPARATORS.status).map((r) => r.status)
    assert.deepEqual(byStatus, ['ACTIVE', 'Inactive', 'suspended'])
    const byCount = [...rows].sort(PROVIDER_COMPARATORS.vendorCount).map((r) => r.vendorCount)
    assert.deepEqual(byCount, [0, 1, 2])
    const vendorRows: VendorRow[] = [
      { id: 'a', name: 'b', slug: 'b', providerId: 'p', providerName: 'Z' },
      { id: 'b', name: 'A', slug: 'a', providerId: 'p', providerName: 'y' },
    ]
    assert.deepEqual([...vendorRows].sort(VENDOR_COMPARATORS.name).map((r) => r.id), ['b', 'a'])
    assert.deepEqual([...vendorRows].sort(VENDOR_COMPARATORS.providerName).map((r) => r.id), ['b', 'a'])
  })

  test('a header asks for ascending, then flips, and never clears', () => {
    const asc = legacySortCycle(null, { key: 'name', dir: 'asc' })
    assert.deepEqual(asc, { key: 'name', dir: 'asc' })
    const desc = legacySortCycle(asc, { key: 'name', dir: 'desc' })
    assert.deepEqual(desc, { key: 'name', dir: 'desc' })
    assert.deepEqual(legacySortCycle(desc, null), { key: 'name', dir: 'asc' })
    assert.equal(legacySortCycle(null, null), null)
  })

  test('status options, labels, variables and the optimistic cache write', () => {
    assert.equal(normaliseProviderStatus('ACTIVE'), 'active')
    assert.equal(normaliseProviderStatus(''), 'active')
    assert.equal(normaliseProviderStatus(null), 'active')
    assert.deepEqual(providerStatusOptions('inactive'), [...PROVIDER_STATUS_OPTIONS])
    assert.deepEqual(providerStatusOptions('maintenance').at(-1), { value: 'maintenance', label: 'maintenance' })
    assert.equal(providerStatusOptions('maintenance').length, 4)
    // The read-only status for everyone but the platform administrator.
    assert.equal(providerStatusLabel('suspended'), 'Suspended')
    assert.equal(providerStatusLabel('maintenance'), 'maintenance')
    assert.equal(providerStatusMessage('QTech', 'suspended'), 'Provider "QTech" status updated to Suspended')
    assert.deepEqual(statusUpdateVariables('p1', 'inactive'), { id: 'p1', input: { status: 'inactive' } })
    const written = withProviderStatus([QTECH, SPRIBE], 'p2', 'active')
    assert.equal(written[1].status, 'active')
    assert.equal(written[0], QTECH)
    assert.equal(providerCountLabel(1), '1 provider')
    assert.equal(providerCountLabel(0), '0 providers')
  })

  test('the vendors summary, the performance figures and the vendor stats lookup', () => {
    assert.deepEqual(vendorsSummary([]), { countLabel: '0 vendors', top: [], remaining: -3 })
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `v${i}`, name: `V${i}` }))
    const summary = vendorsSummary(five)
    assert.equal(summary.countLabel, '5 vendors')
    assert.deepEqual(summary.top.map((v) => v.id), ['v0', 'v1', 'v2'])
    assert.equal(summary.remaining, 2)
    assert.equal(vendorsSummary(five.slice(0, 1)).countLabel, '1 vendor')
    assert.deepEqual(providerPerformance(QTECH), { totalGames: 160, activeGames: 100, vendorCount: 2 })
    assert.deepEqual(providerPerformance(undefined), { totalGames: 0, activeGames: 0, vendorCount: 0 })
    assert.deepEqual(vendorStatsFor([QTECH, SPRIBE], 'p1', 'v2'), QTECH.vendorStats?.[1])
    assert.equal(vendorStatsFor([QTECH], 'p2', 'v2'), null)
  })

  test('today\'s figure: the sign of the GGR and the transactions (no "vs yesterday" figure)', () => {
    assert.equal(ggrTrend(10), 'up')
    assert.equal(ggrTrend(-1), 'down')
    assert.equal(ggrTrend(0), 'neutral')
    assert.equal(ggrTrend(Number.NaN), 'neutral')
    assert.equal(sumTransactions([{ vendorId: 'a', transactionCount: 3 }, { vendorId: 'b', transactionCount: null }, { vendorId: 'c' }]), 3)
    assert.equal(trendWord('up'), 'Up')
    assert.equal(trendWord('down'), 'Down')
    assert.equal(trendWord('neutral'), 'No change')
  })
})

describe('vendors table', () => {
  test('every vendor, or the chosen provider\'s; ids for the batched analytics; row keys', () => {
    const all = toVendorRows([QTECH, SPRIBE], undefined)
    assert.deepEqual(all.map(vendorRowKey), ['p1-v1', 'p1-v2', 'p2-v3'])
    assert.deepEqual(all[2], { id: 'v3', name: 'Aviator', slug: 'aviator', providerId: 'p2', providerName: 'spribe' })
    assert.deepEqual(toVendorRows([QTECH, SPRIBE], 'p2').map((v) => v.id), ['v3'])
    assert.deepEqual(analyticsProviderIds(all), ['p1', 'p2'])
  })

  test('the analytics map is keyed provider:vendor, numbers coerced, rows without ids skipped', () => {
    const map = vendorAnalyticsMap([
      {
        providerId: 'p1',
        vendorBreakdown: [
          { vendorId: 'v1', ggr: 1200, shareAmount: 120, transactionCount: 9, totalStake: 4500 },
          { vendorId: '', ggr: 5 },
          { vendorId: 'v2', ggr: null, shareAmount: null, transactionCount: null },
        ],
      },
      { providerId: null, vendorBreakdown: [{ vendorId: 'v9', ggr: 1 }] },
    ])
    assert.deepEqual([...map.keys()], ['p1:v1', 'p1:v2'])
    assert.deepEqual(map.get('p1:v1'), { ggr: 1200, shareAmount: 120, transactionCount: 9, totalStake: 4500 })
    // No stakes in the reply: unknown, not 0, so no average is made up from them.
    assert.deepEqual(map.get('p1:v2'), { ggr: 0, shareAmount: 0, transactionCount: 0, totalStake: null })
    assert.deepEqual(EMPTY_VENDOR_ANALYTICS, { ggr: 0, shareAmount: 0, transactionCount: 0, totalStake: 0 })
  })

  test('labels and the average bet (stake per bet, never |GGR| per bet)', () => {
    assert.equal(gamesLabel(1), '1 game')
    assert.equal(gamesLabel(0), '0 games')
    assert.equal(vendorsCardSub(3, undefined, undefined), '3 vendors across all providers')
    assert.equal(vendorsCardSub(1, 'p1', 'QTech'), '1 vendor for QTech')
    assert.equal(vendorsCardSub(0, 'p9', undefined), '0 vendors for ')
    assert.equal(vendorsEmptyText(undefined), 'No vendors found')
    assert.equal(vendorsEmptyText('p1'), 'No vendors found for this provider')
    // September's figures: 7,465 bets staking 41,353,263.30 average 5,539.62; |GGR| / bets read 89.04.
    assert.equal(avgBet(41_353_263.3, 7465)?.toFixed(2), '5539.62')
    assert.equal(avgBet(500, 4), 125)
    assert.equal(avgBet(500, 0), null, 'no bets, no average')
    assert.equal(avgBet(null, 4), null, 'stakes unknown, no average')
    assert.equal(avgBet(undefined, 4), null)
  })
})

describe('statistics', () => {
  test('suspended is everything not ACTIVE; active vendors have an active game; the rate is rounded', () => {
    assert.deepEqual(providerStats([QTECH, SPRIBE, provider('p3', 'Other', { status: 'active' })]), {
      totalProviders: 3,
      activeProviders: 2,
      suspendedProviders: 1,
      totalVendors: 3,
      activeVendors: 2,
      activeRate: 67,
    })
    assert.deepEqual(providerStats([]), {
      totalProviders: 0,
      activeProviders: 0,
      suspendedProviders: 0,
      totalVendors: 0,
      activeVendors: 0,
      activeRate: 0,
    })
  })

  test('today\'s GGR asks for the first provider only', () => {
    assert.deepEqual(statsAnalyticsVariables(['p1', 'p2'], 'S', 'E'), { providerId: 'p1', start: 'S', end: 'E' })
    assert.equal(statsAnalyticsVariables([], 'S', 'E'), undefined)
  })
})

describe('vendor shares', () => {
  const vendors = [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }]
  const saved = new Map([['v1', 10], ['v2', 0]])

  test('the draft, its total, the change test and the configured count', () => {
    const draft = shareDraft(vendors, saved)
    assert.deepEqual(draft, { v1: 10, v2: 0, v3: 0 })
    assert.equal(totalShare({ v1: 10.5, v2: 20 }), 30.5)
    assert.equal(hasShareChanges(vendors, saved, draft), false)
    assert.equal(hasShareChanges(vendors, saved, { ...draft, v1: 10.01 }), false)
    assert.equal(hasShareChanges(vendors, saved, { ...draft, v1: 10.02 }), true)
    assert.equal(hasShareChanges(vendors, saved, { v1: 10 }), false)
    assert.equal(configuredCount({ v1: 10, v2: 0, v3: 0.1 }), 2)
  })

  test('the bar and the total keep the legacy thresholds', () => {
    assert.equal(shareMeterTone(50), 'acc')
    assert.equal(shareMeterTone(50.1), 'warn')
    assert.equal(shareMeterTone(80), 'warn')
    assert.equal(shareMeterTone(80.1), 'neg')
    assert.equal(totalShareTone(80), 'pos')
    assert.equal(totalShareTone(80.1), 'warn')
    assert.equal(totalShareTone(100), 'warn')
    assert.equal(totalShareTone(100.1), 'neg')
  })

  test('the projected share, the field value and the upsert variables', () => {
    assert.equal(projectedShare(1000, 12.5), 125)
    assert.equal(projectedShare(-1000, 12.5), 0)
    assert.equal(projectedShare(0, 50), 0)
    assert.equal(shareFromField(null), 0)
    assert.equal(shareFromField(0.1 + 0.2), 0.3)
    assert.equal(shareFromField(33.333), 33.333)
    assert.equal(shareFromField(12.5), 12.5)
    assert.deepEqual(shareUpsertVariables('p1', 'v2', 7.5), { providerId: 'p1', vendorId: 'v2', sharePercentage: 7.5 })
  })
})

describe('analytics drawer', () => {
  test('titles', () => {
    assert.equal(analyticsTitle('QTech'), 'Analytics • QTech')
    assert.equal(analyticsDrawerTitle(null), 'Provider Analytics')
    assert.equal(analyticsDrawerTitle({ type: 'vendor', providerId: 'p', vendorId: 'v' }), 'Vendor Analytics')
    assert.equal(analyticsDrawerTitle({ type: 'provider', providerId: 'p', title: 'Analytics • X' }), 'Analytics • X')
  })

  test('presets end today and start N-1 days earlier, across months, years and leap days', () => {
    assert.deepEqual(ANALYTICS_PRESETS.map((p) => p.label), ['Today', '7D', '30D', 'Custom range'])
    assert.equal(addDays('2026-03-01', -1), '2026-02-28')
    assert.equal(addDays('2024-03-01', -1), '2024-02-29')
    assert.equal(addDays('2026-01-03', -6), '2025-12-28')
    assert.deepEqual(presetRange('1', '2026-10-07'), { preset: '1', from: '2026-10-07', to: '2026-10-07' })
    assert.deepEqual(presetRange('7', '2026-10-07'), { preset: '7', from: '2026-10-01', to: '2026-10-07' })
    assert.deepEqual(presetRange('30', '2026-10-07'), { preset: '30', from: '2026-09-08', to: '2026-10-07' })
  })

  test('the queries receive the IST start of the first day and the IST end of the last', () => {
    assert.deepEqual(rangeVariables({ from: '2026-10-01', to: '2026-10-07' }), {
      start: '2026-09-30T18:30:00.000Z',
      end: '2026-10-07T18:29:59.999Z',
    })
  })

  test('the trigger names the preset and the legacy day format', () => {
    assert.equal(formatRangeDay('2026-10-07'), 'Oct 07, 2026')
    assert.equal(rangeLabel({ preset: '1', from: '2026-10-07', to: '2026-10-07' }), 'Today · Oct 07, 2026')
    assert.equal(rangeLabel({ preset: '7', from: '2026-10-01', to: '2026-10-07' }), '7D · Oct 01, 2026 – Oct 07, 2026')
    assert.equal(rangeLabel({ preset: 'custom', from: '2026-01-02', to: '2026-02-03' }), 'Jan 02, 2026 – Feb 03, 2026')
  })

  test('the provider summary: an active vendor took bets, whatever its GGR', () => {
    const breakdown = [
      { vendorId: 'v1', ggr: 600, shareAmount: 60, transactionCount: 10 },
      { vendorId: 'v2', ggr: -100, shareAmount: 0, transactionCount: 5 },
      { vendorId: 'v3', ggr: null, shareAmount: null, transactionCount: null },
    ]
    assert.deepEqual(providerAnalyticsSummary(500, breakdown), {
      totalTransactions: 15,
      totalShare: 60,
      activeVendors: 2,
      vendorCount: 3,
      avgPerVendor: 500 / 3,
    })
    assert.equal(providerAnalyticsSummary(10, []).avgPerVendor, 0)
  })

  test('a contribution is a signed share of every vendor\'s |GGR|, so it reads right when the total is negative', () => {
    // September: Ezugi -652,334.41, Evolution 314,605.13, Spribe -91,155.24 (total -428,884.52). The share of the
    // negative total read 0.0% for all three.
    const breakdown = [{ vendorId: 'ezugi', ggr: -652_334.41 }, { vendorId: 'evo', ggr: 314_605.13 }, { vendorId: 'spribe', ggr: -91_155.24 }]
    const base = absoluteGgrTotal(breakdown)
    assert.equal(base.toFixed(2), '1058094.78')
    assert.equal(contributionPercent(314_605.13, base)?.toFixed(1), '29.7')
    assert.equal(contributionPercent(-652_334.41, base)?.toFixed(1), '-61.7')
    // With every vendor in profit it is the plain share of the total, as before.
    assert.equal(contributionPercent(1000, absoluteGgrTotal([{ vendorId: 'a', ggr: 1000 }, { vendorId: 'b', ggr: 500 }]))?.toFixed(1), '66.7')
    assert.equal(contributionPercent(0, 0), null, 'no money moved: no share')
    assert.equal(absoluteGgrTotal([{ vendorId: 'a', ggr: null }]), 0)
  })

  test('the players figure', () => {
    assert.equal(playersFigure(0), '0')
    assert.equal(playersFigure(3), '—')
  })
})
