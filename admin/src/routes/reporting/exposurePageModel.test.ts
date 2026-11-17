import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  EXPOSURE_DATE_PRESETS,
  PAGE_SIZE_OPTIONS,
  calculateExposureMetrics,
  calculateTotalExposure,
  exposureDomainRows,
  exposureKpiSkips,
  exposureRangeDays,
  filterExposureRows,
  formatExposureChange,
  formatExposureSearchDate,
  getExposureDateRange,
  nextExposureSort,
  paginateExposureRows,
  sortExposurePage,
  visibleExposureDomains,
  type ExposureDataPoint,
} from './exposurePageModel'

const ROWS: ExposureDataPoint[] = [
  { date: '2026-01-01T10:00:00.100Z', value: 100, dimension: 'Sports' },
  { date: '2026-01-03T10:00:00.100Z', value: 2_500, dimension: 'All' },
  { date: '2026-01-02T10:00:00.100Z', value: 50, dimension: 'MATKA' },
  { date: '2026-01-04T10:00:00.100Z', value: 75, dimension: 'Casino' },
]

const FILTER_FORMATTERS = {
  formatDate: (date: string) => date.slice(0, 10),
  formatAmount: (amount: number) => `INR ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`,
  convertAmount: (amount: number) => amount * 2,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('exposure date ranges', () => {
  test('publishes the four existing presets and page sizes', () => {
    assert.deepStrictEqual(EXPOSURE_DATE_PRESETS, [
      { value: 'allTime', label: 'All time' },
      { value: 'today', label: 'Today' },
      { value: 'yesterday', label: 'Yesterday' },
      { value: 'custom', label: 'Custom' },
    ])
    assert.deepStrictEqual(PAGE_SIZE_OPTIONS, [10, 20, 50, 100])
  })

  test('resolves All Time, Today, Yesterday and the 30-prior-day Custom seed in IST', () => {
    assert.deepStrictEqual(getExposureDateRange('allTime', '2026-01-03'), {
      dateFrom: '2000-01-01',
      dateTo: '2026-01-03',
    })
    assert.deepStrictEqual(getExposureDateRange('today', '2026-01-03'), {
      dateFrom: '2026-01-03',
      dateTo: '2026-01-03',
    })
    assert.deepStrictEqual(getExposureDateRange('yesterday', '2026-01-01'), {
      dateFrom: '2025-12-31',
      dateTo: '2025-12-31',
    })
    assert.deepStrictEqual(getExposureDateRange('custom', '2026-03-01'), {
      dateFrom: '2026-01-30',
      dateTo: '2026-03-01',
    })
  })

  test('uses the current IST day when no test day is supplied', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-02T20:00:00.000Z'))

    assert.deepStrictEqual(getExposureDateRange('today'), {
      dateFrom: '2026-01-03',
      dateTo: '2026-01-03',
    })
  })

  test('returns the same signed non-inclusive day-difference strings as the query', () => {
    assert.equal(exposureRangeDays('2026-01-01', '2026-01-01'), '0')
    assert.equal(exposureRangeDays('2025-12-31', '2026-01-03'), '3')
    assert.equal(exposureRangeDays('2026-01-03', '2025-12-31'), '-3')
  })
})

describe('exposure filtering', () => {
  test('formats the searchable day in the browser timezone like the legacy page', () => {
    const value = '2026-01-02T00:30:00.000Z'
    const local = new Date(value)
    const expected = [
      local.getFullYear(),
      String(local.getMonth() + 1).padStart(2, '0'),
      String(local.getDate()).padStart(2, '0'),
    ].join('-')

    assert.equal(formatExposureSearchDate(value), expected)
    assert.equal(formatExposureSearchDate('not-a-date'), 'Invalid Date')
  })

  test('defaults to newest-first without mutating the raw response', () => {
    const originalOrder = ROWS.map((row) => row.dimension)
    const filtered = filterExposureRows(ROWS, {
      domain: 'all',
      search: '',
      ...FILTER_FORMATTERS,
    })

    assert.deepStrictEqual(filtered.map((row) => row.dimension), ['Casino', 'All', 'MATKA', 'Sports'])
    assert.deepStrictEqual(ROWS.map((row) => row.dimension), originalOrder)
  })

  test('keeps All rows in each specific domain and excludes every other dimension', () => {
    const sports = filterExposureRows(ROWS, {
      domain: 'sports',
      search: '',
      ...FILTER_FORMATTERS,
    })
    const matka = filterExposureRows(ROWS, {
      domain: 'matka',
      search: '',
      ...FILTER_FORMATTERS,
    })

    assert.deepStrictEqual(sports.map((row) => row.dimension), ['All', 'Sports'])
    assert.deepStrictEqual(matka.map((row) => row.dimension), ['All', 'MATKA'])
  })

  test('matches dimension, formatted date, and converted then formatted amount', () => {
    assert.deepStrictEqual(filterExposureRows(ROWS, {
      domain: 'all',
      search: 'sPoRt',
      ...FILTER_FORMATTERS,
    }).map((row) => row.dimension), ['Sports'])

    assert.deepStrictEqual(filterExposureRows(ROWS, {
      domain: 'all',
      search: '2026-01-02',
      ...FILTER_FORMATTERS,
    }).map((row) => row.dimension), ['MATKA'])

    assert.deepStrictEqual(filterExposureRows(ROWS, {
      domain: 'all',
      search: 'INR 5,000.00',
      ...FILTER_FORMATTERS,
    }).map((row) => row.dimension), ['All'])
  })

  test('uses trim only as the nonempty guard and keeps the raw query for matching', () => {
    assert.equal(filterExposureRows(ROWS, {
      domain: 'all',
      search: '   ',
      ...FILTER_FORMATTERS,
    }).length, ROWS.length)

    assert.deepStrictEqual(filterExposureRows(ROWS, {
      domain: 'all',
      search: ' sports ',
      ...FILTER_FORMATTERS,
    }), [])
  })
})

describe('exposure pagination and page-local sorting', () => {
  test('slices only the requested page', () => {
    const rows = Array.from({ length: 7 }, (_, index): ExposureDataPoint => ({
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      value: index + 1,
      dimension: `Row ${index + 1}`,
    }))
    assert.deepStrictEqual(
      paginateExposureRows(rows, 2, 3).map((row) => row.value),
      [4, 5, 6],
    )
  })

  test('cycles each sortable key through ascending, descending and cleared', () => {
    const dateAsc = nextExposureSort(null, 'date')
    assert.deepStrictEqual(dateAsc, { key: 'date', dir: 'asc' })
    const dateDesc = nextExposureSort(dateAsc, 'date')
    assert.deepStrictEqual(dateDesc, { key: 'date', dir: 'desc' })
    assert.equal(nextExposureSort(dateDesc, 'date'), null)
    assert.deepStrictEqual(nextExposureSort(dateDesc, 'value'), { key: 'value', dir: 'asc' })
  })

  test('sorts only the supplied page and a cleared sort preserves its default order and identity', () => {
    const currentPage = [ROWS[1], ROWS[2], ROWS[0]]
    assert.equal(sortExposurePage(currentPage, null), currentPage)
    assert.deepStrictEqual(
      sortExposurePage(currentPage, { key: 'date', dir: 'asc' }).map((row) => row.dimension),
      ['Sports', 'MATKA', 'All'],
    )
    assert.deepStrictEqual(
      sortExposurePage(currentPage, { key: 'value', dir: 'desc' }).map((row) => row.value),
      [2_500, 100, 50],
    )
    assert.deepStrictEqual(currentPage.map((row) => row.dimension), ['All', 'MATKA', 'Sports'])
  })

  test('retains stable legacy ordering for rows within the same Unix second', () => {
    const currentPage: ExposureDataPoint[] = [
      { date: '2026-01-01T10:00:00.900Z', value: 1, dimension: 'First' },
      { date: '2026-01-01T10:00:00.100Z', value: 2, dimension: 'Second' },
    ]

    assert.deepStrictEqual(
      sortExposurePage(currentPage, { key: 'date', dir: 'asc' }).map((row) => row.dimension),
      ['First', 'Second'],
    )
  })
})

describe('exposure KPI calculations', () => {
  test('returns exact zeros and a signed two-decimal zero label for no data', () => {
    assert.deepStrictEqual(calculateExposureMetrics([]), {
      avgExposure: 0,
      maxExposure: 0,
      minExposure: 0,
      exposureChange: 0,
    })
    assert.equal(formatExposureChange(0), '+0.00%')
  })

  test('uses all raw values and the response-order first/last values', () => {
    const metrics = calculateExposureMetrics([
      { date: '2026-01-03', dimension: 'Sports', value: 100 },
      { date: '2026-01-02', dimension: 'Matka', value: -50 },
      { date: '2026-01-01', dimension: 'All', value: 125 },
    ])

    assert.deepStrictEqual(metrics, {
      avgExposure: 175 / 3,
      maxExposure: 125,
      minExposure: -50,
      exposureChange: 25,
    })
    assert.equal(formatExposureChange(metrics.exposureChange), '+25.00%')
    assert.equal(formatExposureChange(-12.345), '-12.35%')
  })

  test('the cards read the domain tab’s rows, in the server’s order (F-REP-17)', () => {
    const rows: ExposureDataPoint[] = [
      { date: '2026-01-01', dimension: 'SPORTS', value: 100 },
      { date: '2026-01-01', dimension: 'MATKA', value: 83_000 },
      { date: '2026-01-02', dimension: 'SPORTS', value: 300 },
    ]
    assert.deepStrictEqual(exposureDomainRows(rows, 'all'), rows)
    assert.deepStrictEqual(exposureDomainRows(rows, 'sports').map((row) => row.value), [100, 300])
    assert.deepStrictEqual(exposureDomainRows(rows, 'matka').map((row) => row.value), [83_000])
    // the matka peak no longer shows under Sports
    assert.equal(calculateExposureMetrics(exposureDomainRows(rows, 'sports')).maxExposure, 300)
    assert.equal(calculateExposureMetrics(exposureDomainRows(rows, 'sports')).avgExposure, 200)
  })

  test('keeps change at zero for one row or a zero first value', () => {
    assert.equal(calculateExposureMetrics([
      { date: '2026-01-01', dimension: 'All', value: 8 },
    ]).exposureChange, 0)
    assert.equal(calculateExposureMetrics([
      { date: '2026-01-01', dimension: 'All', value: 0 },
      { date: '2026-01-02', dimension: 'All', value: 100 },
    ]).exposureChange, 0)
  })

  test('preserves per-domain conversion and converts each All component before summing', () => {
    const convert = (amount: number) => amount * 1.5 + 1
    assert.equal(calculateTotalExposure('sports', 100, 50, convert), 151)
    assert.equal(calculateTotalExposure('matka', 100, 50, convert), 76)
    assert.equal(calculateTotalExposure('all', 100, 50, convert), 227)
    assert.equal(calculateTotalExposure('all', undefined, null, convert), 2)
  })
})

describe('exposure domain visibility', () => {
  test('shows every supported tab to admins regardless of an allowed-domain list', () => {
    assert.deepStrictEqual(visibleExposureDomains(false, []), ['all', 'sports', 'matka'])
  })

  test('always shows All to agents and shows only their supported Sports/Matka tabs', () => {
    assert.deepStrictEqual(visibleExposureDomains(true, ['casino']), ['all'])
    assert.deepStrictEqual(visibleExposureDomains(true, ['sports']), ['all', 'sports'])
    assert.deepStrictEqual(visibleExposureDomains(true, ['matka']), ['all', 'matka'])
    assert.deepStrictEqual(
      visibleExposureDomains(true, ['matka', 'sports']),
      ['all', 'sports', 'matka'],
    )
    assert.deepStrictEqual(
      visibleExposureDomains(true, undefined),
      ['all', 'sports', 'matka'],
    )
  })
})

describe('exposure KPI requests (SCO-07)', () => {
  test('a domain tab asks for its own total only, for an admin and an agent alike', () => {
    for (const isAgent of [false, true]) {
      assert.deepStrictEqual(exposureKpiSkips('all', isAgent, ['sports', 'casino', 'matka']), { sportsSkipped: false, matkaSkipped: false })
      assert.deepStrictEqual(exposureKpiSkips('sports', isAgent, ['sports', 'casino', 'matka']), { sportsSkipped: false, matkaSkipped: true })
      assert.deepStrictEqual(exposureKpiSkips('matka', isAgent, ['sports', 'casino', 'matka']), { sportsSkipped: true, matkaSkipped: false })
    }
  })

  test('an agent never asks for a domain its allowed domains lack, on any tab', () => {
    // the 113 COMMISSION agents: casino and sports only
    assert.deepStrictEqual(exposureKpiSkips('all', true, ['casino', 'sports']), { sportsSkipped: false, matkaSkipped: true })
    assert.deepStrictEqual(exposureKpiSkips('sports', true, ['casino', 'sports']), { sportsSkipped: false, matkaSkipped: true })
    assert.deepStrictEqual(exposureKpiSkips('all', true, ['matka']), { sportsSkipped: true, matkaSkipped: false })
    assert.deepStrictEqual(exposureKpiSkips('all', true, ['casino']), { sportsSkipped: true, matkaSkipped: true })
    assert.deepStrictEqual(exposureKpiSkips('all', true, []), { sportsSkipped: true, matkaSkipped: true })
    // no list at all reads as every domain, as the tabs do
    assert.deepStrictEqual(exposureKpiSkips('all', true, undefined), { sportsSkipped: false, matkaSkipped: false })
  })

  test('an admin is never held to an allowed-domain list', () => {
    assert.deepStrictEqual(exposureKpiSkips('all', false, []), { sportsSkipped: false, matkaSkipped: false })
    assert.deepStrictEqual(exposureKpiSkips('all', false, ['casino']), { sportsSkipped: false, matkaSkipped: false })
  })
})
