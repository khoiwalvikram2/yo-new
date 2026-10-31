/**
 * The Overview period lives in a persisted store, so its dates outlive the day they were computed
 * on. These tests pin the rule that a relative preset (Today, 7D, Last Month...) is a function of
 * the IST clock, recomputed on every reload, write and refresh, while only a custom range keeps
 * the dates it was given. Each test seeds localStorage and re-imports the module, because persist
 * hydrates synchronously when the store is created (vitest.setup.ts clears localStorage after
 * every test). Only Date is faked: zustand needs no timers, and IST boundaries fall at 18:30Z.
 */
import { test, describe, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert/strict'

const KEY = 'dashboard-store-v2'

/** The payload a tab left on "Today" writes on 21 Sep (15:00 IST), exactly as the browser stores it. */
const SAVED_TODAY_21_SEP = JSON.stringify({
  state: {
    filters: {
      dateRange: {
        dateFrom: '2026-09-20T18:30:00.000Z',
        dateTo: '2026-09-21T18:29:59.999Z',
        preset: 'today',
      },
      productFilter: 'all',
    },
  },
  version: 0,
})

/** 22 Sep 2026 in IST, as UTC instants. */
const TODAY_22_SEP = { dateFrom: '2026-09-21T18:30:00.000Z', dateTo: '2026-09-22T18:29:59.999Z' }

function at(isoWithOffset: string): void {
  vi.setSystemTime(new Date(isoWithOffset))
}

function seed(payload: unknown): void {
  window.localStorage.setItem(KEY, typeof payload === 'string' ? payload : JSON.stringify(payload))
}

/** A fresh module, as a page reload gets: persist reads localStorage while the store is created. */
async function loadStore() {
  vi.resetModules()
  return import('./dashboardStore')
}

/** Counts the IST calendar days a range spans, both ends included. */
function istDays(range: { dateFrom: string; dateTo: string }): number {
  const ms = new Date(range.dateTo).getTime() + 1 - new Date(range.dateFrom).getTime()
  return ms / 86_400_000
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-22T10:00:00+05:30')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dashboardStore: reload recomputes a relative preset', () => {
  test('"Today" saved on 21 Sep comes back as 22 Sep when reopened on 22 Sep', async () => {
    seed(SAVED_TODAY_21_SEP)
    const { useDashboardStore } = await loadStore()
    const { filters, getDateRangeForQuery } = useDashboardStore.getState()
    assert.deepEqual(filters, { dateRange: { preset: 'today', ...TODAY_22_SEP }, productFilter: 'all' })
    assert.deepEqual(getDateRangeForQuery(), TODAY_22_SEP)
  })

  test('every relative preset is recomputed from the clock, whatever dates were saved', async () => {
    const expected = {
      today: TODAY_22_SEP,
      yesterday: { dateFrom: '2026-09-20T18:30:00.000Z', dateTo: '2026-09-21T18:29:59.999Z' },
      // 16-22 Sep and 24 Aug-22 Sep IST (7 and 30 calendar days, today included)
      last7days: { dateFrom: '2026-09-15T18:30:00.000Z', dateTo: '2026-09-22T18:29:59.999Z' },
      last30days: { dateFrom: '2026-08-23T18:30:00.000Z', dateTo: '2026-09-22T18:29:59.999Z' },
      thisMonth: { dateFrom: '2026-08-31T18:30:00.000Z', dateTo: '2026-09-22T18:29:59.999Z' },
      lastMonth: { dateFrom: '2026-07-31T18:30:00.000Z', dateTo: '2026-08-31T18:29:59.999Z' },
    } as const
    for (const [preset, range] of Object.entries(expected)) {
      window.localStorage.clear()
      seed({
        state: {
          filters: {
            dateRange: { preset, dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2026-01-02T00:00:00.000Z' },
            productFilter: 'casino',
          },
        },
        version: 0,
      })
      const { useDashboardStore } = await loadStore()
      const { filters } = useDashboardStore.getState()
      assert.deepEqual(filters.dateRange, { preset, ...range }, preset)
      assert.equal(filters.productFilter, 'casino', `${preset} keeps the saved product filter`)
    }
  })

  test('a custom range keeps its saved dates exactly', async () => {
    const custom = { preset: 'custom', dateFrom: '2026-08-31T18:30:00.000Z', dateTo: '2026-09-10T18:29:59.999Z' }
    seed({ state: { filters: { dateRange: custom, productFilter: 'sports' } }, version: 0 })
    const { useDashboardStore } = await loadStore()
    assert.deepEqual(useDashboardStore.getState().filters, { dateRange: custom, productFilter: 'sports' })
  })

  test('"Last Month" saved on 31 Aug (July) reopens on 1 Sep as August', async () => {
    at('2026-08-31T15:00:00+05:30')
    const first = await loadStore()
    first.useDashboardStore.getState().setDateRangePreset('lastMonth')
    assert.deepEqual(first.useDashboardStore.getState().filters.dateRange, {
      preset: 'lastMonth',
      dateFrom: '2026-06-30T18:30:00.000Z',
      dateTo: '2026-07-31T18:29:59.999Z',
    })

    at('2026-09-01T10:00:00+05:30')
    const reopened = await loadStore()
    assert.deepEqual(reopened.useDashboardStore.getState().filters.dateRange, {
      preset: 'lastMonth',
      dateFrom: '2026-07-31T18:30:00.000Z',
      dateTo: '2026-08-31T18:29:59.999Z',
    })
  })

  test('damaged or legacy shapes fall back to Today and keep the product filter', async () => {
    const damaged: Array<[string, unknown]> = [
      ['a preset with no dates', { filters: { dateRange: { preset: 'today' }, productFilter: 'casino' } }],
      ['no dateRange at all', { filters: { productFilter: 'casino' } }],
      ['dateRange null', { filters: { dateRange: null, productFilter: 'casino' } }],
      ['an unknown preset', { filters: { dateRange: { preset: 'last90days', dateFrom: 'x', dateTo: 'y' }, productFilter: 'casino' } }],
      ['a custom range missing its end', { filters: { dateRange: { preset: 'custom', dateFrom: '2026-09-01T00:00:00.000Z' }, productFilter: 'casino' } }],
      ['dates with no preset', { filters: { dateRange: { dateFrom: '2026-09-01T00:00:00.000Z', dateTo: '2026-09-02T00:00:00.000Z' }, productFilter: 'casino' } }],
      // truthy but not dates: 'x'/'y' reached the pill as "Invalid Date", and a number or an object made
      // formatDate throw, taking the page down to its ErrorBoundary
      ['a custom range whose dates do not parse', { filters: { dateRange: { preset: 'custom', dateFrom: 'x', dateTo: 'y' }, productFilter: 'casino' } }],
      ['a custom range with numeric dates', { filters: { dateRange: { preset: 'custom', dateFrom: 1, dateTo: 2 }, productFilter: 'casino' } }],
      ['a custom range with object dates', { filters: { dateRange: { preset: 'custom', dateFrom: { $date: '2026-09-01T18:30:00.000Z' }, dateTo: {} }, productFilter: 'casino' } }],
      ['a custom range that ends before it starts', { filters: { dateRange: { preset: 'custom', dateFrom: '2026-09-10T18:29:59.999Z', dateTo: '2026-08-31T18:30:00.000Z' }, productFilter: 'casino' } }],
    ]
    for (const [label, state] of damaged) {
      window.localStorage.clear()
      seed({ state, version: 0 })
      const { useDashboardStore } = await loadStore()
      const { filters, getDateRangeForQuery } = useDashboardStore.getState()
      assert.deepEqual(filters, { dateRange: { preset: 'today', ...TODAY_22_SEP }, productFilter: 'casino' }, label)
      assert.deepEqual(getDateRangeForQuery(), TODAY_22_SEP, `${label}: the query range is Today`)
    }
  })

  test('saved state with no filters falls back to the defaults', async () => {
    seed({ state: {}, version: 0 })
    const { useDashboardStore } = await loadStore()
    assert.deepEqual(useDashboardStore.getState().filters, {
      dateRange: { preset: 'today', ...TODAY_22_SEP },
      productFilter: 'all',
    })
  })
})

describe('dashboardStore: an open tab across IST midnight', () => {
  beforeEach(() => {
    at('2026-09-21T23:59:30+05:30')
  })

  test('refreshRelativeRange rolls "Today" over to the new day', async () => {
    const { useDashboardStore } = await loadStore()
    useDashboardStore.getState().setDateRangePreset('today')
    assert.equal(useDashboardStore.getState().filters.dateRange.dateFrom, '2026-09-20T18:30:00.000Z')

    at('2026-09-22T00:00:30+05:30')
    useDashboardStore.getState().refreshRelativeRange()
    assert.deepEqual(useDashboardStore.getState().filters.dateRange, { preset: 'today', ...TODAY_22_SEP })
    assert.deepEqual(useDashboardStore.getState().getDateRangeForQuery(), TODAY_22_SEP)
  })

  test('a same-day refresh changes nothing: same state object, no subscriber call', async () => {
    const { useDashboardStore } = await loadStore()
    useDashboardStore.getState().setDateRangePreset('last7days')
    const before = useDashboardStore.getState()
    const listener = vi.fn()
    const unsubscribe = useDashboardStore.subscribe(listener)

    useDashboardStore.getState().refreshRelativeRange()
    at('2026-09-21T23:59:59+05:30')
    useDashboardStore.getState().refreshRelativeRange()

    unsubscribe()
    assert.equal(useDashboardStore.getState(), before)
    assert.equal(useDashboardStore.getState().filters, before.filters)
    assert.equal(listener.mock.calls.length, 0)
  })

  test('refreshRelativeRange leaves a custom range alone after midnight', async () => {
    const { useDashboardStore } = await loadStore()
    const custom = { dateFrom: '2026-09-01T18:30:00.000Z', dateTo: '2026-09-05T18:29:59.999Z' }
    useDashboardStore.getState().setDateRange({ ...custom, preset: 'custom' })
    const before = useDashboardStore.getState().filters

    at('2026-09-22T00:00:30+05:30')
    useDashboardStore.getState().refreshRelativeRange()
    assert.equal(useDashboardStore.getState().filters, before)
    assert.deepEqual(before.dateRange, { preset: 'custom', ...custom })
  })

  test('Reset after midnight gives the new day, not the day the module loaded', async () => {
    const { useDashboardStore } = await loadStore()
    useDashboardStore.getState().setDateRangePreset('last30days')
    useDashboardStore.getState().setProductFilter('matka')

    at('2026-09-22T00:00:30+05:30')
    useDashboardStore.getState().resetFilters()
    assert.deepEqual(useDashboardStore.getState().filters, {
      dateRange: { preset: 'today', ...TODAY_22_SEP },
      productFilter: 'all',
    })
  })
})

describe('dashboardStore: 7D and 30D windows', () => {
  test('on 04 Sep, 7D is 29 Aug - 04 Sep and 30D is 06 Aug - 04 Sep (the mockup ranges, M:2737/2748)', async () => {
    at('2026-09-04T17:19:00+05:30')
    const { getDateRangeISOForPreset } = await loadStore()
    const d7 = getDateRangeISOForPreset('last7days')
    const d30 = getDateRangeISOForPreset('last30days')
    assert.deepEqual(d7, { dateFrom: '2026-08-28T18:30:00.000Z', dateTo: '2026-09-04T18:29:59.999Z' })
    assert.deepEqual(d30, { dateFrom: '2026-08-05T18:30:00.000Z', dateTo: '2026-09-04T18:29:59.999Z' })
    assert.equal(istDays(d7), 7)
    assert.equal(istDays(d30), 30)
  })

  test('the windows hold at both ends of the IST day', async () => {
    const { getDateRangeISOForPreset } = await loadStore()
    for (const instant of ['2026-09-22T00:00:00+05:30', '2026-09-22T23:59:59+05:30']) {
      at(instant)
      assert.deepEqual(
        getDateRangeISOForPreset('last7days'),
        { dateFrom: '2026-09-15T18:30:00.000Z', dateTo: '2026-09-22T18:29:59.999Z' },
        `7D at ${instant}`
      )
      assert.equal(istDays(getDateRangeISOForPreset('last30days')), 30, `30D at ${instant}`)
    }
  })

  test('the fallback window for "custom" (a range with no dates of its own) is 7D\'s, not 8 days', async () => {
    const { getDateRangeISOForPreset } = await loadStore()
    assert.deepEqual(getDateRangeISOForPreset('custom'), getDateRangeISOForPreset('last7days'))
    assert.equal(istDays(getDateRangeISOForPreset('custom')), 7)
  })

  test('the 7D and 30D segs write those windows to the store', async () => {
    const { useDashboardStore } = await loadStore()
    useDashboardStore.getState().setDateRangePreset('last7days')
    assert.equal(istDays(useDashboardStore.getState().filters.dateRange), 7)
    useDashboardStore.getState().setDateRangePreset('last30days')
    assert.equal(istDays(useDashboardStore.getState().filters.dateRange), 30)
  })
})

describe('dashboardStore: writes', () => {
  test('setDateRange recomputes a relative preset instead of trusting the dates passed in', async () => {
    const { useDashboardStore } = await loadStore()
    useDashboardStore.getState().setDateRange({
      preset: 'today',
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-01T23:59:59.999Z',
    })
    assert.deepEqual(useDashboardStore.getState().filters.dateRange, { preset: 'today', ...TODAY_22_SEP })
  })

  test('setDateRange with dates and no preset stores a custom range', async () => {
    const { useDashboardStore } = await loadStore()
    const custom = { dateFrom: '2026-09-01T18:30:00.000Z', dateTo: '2026-09-03T18:29:59.999Z' }
    useDashboardStore.getState().setDateRange(custom)
    assert.deepEqual(useDashboardStore.getState().filters.dateRange, { preset: 'custom', ...custom })
  })

  test('setDateRange with a custom range missing a date falls back to Today', async () => {
    const { useDashboardStore } = await loadStore()
    useDashboardStore.getState().setDateRange({ preset: 'custom', dateFrom: '2026-09-01T18:30:00.000Z' })
    assert.deepEqual(useDashboardStore.getState().filters.dateRange, { preset: 'today', ...TODAY_22_SEP })
  })

  test('setDateRange keeps a one-day custom range and drops a reversed one', async () => {
    const { useDashboardStore } = await loadStore()
    const oneDay = { preset: 'custom' as const, dateFrom: '2026-09-01T18:30:00.000Z', dateTo: '2026-09-02T18:29:59.999Z' }
    useDashboardStore.getState().setDateRange(oneDay)
    assert.deepEqual(useDashboardStore.getState().filters.dateRange, oneDay)
    useDashboardStore.getState().setDateRange({ ...oneDay, dateFrom: oneDay.dateTo, dateTo: oneDay.dateFrom })
    assert.deepEqual(useDashboardStore.getState().filters.dateRange, { preset: 'today', ...TODAY_22_SEP })
  })

  test('the storage key and saved shape are unchanged', async () => {
    const { useDashboardStore } = await loadStore()
    useDashboardStore.getState().setDateRangePreset('yesterday')
    const raw = window.localStorage.getItem(KEY)
    assert.ok(raw)
    assert.deepEqual(JSON.parse(raw), {
      state: {
        filters: {
          dateRange: { preset: 'yesterday', dateFrom: '2026-09-20T18:30:00.000Z', dateTo: '2026-09-21T18:29:59.999Z' },
          productFilter: 'all',
        },
      },
      version: 0,
    })
  })
})
