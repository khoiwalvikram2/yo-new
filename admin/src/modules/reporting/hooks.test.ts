import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { renderHook } from '@testing-library/react'
import type { DocumentNode } from 'graphql'
import { useReportingStore, type ReportingFilters } from '@/state/reportingStore'
import * as documents from './graphql'
import * as hooks from './hooks'

/* hooks.ts after W3 Task 120: antd `notification` became the kit notify service with every title and
   text kept, and `any` became `unknown`. These tests hold the hooks to what they sent before — the
   same document, variables and options — and pin each toast's copy. */

interface CapturedOptions {
  variables?: Record<string, unknown>
  errorPolicy?: string
  fetchPolicy?: string
  skip?: boolean
  refetchQueries?: unknown
  onCompleted?: () => void
  onError?: (error: Error) => void
}

const apollo = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  mutate: vi.fn(),
}))

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return { ...actual, useQuery: apollo.useQuery, useMutation: apollo.useMutation }
})

vi.mock('@/shared/services/notification', () => ({ notify }))

const STORE_FILTERS: ReportingFilters = {
  tenant: 't1',
  whitelabelId: 'wl-1',
  dateFrom: '2000-01-01',
  dateTo: '2026-10-07',
  currency: undefined,
  domain: 'sports',
  schemeType: 'CREDIT',
}

function lastCall(mock: typeof apollo.useQuery): [DocumentNode, CapturedOptions] {
  const call = mock.mock.calls.at(-1)
  assert.ok(call, 'the hook called Apollo')
  return call as [DocumentNode, CapturedOptions]
}

beforeEach(() => {
  apollo.useQuery.mockReset()
  apollo.useMutation.mockReset()
  apollo.mutate.mockReset()
  for (const fn of Object.values(notify)) fn.mockReset()
  apollo.useQuery.mockImplementation(() => ({ data: undefined, loading: false }))
  apollo.useMutation.mockImplementation(() => [apollo.mutate, { loading: false }])
  useReportingStore.setState({ filters: { ...STORE_FILTERS } })
})

describe('mutation hooks', () => {
  const SAVED_REFETCH = [{ query: documents.SAVED_REPORTS_QUERY }]
  const cases = [
    {
      name: 'useCreateSavedReport',
      run: () => hooks.useCreateSavedReport(),
      key: 'createSavedReport',
      document: documents.CREATE_SAVED_REPORT_MUTATION,
      refetch: SAVED_REFETCH,
      done: ['Your report configuration has been saved successfully.', 'Report Saved'],
      failed: 'Failed to Save Report',
    },
    {
      name: 'useUpdateSavedReport',
      run: () => hooks.useUpdateSavedReport(),
      key: 'updateSavedReport',
      document: documents.UPDATE_SAVED_REPORT_MUTATION,
      refetch: SAVED_REFETCH,
      done: ['Your report configuration has been updated successfully.', 'Report Updated'],
      failed: 'Failed to Update Report',
    },
    {
      name: 'useDeleteSavedReport',
      run: () => hooks.useDeleteSavedReport(),
      key: 'deleteSavedReport',
      document: documents.DELETE_SAVED_REPORT_MUTATION,
      refetch: SAVED_REFETCH,
      done: ['Your report has been deleted successfully.', 'Report Deleted'],
      failed: 'Failed to Delete Report',
    },
    {
      name: 'useCreateExportJob',
      run: () => hooks.useCreateExportJob(),
      key: 'createExportJob',
      document: documents.CREATE_EXPORT_JOB_MUTATION,
      refetch: undefined,
      done: ['Your export job has been created and will be processed shortly.', 'Export Job Created'],
      failed: 'Failed to Create Export Job',
    },
    {
      name: 'useRefreshSnapshots',
      run: () => hooks.useRefreshSnapshots(),
      key: 'refreshSnapshots',
      document: documents.REFRESH_SNAPSHOTS_MUTATION,
      refetch: undefined,
      done: ['Reporting snapshots have been refreshed successfully.', 'Snapshots Refreshed'],
      failed: 'Failed to Refresh Snapshots',
    },
  ] as const

  for (const item of cases) {
    test(`${item.name} keeps its document, refetch and returned API, and toasts the legacy copy`, () => {
      const { result } = renderHook(() => item.run())
      const [document, options] = lastCall(apollo.useMutation)

      assert.equal(document, item.document)
      assert.deepEqual(
        Object.keys(options),
        item.refetch ? ['refetchQueries', 'onCompleted', 'onError'] : ['onCompleted', 'onError'],
      )
      assert.deepEqual(options.refetchQueries, item.refetch)
      assert.deepEqual(result.current, { [item.key]: apollo.mutate, loading: false })

      options.onCompleted?.()
      assert.deepEqual(notify.success.mock.calls, [[...item.done]])
      assert.equal(notify.error.mock.calls.length, 0)

      options.onError?.(new Error('Network down'))
      assert.deepEqual(notify.error.mock.calls, [['Network down', item.failed]])
      assert.equal(notify.success.mock.calls.length, 1)
    })
  }
})

describe('drill-down query hooks', () => {
  const sportsFilter = { sportId: '4', dateFrom: '2026-10-01', dateTo: '2026-10-07' }
  const cases = [
    { name: 'useSportsLeagueBreakdown', run: hooks.useSportsLeagueBreakdown, document: documents.SPORTS_LEAGUE_BREAKDOWN_QUERY, title: 'Failed to load league breakdown' },
    { name: 'useSportsEventBreakdown', run: hooks.useSportsEventBreakdown, document: documents.SPORTS_EVENT_BREAKDOWN_QUERY, title: 'Failed to load event breakdown' },
    { name: 'useSportsMarketBreakdown', run: hooks.useSportsMarketBreakdown, document: documents.SPORTS_MARKET_BREAKDOWN_QUERY, title: 'Failed to load market breakdown' },
    { name: 'useSportsAgentBreakdown', run: hooks.useSportsAgentBreakdown, document: documents.SPORTS_AGENT_BREAKDOWN_QUERY, title: 'Failed to load agent breakdown' },
    { name: 'useSportsPlayerBreakdown', run: hooks.useSportsPlayerBreakdown, document: documents.SPORTS_PLAYER_BREAKDOWN_QUERY, title: 'Failed to load player breakdown' },
    { name: 'useCasinoProviderBreakdown', run: hooks.useCasinoProviderBreakdown, document: documents.CASINO_PROVIDER_BREAKDOWN_QUERY, title: 'Failed to load provider breakdown' },
    { name: 'useCasinoVendorBreakdown', run: hooks.useCasinoVendorBreakdown, document: documents.CASINO_VENDOR_BREAKDOWN_QUERY, title: 'Failed to load vendor breakdown' },
    { name: 'useCasinoGameBreakdown', run: hooks.useCasinoGameBreakdown, document: documents.CASINO_GAME_BREAKDOWN_QUERY, title: 'Failed to load game breakdown' },
    { name: 'useCasinoAgentBreakdown', run: hooks.useCasinoAgentBreakdown, document: documents.CASINO_AGENT_BREAKDOWN_QUERY, title: 'Failed to load agent breakdown' },
    { name: 'useCasinoPlayerBreakdown', run: hooks.useCasinoPlayerBreakdown, document: documents.CASINO_PLAYER_BREAKDOWN_QUERY, title: 'Failed to load player breakdown' },
    { name: 'useMatkaTypeBreakdown', run: hooks.useMatkaTypeBreakdown, document: documents.MATKA_TYPE_BREAKDOWN_QUERY, title: 'Failed to load matka type breakdown' },
    { name: 'useMatkaMarketBreakdown', run: hooks.useMatkaMarketBreakdown, document: documents.MATKA_MARKET_BREAKDOWN_QUERY, title: 'Failed to load market breakdown' },
    { name: 'useMatkaSessionBreakdown', run: hooks.useMatkaSessionBreakdown, document: documents.MATKA_SESSION_BREAKDOWN_QUERY, title: 'Failed to load session breakdown' },
    { name: 'useMatkaAgentBreakdown', run: hooks.useMatkaAgentBreakdown, document: documents.MATKA_AGENT_BREAKDOWN_QUERY, title: 'Failed to load agent breakdown' },
    { name: 'useMatkaPlayerBreakdown', run: hooks.useMatkaPlayerBreakdown, document: documents.MATKA_PLAYER_BREAKDOWN_QUERY, title: 'Failed to load player breakdown' },
    { name: 'useAgentPlayerBreakdown', run: hooks.useAgentPlayerBreakdown, document: documents.AGENT_PLAYER_BREAKDOWN_QUERY, title: 'Failed to load player breakdown' },
  ] as const

  for (const item of cases) {
    test(`${item.name} keeps its document and policies and toasts "${item.title}" with the error text`, () => {
      renderHook(() => item.run({ ...sportsFilter, eventId: 'e-1' }))
      const [document, options] = lastCall(apollo.useQuery)

      assert.equal(document, item.document)
      assert.equal(options.errorPolicy, 'all')
      assert.equal(options.fetchPolicy, 'network-only')
      assert.equal(options.skip ?? false, false)

      options.onError?.(new Error('Upstream timeout'))
      assert.deepEqual(notify.error.mock.calls, [['Upstream timeout', item.title]])
      assert.equal(notify.success.mock.calls.length, 0)
    })
  }

  test('sports drill-downs send the filter as given, {} when absent; market skips without an event', () => {
    renderHook(() => hooks.useSportsLeagueBreakdown(sportsFilter))
    assert.deepEqual(lastCall(apollo.useQuery)[1].variables, { filter: sportsFilter })
    assert.equal(lastCall(apollo.useQuery)[1].variables?.filter, sportsFilter, 'the same object, not a copy')

    renderHook(() => hooks.useSportsEventBreakdown(undefined))
    assert.deepEqual(lastCall(apollo.useQuery)[1].variables, { filter: {} })

    renderHook(() => hooks.useSportsMarketBreakdown(sportsFilter))
    assert.equal(lastCall(apollo.useQuery)[1].skip, true)
    renderHook(() => hooks.useSportsMarketBreakdown(null))
    assert.equal(lastCall(apollo.useQuery)[1].skip, true)
    assert.deepEqual(lastCall(apollo.useQuery)[1].variables, { filter: {} })

    renderHook(() => hooks.useSportsAgentBreakdown(null))
    assert.equal(lastCall(apollo.useQuery)[1].skip, true)
    renderHook(() => hooks.useSportsPlayerBreakdown(sportsFilter))
    assert.equal(lastCall(apollo.useQuery)[1].skip, false)
  })

  test('casino agent and player drill-downs drop only _refreshKey, and skip without a filter', () => {
    const filter = { whitelabelId: 'wl-1', vendorId: 'v-9', dateFrom: '2026-10-01', _refreshKey: 3 }
    renderHook(() => hooks.useCasinoAgentBreakdown(filter))
    const sent = lastCall(apollo.useQuery)[1].variables?.filter as Record<string, unknown>
    assert.deepEqual(sent, { whitelabelId: 'wl-1', vendorId: 'v-9', dateFrom: '2026-10-01' })
    assert.deepEqual(Object.keys(sent), ['whitelabelId', 'vendorId', 'dateFrom'], 'key order kept')
    assert.equal(filter._refreshKey, 3, 'the caller object is not mutated')
    assert.equal(lastCall(apollo.useQuery)[1].skip, false)

    renderHook(() => hooks.useCasinoPlayerBreakdown(undefined))
    assert.deepEqual(lastCall(apollo.useQuery)[1].variables, { filter: {} })
    assert.equal(lastCall(apollo.useQuery)[1].skip, true)

    renderHook(() => hooks.useCasinoProviderBreakdown(filter))
    assert.equal(lastCall(apollo.useQuery)[1].variables?.filter, filter, 'provider sends the filter untouched')
  })

  test('matka drill-downs keep only the MatkaDrillDownFilter fields', () => {
    renderHook(() =>
      hooks.useMatkaSessionBreakdown({
        matkaType: 'starline',
        matkaId: 7,
        marketSession: 'open',
        schemeType: 'CREDIT',
        domain: 'matka',
        playerId: undefined,
        dateFrom: '2026-10-01',
      }),
    )
    assert.deepEqual(lastCall(apollo.useQuery)[1].variables, {
      filter: { dateFrom: '2026-10-01', matkaType: 'starline', matkaId: 7, marketSession: 'open' },
    })

    renderHook(() => hooks.useMatkaPlayerBreakdown(undefined))
    assert.deepEqual(lastCall(apollo.useQuery)[1].variables, { filter: undefined })
  })

  test('the agent player drill-down passes its filter through and never skips', () => {
    const filter = { agentId: 'a-1', schemeType: 'SHARING' }
    renderHook(() => hooks.useAgentPlayerBreakdown(filter))
    const [, options] = lastCall(apollo.useQuery)
    assert.equal(options.variables?.filter, filter)
    assert.equal(options.skip, false)
  })
})

describe('store-merged report hooks', () => {
  test('sports, casino and matka KPIs keep only the fields their filter type accepts', () => {
    renderHook(() => hooks.useSportsKPIs({ sportId: '4', campaignId: 'c-1' }))
    let [document, options] = lastCall(apollo.useQuery)
    assert.equal(document, documents.SPORTS_KPIS_QUERY)
    assert.deepEqual(options, {
      variables: {
        filter: { tenant: 't1', whitelabelId: 'wl-1', sportId: '4', dateFrom: '2000-01-01', dateTo: '2026-10-07' },
      },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })

    renderHook(() => hooks.useCasinoTrends({ agentId: 'a-1', vendorId: 'v-1' }))
    ;[document, options] = lastCall(apollo.useQuery)
    assert.equal(document, documents.CASINO_TRENDS_QUERY)
    assert.deepEqual(options.variables, {
      filter: { tenant: 't1', whitelabelId: 'wl-1', agentId: 'a-1', dateFrom: '2000-01-01', dateTo: '2026-10-07' },
    })

    renderHook(() => hooks.useMatkaKPIs({ matkaType: 'starline' }))
    ;[document, options] = lastCall(apollo.useQuery)
    assert.equal(document, documents.MATKA_KPIS_QUERY)
    assert.deepEqual(options.variables, {
      filter: { tenant: 't1', whitelabelId: 'wl-1', dateFrom: '2000-01-01', dateTo: '2026-10-07', matkaType: 'starline' },
    })
  })

  test('breakdown and top-events hooks add their own arguments; agent hooks send the merged filter whole', () => {
    renderHook(() => hooks.useSportsBreakdown('league'))
    assert.deepEqual(lastCall(apollo.useQuery)[1].variables, {
      filter: { tenant: 't1', whitelabelId: 'wl-1', dateFrom: '2000-01-01', dateTo: '2026-10-07' },
      dimension: 'league',
    })

    renderHook(() => hooks.useTopSportsEvents())
    assert.equal(lastCall(apollo.useQuery)[1].variables?.limit, 10)

    renderHook(() => hooks.useAgentPerformance(undefined, { agentId: 'a-2' }))
    const [document, options] = lastCall(apollo.useQuery)
    assert.equal(document, documents.AGENT_PERFORMANCE_QUERY)
    assert.deepEqual(options, {
      variables: { filter: { ...STORE_FILTERS, agentId: 'a-2' }, limit: 50 },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
      skip: false,
    })

    renderHook(() => hooks.useAgentKPIs())
    assert.deepEqual(lastCall(apollo.useQuery)[1].variables, { filter: { ...STORE_FILTERS } })
    renderHook(() => hooks.useAgentTrends({ dateFrom: '2026-10-01' }))
    assert.deepEqual(lastCall(apollo.useQuery)[1].variables, { filter: { ...STORE_FILTERS, dateFrom: '2026-10-01' } })
  })

  test('saved reports read with the shared policies and raise no toast', () => {
    renderHook(() => hooks.useSavedReports())
    const [document, options] = lastCall(apollo.useQuery)
    assert.equal(document, documents.SAVED_REPORTS_QUERY)
    assert.deepEqual(options, { errorPolicy: 'all', fetchPolicy: 'network-only' })
    assert.equal(notify.error.mock.calls.length, 0)
  })
})
