/**
 * The Export Center's React-free logic (page migration C, W3 Task 128). The legacy values pinned here
 * come from the dayjs code of ExportsPage.tsx before the task, run by a throwaway script
 * (D:/MERN/codex-temp/task128/legacy-proof.mjs) under UTC, Asia/Kolkata, America/Los_Angeles,
 * America/New_York, Europe/London, Asia/Tokyo and Australia/Sydney.
 */
import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  BACKEND_SUPPORTED_EXPORT_TYPE_IDS,
  DEFAULT_AGENT_DOMAINS,
  EXPORT_CATEGORY_LABELS,
  EXPORT_CATEGORY_OPTIONS,
  EXPORT_TYPES,
  HISTORY_PAGE_SIZE,
  HISTORY_PAGE_SIZE_OPTIONS,
  HISTORY_STATUS_OPTIONS,
  availableExportTypes,
  buildEstimateFilters,
  buildExportFiltersJson,
  buildExportJobInput,
  clampPage,
  createFilterCount,
  errorMessageOf,
  exportAnalytics,
  exportDateRange,
  exportEstimateKey,
  exportFilterValue,
  exportJobFilename,
  exportJobStatusLabel,
  exportTypeById,
  exportTypeExcerpt,
  exportTypeName,
  filterSelectOptions,
  filterSelectValue,
  formatEstimate,
  formatEstimateSize,
  formatRowCount,
  groupExportTypes,
  historyRangeText,
  inProgressMessage,
  isPendingJob,
  pageRows,
  templatePeriod,
  wholeDaysBetween,
  wholeMinutesBetween,
  type ExportJob,
  type ExportTypeAccess,
} from './exportsPageModel'

const STARTING_ZONE = process.env.TZ

/* The legacy maths read the process zone, so a few cases pin it and check the pin took. */
function inZone<T>(zone: string, expectedJanuaryOffset: number, run: () => T): T {
  process.env.TZ = zone
  assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), expectedJanuaryOffset, `zone ${zone} did not take`)
  return run()
}

afterEach(() => {
  if (STARTING_ZONE === undefined) delete process.env.TZ
  else process.env.TZ = STARTING_ZONE
})

const ADMIN: ExportTypeAccess = {
  roles: ['Super Admin'],
  isAgent: false,
  allowedDomains: DEFAULT_AGENT_DOMAINS,
  search: '',
}

const ids = (types: readonly { id: string }[]) => types.map((type) => type.id)

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: '3f2a9c1e-0000-4000-8000-000000000001',
    reportType: 'players',
    exportFormat: 'CSV',
    status: 'completed',
    fileUrl: '/files/1',
    errorMessage: null,
    scheduledAt: null,
    completedAt: '2026-10-07T06:03:30.000Z',
    createdAt: '2026-10-07T06:00:00.000Z',
    ...overrides,
  }
}

describe('the catalogue', () => {
  test('keeps the legacy twenty types, their order, categories, formats and filters', () => {
    assert.deepEqual(ids(EXPORT_TYPES), [
      'players', 'transactions', 'commission', 'settlement', 'ggr', 'subagents', 'agents', 'sports-bets',
      'casino-bets', 'matka-bets', 'sports-kpis', 'casino-kpis', 'matka-kpis', 'agent-performance',
      'bonus-campaigns', 'exposure', 'pnl', 'audit-logs', 'deposits', 'withdrawals',
    ])
    assert.equal(exportTypeById('players')?.name, 'Players Data')
    assert.equal(
      exportTypeById('players')?.description,
      'Comprehensive player list with balances, stats, activity, and profile information',
    )
    assert.deepEqual(exportTypeById('agents')?.filters?.map((filter) => filter.label), ['Agent Status', 'Agent Level'])
    assert.deepEqual(
      exportTypeById('bonus-campaigns')?.filters?.[1].options?.map((option) => option.label),
      ['All Domains', 'Sports', 'Casino', 'Matka', 'Global'],
    )
    assert.ok(EXPORT_TYPES.every((type) => type.availableFormats.join() === 'csv,xlsx'))
    assert.deepEqual(
      EXPORT_TYPES.filter((type) => !type.requiresDateRange).map((type) => type.id),
      ['players', 'subagents', 'agents'],
    )
    assert.deepEqual(
      Object.fromEntries(EXPORT_TYPES.map((type) => [type.id, type.glyph])),
      {
        players: 'file', transactions: 'file', commission: 'sheet', settlement: 'sheet', ggr: 'sheet',
        subagents: 'file', agents: 'file', 'sports-bets': 'file', 'casino-bets': 'file', 'matka-bets': 'file',
        'sports-kpis': 'chart', 'casino-kpis': 'chart', 'matka-kpis': 'chart', 'agent-performance': 'chart',
        'bonus-campaigns': 'chart', exposure: 'search', pnl: 'chart', 'audit-logs': 'search', deposits: 'file',
        withdrawals: 'file',
      },
    )
  })

  test('keeps the category labels, the category options and the backend-supported list', () => {
    assert.deepEqual(EXPORT_CATEGORY_LABELS, {
      core: 'Core Data',
      betting: 'Betting Data',
      financial: 'Financial Reports',
      analytics: 'Analytics & KPIs',
      payments: 'Payment Requests',
      system: 'System Data',
    })
    assert.deepEqual(EXPORT_CATEGORY_OPTIONS.map((option) => option.value), [
      'core', 'betting', 'financial', 'analytics', 'payments', 'system',
    ])
    assert.equal(BACKEND_SUPPORTED_EXPORT_TYPE_IDS.size, 14)
    assert.equal(BACKEND_SUPPORTED_EXPORT_TYPE_IDS.has('pnl'), false)
    assert.equal(exportTypeName('players'), 'Players Data')
    assert.equal(exportTypeName('mystery-report'), 'mystery-report')
  })
})

describe('availableExportTypes', () => {
  test('an admin without the agent role sees the eleven supported, ungated types in catalogue order', () => {
    assert.deepEqual(ids(availableExportTypes(ADMIN)), [
      'players', 'transactions', 'ggr', 'agents', 'sports-bets', 'casino-bets', 'matka-bets',
      'bonus-campaigns', 'audit-logs', 'deposits', 'withdrawals',
    ])
  })

  test('the agent role, in any case, opens the commission, settlement and sub-agent exports', () => {
    const types = ids(availableExportTypes({ ...ADMIN, roles: ['AGENT'] }))
    assert.equal(types.length, 14)
    assert.ok(types.includes('commission') && types.includes('settlement') && types.includes('subagents'))
  })

  test("an agent sees exactly its scheme's exports, narrowed by its domains, whatever its roles", () => {
    const agent = (agentSchemeType: string, allowedDomains: readonly string[], roles: readonly string[] = []) =>
      ids(availableExportTypes({ roles, isAgent: true, agentSchemeType, allowedDomains, search: '' }))

    assert.deepEqual(agent('commission', DEFAULT_AGENT_DOMAINS), [
      'players', 'commission', 'subagents', 'sports-bets', 'casino-bets', 'matka-bets', 'deposits', 'withdrawals',
    ])
    for (const scheme of ['sharing', 'credit']) {
      assert.deepEqual(agent(scheme, DEFAULT_AGENT_DOMAINS), [
        'players', 'settlement', 'subagents', 'sports-bets', 'casino-bets', 'matka-bets', 'deposits', 'withdrawals',
      ], scheme)
    }
    // An agent session carries no roles; the admin role rule does not apply to it either way.
    assert.deepEqual(agent('sharing', ['casino'], ['agent']), agent('sharing', ['casino']))
    assert.deepEqual(agent('sharing', ['casino']), ['players', 'settlement', 'subagents', 'casino-bets', 'deposits', 'withdrawals'])
    assert.deepEqual(agent('COMMISSION', []), ['players', 'commission', 'subagents', 'deposits', 'withdrawals'], 'the scheme case does not matter')

    // Domains narrow only an agent.
    assert.ok(ids(availableExportTypes({ ...ADMIN, allowedDomains: [] })).includes('sports-bets'))
  })

  test('an agent never sees the whitelabel-level or unscoped exports', () => {
    for (const scheme of ['commission', 'sharing', 'credit']) {
      const types = ids(availableExportTypes({
        roles: ['agent', 'Super Admin'],
        isAgent: true,
        agentSchemeType: scheme,
        allowedDomains: DEFAULT_AGENT_DOMAINS,
        search: '',
      }))
      for (const forbidden of ['audit-logs', 'bonus-campaigns', 'ggr', 'transactions', 'agents']) {
        assert.equal(types.includes(forbidden), false, `${scheme} sees ${forbidden}`)
      }
    }
  })

  test('an agent session without a scheme is offered nothing', () => {
    assert.deepEqual(availableExportTypes({ roles: [], isAgent: true, allowedDomains: DEFAULT_AGENT_DOMAINS, search: '' }), [])
  })

  test('category and a case-insensitive search over name and description', () => {
    assert.deepEqual(ids(availableExportTypes({ ...ADMIN, category: 'payments' })), ['deposits', 'withdrawals'])
    assert.deepEqual(ids(availableExportTypes({ ...ADMIN, search: 'MATKA' })), ['matka-bets'])
    assert.deepEqual(ids(availableExportTypes({ ...ADMIN, search: 'rtp data' })), ['casino-bets'])
    assert.deepEqual(availableExportTypes({ ...ADMIN, search: 'no such export' }), [])
  })

  test('groups by category in the order each first appears', () => {
    const groups = groupExportTypes(availableExportTypes(ADMIN))
    assert.deepEqual(groups.map((group) => group.category), [
      'core', 'financial', 'betting', 'analytics', 'system', 'payments',
    ])
    assert.deepEqual(groups.map((group) => group.label), [
      'Core Data', 'Financial Reports', 'Betting Data', 'Analytics & KPIs', 'System Data', 'Payment Requests',
    ])
    assert.deepEqual(ids(groups[0].types), ['players', 'transactions', 'agents'])
    assert.deepEqual(groupExportTypes([]), [])
  })
})

describe('filters and the export input', () => {
  test('counts search, category and a period other than All time', () => {
    assert.equal(createFilterCount('', undefined, 'allTime'), 0)
    assert.equal(createFilterCount('mat', undefined, 'allTime'), 1)
    assert.equal(createFilterCount('mat', 'core', 'today'), 3)
    assert.equal(createFilterCount('', undefined, 'custom'), 1)
  })

  test('a type filter stores All as no choice', () => {
    assert.equal(exportFilterValue('all'), undefined)
    assert.equal(exportFilterValue(''), undefined)
    assert.equal(exportFilterValue('active'), 'active')
  })

  test('the period becomes the first and last instant of the IST days, in any process zone', () => {
    for (const [zone, offset] of [['UTC', 0], ['Asia/Kolkata', -330], ['America/Los_Angeles', 480]] as const) {
      inZone(zone, offset, () => {
        assert.deepEqual(exportDateRange('2026-10-07', '2026-10-07'), {
          from: '2026-10-06T18:30:00.000Z',
          to: '2026-10-07T18:29:59.999Z',
        })
        assert.deepEqual(exportDateRange('2000-01-01', '2026-10-07'), {
          from: '1999-12-31T18:30:00.000Z',
          to: '2026-10-07T18:29:59.999Z',
        })
        // The legacy dayjs.tz start in Los Angeles on its clock-change day was an hour off
        // (2026-10-31T19:30:00.000Z); the page sends the real IST midnight.
        assert.equal(exportDateRange('2026-11-01', '2026-11-01')?.from, '2026-10-31T18:30:00.000Z')
      })
    }
    assert.equal(exportDateRange('', '2026-10-07'), undefined)
    assert.equal(exportDateRange('2026-10-07', ''), undefined)
    assert.equal(exportDateRange('Invalid Date', '2026-10-07'), undefined)
  })

  test('filtersJson keeps the legacy keys and order, with the agent and its tenant', () => {
    const dateRange = { from: '2026-10-06T18:30:00.000Z', to: '2026-10-07T18:29:59.999Z' }
    const admin = buildExportFiltersJson({ activeFilters: { status: 'active' }, dateRange, isAgent: false })
    assert.deepEqual(Object.entries(admin), [
      ['status', 'active'],
      ['dateFrom', dateRange.from],
      ['dateTo', dateRange.to],
    ])
    const agent = buildExportFiltersJson({
      activeFilters: { domain: 'casino' },
      dateRange,
      isAgent: true,
      agentId: 'agent-7',
      tenantId: 'tenant-2',
    })
    assert.deepEqual(Object.keys(agent), ['domain', 'dateFrom', 'dateTo', 'agentId', 'tenant'])
    assert.equal(agent.agentId, 'agent-7')
    assert.equal(agent.tenant, 'tenant-2')

    // A template's own dates keep their key position and take the applied period's values.
    const fromTemplate = buildExportFiltersJson({
      activeFilters: { dateFrom: 'old', status: 'won', dateTo: 'old' },
      dateRange,
      isAgent: false,
    })
    assert.deepEqual(Object.entries(fromTemplate), [
      ['dateFrom', dateRange.from],
      ['status', 'won'],
      ['dateTo', dateRange.to],
    ])
    assert.deepEqual(buildExportFiltersJson({ activeFilters: {}, isAgent: false }), {})

    const estimate = buildEstimateFilters({ activeFilters: { a: 1 }, dateRange, isAgent: true, agentId: 'agent-7' })
    assert.deepEqual(Object.keys(estimate), ['a', 'dateFrom', 'dateTo', 'agentId'])
  })

  test('the job input upper-cases the format and leaves out an empty schedule', () => {
    assert.deepEqual(buildExportJobInput('players', { a: 1 }, 'csv'), {
      reportType: 'players',
      filtersJson: { a: 1 },
      exportFormat: 'CSV',
      scheduledAt: undefined,
    })
    assert.equal(buildExportJobInput('ggr', {}, 'xlsx', '').scheduledAt, undefined)
    assert.equal(buildExportJobInput('ggr', {}, 'xlsx', '2026-10-08T04:30:00.000Z').scheduledAt, '2026-10-08T04:30:00.000Z')
    assert.deepEqual(Object.keys(buildExportJobInput('ggr', {}, 'xlsx')), ['reportType', 'filtersJson', 'exportFormat', 'scheduledAt'])
  })

  test('a type filter select shows All for no choice and keeps a retained value', () => {
    const status = exportTypeById('players')?.filters?.[0]
    assert.ok(status)
    assert.equal(filterSelectValue(undefined), '')
    assert.equal(filterSelectValue('all'), '')
    assert.equal(filterSelectValue('active'), 'active')
    assert.deepEqual(filterSelectOptions(status, undefined), [
      { label: 'All', value: '' },
      { label: 'Active', value: 'active' },
      { label: 'Inactive', value: 'inactive' },
      { label: 'Suspended', value: 'suspended' },
    ])
    assert.deepEqual(filterSelectOptions(status, 'ACTIVE').at(-1), { label: 'ACTIVE', value: 'ACTIVE' })
    assert.equal(filterSelectOptions(status, 'all').length, 4)
  })
})

describe('estimates', () => {
  test('keys, sizes and row counts read as before', () => {
    const dateRange = { from: 'F', to: 'T' }
    assert.equal(exportEstimateKey('players', { status: 'active' }, dateRange), 'players-{"status":"active"}-F-T')
    assert.equal(exportEstimateKey('players', {}, undefined), 'players-{}-all')
    assert.equal(formatEstimateSize(0), '0 B')
    assert.equal(formatEstimateSize(1023), '1023 B')
    assert.equal(formatEstimateSize(1024), '1.0 KB')
    assert.equal(formatEstimateSize(10000), '9.8 KB')
    assert.equal(formatEstimateSize(1024 * 1024), '1.00 MB')
    assert.equal(formatRowCount(999), '999')
    assert.equal(formatRowCount(1000), '1.0K')
    assert.equal(formatRowCount(1500000), '1.50M')
    assert.equal(formatEstimate({ rows: 1200, size: '234.4 KB' }), '1.2K rows • ~234.4 KB')
  })

  test('whole days between the period instants count as dayjs did, browser zone included', () => {
    const days = (from: string, to: string) => {
      const range = exportDateRange(from, to)
      assert.ok(range)
      return wholeDaysBetween(range.from, range.to)
    }
    inZone('Asia/Kolkata', -330, () => {
      assert.equal(days('2026-10-07', '2026-10-07'), 0)
      assert.equal(days('2026-09-07', '2026-10-07'), 30)
      assert.equal(days('2000-01-01', '2026-10-07'), 9776)
      assert.equal(days('2026-03-01', '2026-03-15'), 14)
    })
    // Legacy dayjs took the browser zone's offset change out of a day difference, so across the US
    // spring-forward a Los Angeles browser counted one day more. Kept as it was.
    inZone('America/Los_Angeles', 480, () => {
      assert.equal(days('2026-03-01', '2026-03-15'), 15)
      assert.equal(days('2000-01-01', '2026-10-07'), 9777)
      assert.equal(days('2026-10-07', '2026-10-07'), 0)
    })
  })

  test('whole minutes truncate toward zero', () => {
    assert.equal(wholeMinutesBetween('2026-10-07T10:00:00.000Z', '2026-10-07T10:02:59.999Z'), 2)
    assert.equal(wholeMinutesBetween('2026-10-07T10:00:00.000Z', '2026-10-07T09:58:30.000Z'), -1)
    assert.equal(wholeMinutesBetween('2026-10-07T10:00:00.000Z', '2026-10-07T10:00:30.000Z'), 0)
  })
})

describe('jobs', () => {
  test('the four totals over the returned jobs', () => {
    assert.deepEqual(exportAnalytics([]), {
      total: 0, completed: 0, pending: 0, failed: 0, successRate: '0', avgProcessingTime: '0',
    })
    const totals = exportAnalytics([
      job({ id: 'a' }),
      job({ id: 'b', completedAt: '2026-10-07T06:00:59.000Z' }),
      job({ id: 'c', status: 'pending', completedAt: null }),
      job({ id: 'd', status: 'processing', completedAt: null }),
      job({ id: 'e', status: 'failed', completedAt: null }),
      job({ id: 'f', status: 'completed', completedAt: null }),
    ])
    assert.deepEqual(totals, {
      total: 6,
      completed: 3,
      pending: 2,
      failed: 1,
      successRate: '50.0',
      avgProcessingTime: '1.5',
    })
    assert.equal(isPendingJob({ status: 'processing' }), true)
    assert.equal(isPendingJob({ status: 'failed' }), false)
  })

  test('copy helpers: in progress, statuses, excerpts, history range', () => {
    assert.equal(inProgressMessage(1), '1 export currently in progress')
    assert.equal(inProgressMessage(3), '3 exports currently in progress')
    assert.equal(exportJobStatusLabel('completed'), 'Completed')
    assert.equal(exportJobStatusLabel('processing'), 'Processing')
    assert.equal(exportJobStatusLabel('pending'), 'Pending')
    assert.equal(exportJobStatusLabel('failed'), 'Failed')
    assert.equal(exportJobStatusLabel('queued'), 'queued')
    assert.equal(exportTypeExcerpt('players'), 'Comprehensive player list with balances, stats, ac...')
    assert.equal(exportTypeExcerpt('mystery-report'), '...')
    assert.equal(historyRangeText(11, 20, 42), '11-20 of 42 exports')
    assert.deepEqual(HISTORY_STATUS_OPTIONS.map((option) => option.label), [
      'All Status', 'Pending', 'Processing', 'Completed', 'Failed',
    ])
    assert.equal(HISTORY_PAGE_SIZE, 10)
    assert.deepEqual(HISTORY_PAGE_SIZE_OPTIONS, [10, 20, 50, 100])
  })

  test("a download's file name: the type, the creation day in the browser's zone, the id prefix", () => {
    const created = job({ createdAt: '2026-10-06T18:30:00.000Z', exportFormat: 'XLSX' })
    inZone('Asia/Kolkata', -330, () => {
      assert.equal(exportJobFilename(created), 'Players Data-2026-10-07-3f2a9c1e.xlsx')
    })
    inZone('UTC', 0, () => {
      assert.equal(exportJobFilename(created), 'Players Data-2026-10-06-3f2a9c1e.xlsx')
      assert.equal(
        exportJobFilename(job({ reportType: 'mystery-report', createdAt: 'not a date' })),
        'mystery-report-Invalid Date-3f2a9c1e.csv',
      )
    })
  })

  test('paging clamps to the pages that exist', () => {
    const rows = Array.from({ length: 23 }, (_, index) => index)
    assert.deepEqual(pageRows(rows, 3, 10), [20, 21, 22])
    assert.deepEqual(pageRows(rows, 9, 10), [20, 21, 22])
    assert.deepEqual(pageRows([], 2, 10), [])
    assert.equal(clampPage(0, 23, 10), 1)
    assert.equal(clampPage(4, 23, 10), 3)
  })
})

describe('templates and errors', () => {
  test("a template's stored instants come back as their IST days", () => {
    assert.deepEqual(
      templatePeriod({ dateFrom: '2026-09-06T18:30:00.000Z', dateTo: '2026-10-07T18:29:59.999Z' }),
      { dateFrom: '2026-09-07', dateTo: '2026-10-07' },
    )
    // either side of IST midnight
    assert.deepEqual(
      templatePeriod({ dateFrom: '2026-10-06T18:29:59.999Z', dateTo: '2026-10-06T18:30:00.000Z' }),
      { dateFrom: '2026-10-06', dateTo: '2026-10-07' },
    )
    assert.equal(templatePeriod({ dateFrom: '2026-10-06T18:30:00.000Z' }), null)
    assert.equal(templatePeriod({ dateFrom: 1, dateTo: 2 }), null)
    assert.equal(templatePeriod({ dateFrom: 'not a date', dateTo: 'nor this' }), null)
    assert.equal(templatePeriod(null), null)
  })

  test('errorMessageOf reads a text message from anything thrown', () => {
    assert.equal(errorMessageOf(new Error('boom')), 'boom')
    assert.equal(errorMessageOf({ message: 'plain' }), 'plain')
    assert.equal(errorMessageOf({ message: 42 }), '')
    assert.equal(errorMessageOf('text'), '')
    assert.equal(errorMessageOf(null), '')
  })
})
