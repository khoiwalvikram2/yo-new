import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import ExposurePage from './ExposurePage'
import {
  exposureRangeDays,
  getExposureDateRange,
  type ExposureDataPoint,
} from './exposurePageModel'

interface QueryOptions {
  variables: Record<string, unknown>
  errorPolicy: string
  skip?: boolean
  fetchPolicy: string
  notifyOnNetworkStatusChange?: boolean
}

interface QueryState {
  data?: Record<string, unknown>
  loading: boolean
  error?: { message: string }
}

interface MockAgent {
  schemeType: string
  allowedDomains: string[]
}

interface MockAuthStore {
  agent?: MockAgent
  isAgent: () => boolean
}

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  bypassForAgents?: boolean
}

interface DateRangeFieldProps {
  label?: string
  appliedPreset: string
  appliedFrom?: string
  appliedTo?: string
  onApply: (payload:
    | { kind: 'preset'; preset: string }
    | { kind: 'custom'; from: string; to: string }
  ) => void
  onReset: () => void
}

const apollo = vi.hoisted(() => ({
  useQuery: vi.fn(),
  refetchExposure: vi.fn(),
  states: {} as Record<string, QueryState>,
  options: new Map<string, QueryOptions>(),
  documents: new Map<string, unknown>(),
}))

const auth = vi.hoisted(() => ({
  isAgent: false,
  agent: undefined as MockAgent | undefined,
}))

const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as GuardCall[],
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return { ...actual, useQuery: apollo.useQuery }
})

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount * 2,
    formatAmount: (amount: number) => `₹${amount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string, pattern?: string) => (
      pattern === 'yyyy-MM-dd' ? value.slice(0, 10) : `shown:${value}`
    ),
  }),
}))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: MockAuthStore) => unknown) => selector({
    agent: auth.agent,
    isAgent: () => auth.isAgent,
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    bypassForAgents,
    children,
  }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required, bypassForAgents })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

// The date-range primitive has its own interaction suite. These deterministic controls keep this
// route test focused on the page's applied variables and page-reset contract.
vi.mock('@/ui/components/DateRangeField', () => ({
  DateRangeField: ({
    label = 'Period',
    appliedPreset,
    appliedFrom,
    appliedTo,
    onApply,
    onReset,
  }: DateRangeFieldProps) => (
    <fieldset>
      <legend>{label}</legend>
      <output data-testid="period-state">
        {`${appliedPreset}|${appliedFrom ?? ''}|${appliedTo ?? ''}`}
      </output>
      <button type="button" onClick={() => onApply({ kind: 'preset', preset: 'today' })}>
        Apply Today
      </button>
      <button
        type="button"
        onClick={() => onApply({
          kind: 'custom',
          from: '2026-01-02',
          to: '2026-01-04',
        })}
      >
        Apply Custom Range
      </button>
      <button type="button" onClick={onReset}>Reset Period</button>
    </fieldset>
  ),
}))

function operationName(document: unknown): string {
  const definition = (document as {
    definitions?: Array<{ name?: { value?: string } }>
  }).definitions?.[0]
  return definition?.name?.value ?? ''
}

function normalisedDocument(document: unknown): string {
  const source = (document as {
    loc?: { source?: { body?: string } }
  }).loc?.source?.body
  assert.ok(source, 'Expected the GraphQL source body to be retained')
  return source.replace(/\s+/g, ' ').trim()
}

function queryOptions(name: string): QueryOptions {
  const options = apollo.options.get(name)
  assert.ok(options, `Expected ${name} query options`)
  return options
}

function queryDocument(name: string): unknown {
  const document = apollo.documents.get(name)
  assert.ok(document, `Expected ${name} document`)
  return document
}

function makeRows(count = 25): ExposureDataPoint[] {
  const dimensions = ['Sports', 'Matka', 'All'] as const
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    dimension: dimensions[index % dimensions.length],
    value: (index + 1) * 137,
  }))
}

function setReadyData(rows: ExposureDataPoint[] = makeRows()) {
  apollo.states.Exposure = {
    data: { exposure: rows },
    loading: false,
  }
  apollo.states.SportsKPIs = {
    data: {
      sportsKPIs: {
        totalExposure: 100,
        totalStakes: 500,
        totalPayouts: 400,
        grossGamingRevenue: 100,
      },
    },
    loading: false,
  }
  apollo.states.MatkaKPIs = {
    data: {
      matkaKPIs: {
        totalExposure: 200,
        totalStakes: 700,
        totalPayouts: 500,
        grossGamingRevenue: 200,
      },
    },
    loading: false,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PageEyebrowProvider value="Reporting">
        <ExposurePage />
      </PageEyebrowProvider>
    </MemoryRouter>,
  )
}

function currentPage(): string | null {
  return screen.getByRole('button', { current: 'page' }).textContent
}

beforeEach(() => {
  auth.isAgent = false
  auth.agent = undefined
  guard.allowed = true
  guard.calls.length = 0
  apollo.options.clear()
  apollo.documents.clear()
  apollo.useQuery.mockReset()
  apollo.refetchExposure.mockReset()
  apollo.refetchExposure.mockImplementation(() => Promise.resolve({ data: apollo.states.Exposure.data }))
  setReadyData()

  apollo.useQuery.mockImplementation((document: unknown, options: QueryOptions) => {
    const name = operationName(document)
    apollo.documents.set(name, document)
    apollo.options.set(name, options)
    const state = apollo.states[name] ?? { loading: false }
    return {
      ...state,
      refetch: name === 'Exposure' ? apollo.refetchExposure : vi.fn(),
    }
  })
})

afterEach(() => {
  cleanup()
})

describe('ExposurePage query, access and persona contracts', () => {
  test('keeps all three operations, exact initial variables, section eyebrow and agent bypass', () => {
    renderPage()
    const range = getExposureDateRange('allTime')

    assert.equal(
      normalisedDocument(queryDocument('Exposure')),
      'query Exposure($range: String, $dateFrom: String, $dateTo: String) { exposure(range: $range, dateFrom: $dateFrom, dateTo: $dateTo) { dimension value date } }',
    )
    assert.equal(
      normalisedDocument(queryDocument('SportsKPIs')),
      'query SportsKPIs($filter: SportsReportingFilter) { sportsKPIs(filter: $filter) { totalExposure totalStakes totalPayouts grossGamingRevenue } }',
    )
    assert.equal(
      normalisedDocument(queryDocument('MatkaKPIs')),
      'query MatkaKPIs($filter: MatkaReportingFilter) { matkaKPIs(filter: $filter) { totalExposure totalStakes totalPayouts grossGamingRevenue } }',
    )
    assert.deepStrictEqual(queryOptions('Exposure'), {
      variables: {
        range: exposureRangeDays(range.dateFrom, range.dateTo),
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      },
      errorPolicy: 'all',
      skip: false,
      fetchPolicy: 'network-only',
      notifyOnNetworkStatusChange: true,
    })
    assert.deepStrictEqual(queryOptions('SportsKPIs'), {
      variables: {
        filter: {
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          domain: undefined,
        },
      },
      skip: false,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })
    assert.deepStrictEqual(queryOptions('MatkaKPIs'), {
      variables: { filter: { dateFrom: range.dateFrom, dateTo: range.dateTo } },
      skip: false,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })
    assert.deepStrictEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.exposure', actions: ['view'] }],
      bypassForAgents: true,
    })
    assert.ok(screen.queryByText('Reporting') === null)
    assert.ok(screen.getByRole('heading', { name: 'Exposure Report', level: 1 }))
  })

  test('does not mount queries when the guard denies an admin', () => {
    guard.allowed = false
    renderPage()

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(apollo.useQuery.mock.calls.length, 0)
    assert.equal(screen.queryByRole('heading', { name: 'Exposure Report' }), null)
    assert.deepStrictEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.exposure', actions: ['view'] }],
      bypassForAgents: true,
    })
  })

  test('shows all admin tabs and only each agent persona\'s allowed supported domains', () => {
    const scenarios: Array<{
      name: string
      isAgent: boolean
      agent?: MockAgent
      visible: string[]
      hidden: string[]
    }> = [
      {
        name: 'admin',
        isAgent: false,
        visible: ['All Domains', 'Sports', 'Matka'],
        hidden: [],
      },
      {
        name: 'CREDIT sports agent',
        isAgent: true,
        agent: { schemeType: 'CREDIT', allowedDomains: ['sports'] },
        visible: ['All Domains', 'Sports'],
        hidden: ['Matka'],
      },
      {
        name: 'SHARING matka agent',
        isAgent: true,
        agent: { schemeType: 'SHARING', allowedDomains: ['matka'] },
        visible: ['All Domains', 'Matka'],
        hidden: ['Sports'],
      },
      {
        name: 'COMMISSION casino-only agent',
        isAgent: true,
        agent: { schemeType: 'COMMISSION', allowedDomains: ['casino'] },
        visible: ['All Domains'],
        hidden: ['Sports', 'Matka'],
      },
    ]

    for (const scenario of scenarios) {
      auth.isAgent = scenario.isAgent
      auth.agent = scenario.agent
      renderPage()
      const group = screen.getByRole('group', { name: 'Domain filter' })
      for (const label of scenario.visible) {
        assert.ok(within(group).getByRole('button', { name: label }), scenario.name)
      }
      for (const label of scenario.hidden) {
        assert.equal(within(group).queryByRole('button', { name: label }), null, scenario.name)
      }
      cleanup()
    }
  })
})

describe('ExposurePage filters, sorting and pagination', () => {
  test('resets the page for search, domain, preset and custom range changes', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    assert.equal(currentPage(), '2')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exposure' }), {
      target: { value: '2026' },
    })
    await waitFor(() => assert.equal(currentPage(), '1'))

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sports' }))
    await waitFor(() => {
      assert.equal(currentPage(), '1')
      assert.equal(queryOptions('SportsKPIs').skip, false)
      assert.equal(queryOptions('MatkaKPIs').skip, true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply Today' }))
    await waitFor(() => {
      assert.equal(currentPage(), '1')
      assert.deepStrictEqual(queryOptions('Exposure').variables, {
        range: '0',
        ...getExposureDateRange('today'),
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply Custom Range' }))
    await waitFor(() => {
      assert.equal(currentPage(), '1')
      assert.deepStrictEqual(queryOptions('Exposure').variables, {
        range: '2',
        dateFrom: '2026-01-02',
        dateTo: '2026-01-04',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Matka' }))
    await waitFor(() => {
      assert.equal(queryOptions('SportsKPIs').skip, true)
      assert.deepStrictEqual(queryOptions('SportsKPIs').variables.filter, {
        dateFrom: '2026-01-02',
        dateTo: '2026-01-04',
        domain: null,
      })
      assert.equal(queryOptions('MatkaKPIs').skip, false)
    })
  })

  test('cycles sortable columns and matches converted, formatted amounts locally', async () => {
    setReadyData([
      { date: '2026-01-03T10:00:00.000Z', dimension: 'Sports', value: 700 },
      { date: '2026-01-02T10:00:00.000Z', dimension: 'Matka', value: 1234 },
      { date: '2026-01-01T10:00:00.000Z', dimension: 'All', value: 50 },
    ])
    renderPage()

    const exposureHeader = screen.getByRole('columnheader', { name: /Exposure/ })
    const sortButton = within(exposureHeader).getByRole('button', { name: 'Exposure' })
    assert.equal(exposureHeader.getAttribute('aria-sort'), 'none')
    fireEvent.click(sortButton)
    assert.equal(exposureHeader.getAttribute('aria-sort'), 'ascending')
    assert.ok(screen.getAllByRole('row')[1]?.textContent?.includes('₹100.00'))
    fireEvent.click(sortButton)
    assert.equal(exposureHeader.getAttribute('aria-sort'), 'descending')
    assert.ok(screen.getAllByRole('row')[1]?.textContent?.includes('₹2,468.00'))
    fireEvent.click(sortButton)
    assert.equal(exposureHeader.getAttribute('aria-sort'), 'none')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exposure' }), {
      target: { value: '₹2,468.00' },
    })
    await waitFor(() => assert.match(screen.getByText('1 record').textContent ?? '', /1 record/))
    assert.ok(screen.getAllByText('₹2,468.00').length >= 1)
    assert.ok(screen.queryByText('₹1,400.00') === null)
  })

  test('keeps the legacy stable order when date sorting sees rows in the same Unix second', () => {
    setReadyData([
      { date: '2026-01-03T10:00:00.900Z', dimension: 'First', value: 10 },
      { date: '2026-01-03T10:00:00.100Z', dimension: 'Second', value: 20 },
    ])
    renderPage()

    const dateHeader = screen.getByRole('columnheader', { name: /Date/ })
    fireEvent.click(within(dateHeader).getByRole('button', { name: 'Date' }))
    const rows = screen.getAllByRole('row')
    assert.match(rows[1]?.textContent ?? '', /First/)
    assert.match(rows[2]?.textContent ?? '', /Second/)
  })

  test('keeps controlled offset pagination and resets to page one for a page-size change', async () => {
    renderPage()

    assert.ok(screen.getByText('Total 25 records'))
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(currentPage(), '2'))
    assert.equal(screen.getAllByRole('row').length, 6)

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '10' } })
    await waitFor(() => assert.equal(currentPage(), '1'))
    assert.ok(screen.getByRole('button', { name: 'Page 3' }))
    assert.equal(screen.getAllByRole('row').length, 11)
  })
})

describe('ExposurePage metrics and data states', () => {
  test('shows the preserved KPI math and refreshes only the Exposure operation', async () => {
    setReadyData([
      { date: '2026-01-02T10:00:00.000Z', dimension: 'Sports', value: 100 },
      { date: '2026-01-01T10:00:00.000Z', dimension: 'Matka', value: 150 },
    ])
    renderPage()

    assert.ok(screen.getByText('₹600.00'))
    assert.ok(screen.getByText('Change: +50.00%'))
    assert.ok(screen.getByText('₹250.00'))
    assert.ok(screen.getAllByText('2 records').length >= 1)
    assert.ok(screen.getAllByText('₹300.00').length >= 1)
    assert.ok(screen.getByText('Min: ₹200.00'))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(apollo.refetchExposure.mock.calls.length, 1))
  })

  test('retains table headers for loading and empty states', () => {
    apollo.states.Exposure = { data: { exposure: [] }, loading: true }
    renderPage()
    assert.ok(screen.getByRole('columnheader', { name: /Date/ }))
    assert.ok(screen.getByRole('columnheader', { name: /Domain/ }))
    assert.ok(screen.getByRole('columnheader', { name: /Exposure/ }))
    assert.ok(screen.getByText('Loading Exposure data'))

    cleanup()
    apollo.options.clear()
    apollo.documents.clear()
    setReadyData([])
    renderPage()
    assert.ok(screen.getByText('No exposure data'))
    assert.ok(screen.getByText('Total 0 records'))
  })

  test('shows partial KPI and Exposure errors without discarding available rows', () => {
    apollo.states.SportsKPIs.error = { message: 'sports totals unavailable' }
    apollo.states.Exposure.error = { message: 'exposure refresh failed' }
    renderPage()

    assert.ok(screen.getByText('Some totals could not be loaded'))
    assert.ok(screen.getByText('exposure refresh failed'))
    assert.ok(screen.getAllByRole('row').length > 1)
    assert.ok(screen.getByText('Total 25 records'))
  })

  test('exposes retry for a full Exposure error', async () => {
    apollo.states.Exposure = {
      data: { exposure: [] },
      loading: false,
      error: { message: 'Exposure service unavailable' },
    }
    renderPage()

    assert.ok(screen.getByText('Exposure service unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.equal(apollo.refetchExposure.mock.calls.length, 1))
  })
})
