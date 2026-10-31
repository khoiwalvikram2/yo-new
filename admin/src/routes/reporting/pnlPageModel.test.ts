import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  PNL_DEFAULT_PAGE_SIZE,
  PNL_DOMAIN_LABELS,
  PNL_PAGE_SIZE_OPTIONS,
  calculatePnlMetrics,
  calculateTotalPnl,
  filterPnlRows,
  formatPnlChange,
  formatPnlSearchDate,
  formatSignedPnl,
  isCommissionAgent,
  isPnlPermissionRefusal,
  legacyUnixSeconds,
  paginatePnlRows,
  pnlActiveFilterCount,
  pnlCopy,
  pnlDomainTone,
  pnlExportColumns,
  pnlExportTitle,
  pnlRangeDays,
  pnlRefusedTotalsText,
  pnlStatusLabel,
  pnlTotalsIssues,
  sortPnlPage,
  visiblePnlDomains,
  type PnlDataPoint,
} from './pnlPageModel'

const formatAmount = (amount: number) => `₹${amount.toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`
const double = (amount: number) => amount * 2

function row(date: string, dimension: string, value: number): PnlDataPoint {
  return { date, dimension, value }
}

describe('pnlRangeDays — the PNL operation range', () => {
  test('counts the calendar days between the two applied days, as dayjs diff did', () => {
    // 2000-01-01 → 2026-01-01 is 26 years with 7 leap days; then 279 days to 7 Oct 2026.
    assert.equal(pnlRangeDays('2000-01-01', '2026-10-07'), '9776')
    assert.equal(pnlRangeDays('2026-10-07', '2026-10-07'), '0')
    assert.equal(pnlRangeDays('2026-01-02', '2026-01-04'), '2')
    assert.equal(pnlRangeDays('2024-02-28', '2024-03-01'), '2')
    assert.equal(pnlRangeDays('2025-12-31', '2026-01-01'), '1')
    // a European DST change between the days does not shorten the count
    assert.equal(pnlRangeDays('2026-03-28', '2026-03-30'), '2')
  })

  test('returns NaN for a value that is not a real day, as an unparseable dayjs date did', () => {
    assert.equal(pnlRangeDays('', '2026-10-07'), 'NaN')
    assert.equal(pnlRangeDays('2026-10-07', 'garbage'), 'NaN')
  })
})

describe('personas', () => {
  test('a commission agent is an agent on the COMMISSION scheme only', () => {
    assert.equal(isCommissionAgent(true, 'COMMISSION'), true)
    assert.equal(isCommissionAgent(false, 'COMMISSION'), false)
    assert.equal(isCommissionAgent(true, 'CREDIT'), false)
    assert.equal(isCommissionAgent(true, 'SHARING'), false)
    assert.equal(isCommissionAgent(true, undefined), false)
  })

  test('keeps every legacy string for both personas', () => {
    assert.deepStrictEqual(pnlCopy(false), {
      title: 'Profit & Loss Report',
      sub: 'Analyze profit and loss performance across all domains',
      totalLabel: 'Total P&L',
      avgLabel: 'Average P&L',
      rateLabel: 'Win Rate',
      bestLabel: 'Profitable Days',
      tableTitle: 'Profit & Loss Data',
      valueHeader: 'P&L',
      exportFilename: 'PNL-Report',
      sheetName: 'P&L',
      exportTitleLead: 'P&L',
      searchLabel: 'Search P&L',
      emptyTitle: 'No P&L data',
      statsLabel: 'P&L statistics',
    })
    assert.deepStrictEqual(pnlCopy(true), {
      title: 'Commission Earned Report',
      sub: 'Track your commission earnings from player turnover',
      totalLabel: 'Total Commission',
      avgLabel: 'Avg Commission',
      rateLabel: 'Earning Rate',
      bestLabel: 'Best Earning',
      tableTitle: 'Commission Earned Data',
      valueHeader: 'Commission',
      exportFilename: 'Commission-Earned-Report',
      sheetName: 'Commission',
      exportTitleLead: 'Commission Earned',
      searchLabel: 'Search commission',
      emptyTitle: 'No commission data',
      statsLabel: 'Commission statistics',
    })
    assert.equal(pnlExportTitle(pnlCopy(false), 12), 'P&L — 12 record(s)')
    assert.equal(pnlExportTitle(pnlCopy(true), 1), 'Commission Earned — 1 record(s)')
  })

  test('shows every domain to an admin and only the allowed ones to an agent', () => {
    assert.deepStrictEqual(visiblePnlDomains(false, ['sports']), ['all', 'sports', 'casino', 'matka'])
    assert.deepStrictEqual(visiblePnlDomains(true, ['sports']), ['all', 'sports'])
    assert.deepStrictEqual(visiblePnlDomains(true, ['matka', 'casino']), ['all', 'casino', 'matka'])
    assert.deepStrictEqual(visiblePnlDomains(true, null), ['all', 'sports', 'casino', 'matka'])
    assert.deepStrictEqual(visiblePnlDomains(true, undefined), ['all', 'sports', 'casino', 'matka'])
    // an empty list is a list (the legacy `||` kept it), so only All remains
    assert.deepStrictEqual(visiblePnlDomains(true, []), ['all'])
    assert.deepStrictEqual(PNL_DOMAIN_LABELS, {
      all: 'All Domains',
      sports: 'Sports',
      casino: 'Casino',
      matka: 'Matka',
    })
    assert.deepStrictEqual([...PNL_PAGE_SIZE_OPTIONS], [10, 20, 50, 100])
    assert.equal(PNL_DEFAULT_PAGE_SIZE, 20)
  })
})

describe('dates read the way dayjs read them', () => {
  test('unix seconds floor the instant and are NaN for an invalid date', () => {
    assert.equal(legacyUnixSeconds('2026-01-05T10:00:00.999Z'), Date.UTC(2026, 0, 5, 10) / 1000)
    assert.ok(Number.isNaN(legacyUnixSeconds(null)))
    assert.ok(Number.isNaN(legacyUnixSeconds('')))
    assert.ok(Number.isNaN(legacyUnixSeconds('garbage')))
    // a bare day is local midnight (dayjs), not UTC midnight (new Date)
    assert.equal(legacyUnixSeconds('2026-01-05'), new Date(2026, 0, 5).getTime() / 1000)
  })

  test('the search day is the browser-local day, Invalid Date otherwise', () => {
    const instant = '2026-01-05T10:00:00.000Z'
    const local = new Date(instant)
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
    assert.equal(formatPnlSearchDate(instant), expected)
    assert.equal(formatPnlSearchDate('2026-01-05'), '2026-01-05')
    assert.equal(formatPnlSearchDate(null), 'Invalid Date')
    assert.equal(formatPnlSearchDate('garbage'), 'Invalid Date')
  })
})

describe('filterPnlRows', () => {
  const rows = [
    row('2026-01-01T10:00:00.000Z', 'Sports', 100),
    row('2026-01-03T10:00:00.000Z', 'Casino', -50),
    row('2026-01-02T10:00:00.000Z', 'Matka', 1234),
    row('2026-01-04T10:00:00.000Z', 'All', 700),
  ]
  const options = { formatAmount, convertAmount: double }

  test('All keeps every row, newest first', () => {
    const result = filterPnlRows(rows, { ...options, domain: 'all', search: '' })
    assert.deepStrictEqual(result.map((r) => r.dimension), ['All', 'Casino', 'Matka', 'Sports'])
    assert.notEqual(result, rows)
  })

  test('a domain keeps its own rows and the server All rows, in any case', () => {
    const mixed = [...rows, row('2026-01-05T10:00:00.000Z', 'SPORTS', 1), row('2026-01-06T10:00:00.000Z', 'all', 2)]
    assert.deepStrictEqual(
      filterPnlRows(mixed, { ...options, domain: 'sports', search: '' }).map((r) => r.dimension),
      ['all', 'SPORTS', 'All', 'Sports'],
    )
    assert.deepStrictEqual(
      filterPnlRows(rows, { ...options, domain: 'casino', search: '' }).map((r) => r.dimension),
      ['All', 'Casino'],
    )
    assert.deepStrictEqual(
      filterPnlRows(rows, { ...options, domain: 'matka', search: '' }).map((r) => r.dimension),
      ['All', 'Matka'],
    )
  })

  test('searches the domain, the local day and the converted amount; spaces alone do not search', () => {
    assert.equal(filterPnlRows(rows, { ...options, domain: 'all', search: '   ' }).length, 4)
    assert.deepStrictEqual(
      filterPnlRows(rows, { ...options, domain: 'all', search: 'CAS' }).map((r) => r.dimension),
      ['Casino'],
    )
    // 1234 converted to 2468 and formatted
    assert.deepStrictEqual(
      filterPnlRows(rows, { ...options, domain: 'all', search: '₹2,468' }).map((r) => r.dimension),
      ['Matka'],
    )
    const day = formatPnlSearchDate('2026-01-03T10:00:00.000Z')
    assert.ok(
      filterPnlRows(rows, { ...options, domain: 'all', search: day }).some((r) => r.dimension === 'Casino'),
    )
    // the query is lower-cased but the date key is not, so "Invalid Date" can never match
    const undated = [row(null as unknown as string, 'Other', 5)]
    assert.equal(filterPnlRows(undated, { ...options, domain: 'all', search: 'invalid' }).length, 0)
    assert.equal(filterPnlRows(undated, { ...options, domain: 'all', search: 'Invalid' }).length, 0)
    assert.equal(filterPnlRows(undated, { ...options, domain: 'all', search: 'oth' }).length, 1)
  })

  test('rows in the same second keep their order', () => {
    const tied = [
      row('2026-01-03T10:00:00.900Z', 'First', 1),
      row('2026-01-03T10:00:00.100Z', 'Second', 2),
    ]
    assert.deepStrictEqual(
      filterPnlRows(tied, { ...options, domain: 'all', search: '' }).map((r) => r.dimension),
      ['First', 'Second'],
    )
  })
})

describe('paging and sorting', () => {
  const rows = Array.from({ length: 25 }, (_, index) => row(`2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`, 'Sports', index))

  test('slices the filtered rows for a page', () => {
    assert.deepStrictEqual(paginatePnlRows(rows, 1, 20).map((r) => r.value), rows.slice(0, 20).map((r) => r.value))
    assert.deepStrictEqual(paginatePnlRows(rows, 2, 20).map((r) => r.value), [20, 21, 22, 23, 24])
    assert.deepStrictEqual(paginatePnlRows(rows, 3, 20), [])
  })

  test('sorts the page by value or date, keeps ties and extra fields, and leaves it alone when cleared', () => {
    const page = [
      { ...row('2026-01-02T10:00:00.000Z', 'B', 50), rowKey: 'b' },
      { ...row('2026-01-01T10:00:00.000Z', 'A', -10), rowKey: 'a' },
      { ...row('2026-01-03T10:00:00.000Z', 'C', 50), rowKey: 'c' },
    ]
    assert.equal(sortPnlPage(page, null), page)
    assert.deepStrictEqual(sortPnlPage(page, { key: 'value', dir: 'asc' }).map((r) => r.rowKey), ['a', 'b', 'c'])
    assert.deepStrictEqual(sortPnlPage(page, { key: 'value', dir: 'desc' }).map((r) => r.rowKey), ['b', 'c', 'a'])
    assert.deepStrictEqual(sortPnlPage(page, { key: 'date', dir: 'asc' }).map((r) => r.rowKey), ['a', 'b', 'c'])
    assert.deepStrictEqual(sortPnlPage(page, { key: 'date', dir: 'desc' }).map((r) => r.rowKey), ['c', 'b', 'a'])
  })
})

describe('figures', () => {
  test('are zero without rows', () => {
    assert.deepStrictEqual(calculatePnlMetrics([]), {
      avgPnl: 0,
      maxPnl: 0,
      pnlChange: 0,
      positiveDays: 0,
      negativeDays: 0,
      winRate: 0,
    })
  })

  test('average, best, profitable and loss days, win rate and change from the raw rows in order', () => {
    const metrics = calculatePnlMetrics([
      row('2026-01-01', 'Sports', -200),
      row('2026-01-02', 'Sports', 0),
      row('2026-01-03', 'Sports', 500),
      row('2026-01-04', 'Sports', 100),
    ])
    assert.deepStrictEqual(metrics, {
      avgPnl: 100,
      maxPnl: 500,
      pnlChange: 150,
      positiveDays: 2,
      negativeDays: 1,
      winRate: 50,
    })
  })

  test('keeps the legacy change rules for one row and a zero first row', () => {
    assert.equal(calculatePnlMetrics([row('d', 'x', 40)]).pnlChange, 0)
    assert.equal(calculatePnlMetrics([row('d', 'x', 0), row('d', 'x', 5)]).pnlChange, 100)
    assert.equal(calculatePnlMetrics([row('d', 'x', 0), row('d', 'x', 0)]).pnlChange, -100)
    assert.equal(calculatePnlMetrics([row('d', 'x', 0), row('d', 'x', -5)]).pnlChange, -100)
    assert.equal(calculatePnlMetrics([row('d', 'x', 200), row('d', 'x', 50)]).pnlChange, -75)
  })

  test('the total is one converted domain, or the three converted and summed', () => {
    assert.equal(calculateTotalPnl('sports', 10, 20, 30, double), 20)
    assert.equal(calculateTotalPnl('matka', 10, 20, 30, double), 40)
    assert.equal(calculateTotalPnl('casino', 10, 20, 30, double), 60)
    assert.equal(calculateTotalPnl('all', 10, 20, 30, double), 120)
    assert.equal(calculateTotalPnl('all', undefined, null, 5, double), 10)
    assert.equal(calculateTotalPnl('casino', null, null, undefined, double), 0)
  })
})

describe('totals that did not load', () => {
  const refusal = (domain: string) => ({
    networkError: null,
    graphQLErrors: [{ message: `Forbidden: insufficient permissions for reporting.${domain}:view` }],
  })
  const serverFailure = { networkError: null, graphQLErrors: [{ message: 'Database timeout' }] }
  const networkFailure = { networkError: new Error('Failed to fetch'), graphQLErrors: [] }

  test('a refusal is a permission message from the server with nothing failed on the wire', () => {
    assert.equal(isPnlPermissionRefusal(refusal('sports')), true)
    assert.equal(isPnlPermissionRefusal({ graphQLErrors: [{ message: 'Permission denied' }] }), true)
    assert.equal(isPnlPermissionRefusal(serverFailure), false)
    assert.equal(isPnlPermissionRefusal(networkFailure), false)
    // a refusal that also failed on the wire, or mixed with another error, is a failure
    assert.equal(isPnlPermissionRefusal({ ...refusal('sports'), networkError: new Error('x') }), false)
    assert.equal(
      isPnlPermissionRefusal({ graphQLErrors: [...refusal('sports').graphQLErrors, { message: 'Database timeout' }] }),
      false,
    )
    assert.equal(isPnlPermissionRefusal({ graphQLErrors: [] }), false)
    assert.equal(isPnlPermissionRefusal(undefined), false)
    assert.equal(isPnlPermissionRefusal(null), false)
  })

  test('sorts the totals feeding the Total card into refusals and failures', () => {
    const errors = { sports: refusal('sports'), casino: networkFailure, matka: refusal('matka') }
    assert.deepStrictEqual(pnlTotalsIssues('all', errors), { refused: ['sports', 'matka'], failed: ['casino'] })
    assert.deepStrictEqual(pnlTotalsIssues('sports', errors), { refused: ['sports'], failed: [] })
    assert.deepStrictEqual(pnlTotalsIssues('casino', errors), { refused: [], failed: ['casino'] })
    // a domain whose own total loaded raises nothing, whatever the others did
    assert.deepStrictEqual(
      pnlTotalsIssues('matka', { sports: serverFailure, casino: refusal('casino'), matka: undefined }),
      { refused: [], failed: [] },
    )
    assert.deepStrictEqual(
      pnlTotalsIssues('all', { sports: undefined, casino: null, matka: undefined }),
      { refused: [], failed: [] },
    )
  })

  test('the refusal sentence names the reports and the persona total', () => {
    assert.equal(
      pnlRefusedTotalsText(pnlCopy(false), ['sports', 'casino', 'matka']),
      'You do not have access to the Sports, Casino and Matka reports, so Total P&L does not include them.',
    )
    assert.equal(
      pnlRefusedTotalsText(pnlCopy(false), ['casino', 'matka']),
      'You do not have access to the Casino and Matka reports, so Total P&L does not include them.',
    )
    assert.equal(
      pnlRefusedTotalsText(pnlCopy(true), ['sports']),
      'You do not have access to the Sports report, so Total Commission does not include it.',
    )
  })
})

describe('labels', () => {
  test('signs, statuses and tones', () => {
    assert.equal(formatPnlChange(12.5), '+12.50%')
    assert.equal(formatPnlChange(0), '+0.00%')
    assert.equal(formatPnlChange(-3), '-3.00%')
    assert.equal(formatSignedPnl(0, '₹0.00'), '+₹0.00')
    assert.equal(formatSignedPnl(-5, '-₹5.00'), '-₹5.00')
    assert.equal(pnlStatusLabel(0, false), 'Profit')
    assert.equal(pnlStatusLabel(-1, false), 'Loss')
    assert.equal(pnlStatusLabel(10, true), 'Earned')
    assert.equal(pnlStatusLabel(-1, true), 'Zero')
    assert.equal(pnlDomainTone('All'), 'info')
    assert.equal(pnlDomainTone('all'), 'ok')
    assert.equal(pnlDomainTone('Sports'), 'ok')
  })

  test('counts search, domain and period once each, spaces included', () => {
    assert.equal(pnlActiveFilterCount('', 'all', 'allTime'), 0)
    assert.equal(pnlActiveFilterCount('  ', 'all', 'allTime'), 1)
    assert.equal(pnlActiveFilterCount('x', 'sports', 'today'), 3)
    assert.equal(pnlActiveFilterCount('', 'all', 'custom'), 1)
  })

  test('the export columns keep their headers, widths and raw values', () => {
    const formatDateTime = (value: string, pattern?: string) => `${pattern}|${value}`
    const columns = pnlExportColumns(false, formatDateTime)
    assert.deepStrictEqual(
      columns.map(({ header, key, width }) => ({ header, key, width })),
      [
        { header: 'Date', key: 'date', width: 18 },
        { header: 'Domain', key: 'dimension', width: 12 },
        { header: 'P&L', key: 'value', width: 14 },
        { header: 'Status', key: 'status', width: 10 },
      ],
    )
    const sample = row('2026-01-05T10:00:00.000Z', 'Sports', -25)
    assert.deepStrictEqual(columns.map((column) => column.getter(sample)), [
      'yyyy-MM-dd HH:mm|2026-01-05T10:00:00.000Z',
      'Sports',
      -25,
      'Loss',
    ])
    const commission = pnlExportColumns(true, formatDateTime)
    assert.equal(commission[2].header, 'Commission')
    assert.deepStrictEqual(
      commission.map((column) => column.getter({ date: '', dimension: undefined as unknown as string, value: 7 })),
      ['—', '', 7, 'Earned'],
    )
  })
})
