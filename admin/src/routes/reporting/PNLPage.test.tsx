/**
 * /reporting/pnl against a mocked GraphQL server (MockedProvider + MemoryRouter). The real page, the
 * kit and the real Apollo hooks run; useQuery is wrapped, not replaced, so every option the page passes
 * is recorded. The period control has its own suite (modules/reporting/ui/ReportingPeriodFilter.test.tsx)
 * and is a deterministic stub here; the Excel writer is stubbed through useTableExport.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import { computeReportingDateRange, type ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import PNLPage from './PNLPage'
import { pnlRangeDays, type PnlDataPoint } from './pnlPageModel'
import {
  AGENT_COMMISSION_DAYS_QUERY,
  CASINO_KPIS_QUERY,
  MATKA_KPIS_QUERY,
  PNL_QUERY,
  SPORTS_KPIS_QUERY,
} from './pnlPageQueries'

interface HookCall {
  name: string
  document: unknown
  options: Record<string, unknown>
}

interface MockAgent {
  schemeType: string
  allowedDomains?: string[]
}

interface ExportOptions {
  data: PnlDataPoint[]
  columns: Array<{ header: string; key: string; width?: number; getter: (row: PnlDataPoint) => unknown }>
  filename: string
  sheetName?: string
  title?: string
}

interface PeriodStubProps {
  dateFrom: string
  dateTo: string
  preset?: ReportingDatePreset
  onChange: (dateFrom: string, dateTo: string, preset: ReportingDatePreset) => void
}

const apollo = vi.hoisted(() => ({ queries: [] as HookCall[] }))

const auth = vi.hoisted(() => ({
  isAgent: false,
  agent: undefined as MockAgent | undefined,
}))

const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as unknown[],
}))

const exporter = vi.hoisted(() => ({
  options: [] as unknown[],
  handleExport: vi.fn(),
}))

const period = vi.hoisted(() => ({ today: '' }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const nameOf = (document: unknown) =>
    (document as { definitions?: Array<{ name?: { value?: string } }> }).definitions?.[0]?.name?.value ?? ''
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({
        name: nameOf(args[0]),
        document: args[0],
        options: (args[1] ?? {}) as Record<string, unknown>,
      })
      return actual.useQuery(...args)
    },
  }
})

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: MockAgent; isAgent: () => boolean }) => unknown) =>
    selector({ agent: auth.agent, isAgent: () => auth.isAgent }),
}))

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
    formatDateTime: (value: string, pattern?: string) => `${pattern} ${value.slice(0, 10)}`,
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, bypassForAgents, children }: {
    required: unknown
    bypassForAgents?: boolean
    children: ReactNode
  }) => {
    guard.calls.push({ required, bypassForAgents })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/hooks/useTableExport', () => ({
  useTableExport: (options: unknown) => {
    exporter.options.push(options)
    return { exporting: false, handleExport: exporter.handleExport }
  },
}))

vi.mock('@/modules/reporting/ui/ReportingPeriodFilter', () => ({
  ReportingPeriodFilter: ({ dateFrom, dateTo, preset, onChange }: PeriodStubProps) => (
    <div role="group" aria-label="Period (stub)">
      <output data-testid="period-state">{`${preset}|${dateFrom}|${dateTo}`}</output>
      <button type="button" onClick={() => onChange(period.today, period.today, 'today')}>
        Apply Today
      </button>
      <button type="button" onClick={() => onChange('2026-01-02', '2026-01-04', 'custom')}>
        Apply Custom Range
      </button>
    </div>
  ),
}))

const ALL_TIME = computeReportingDateRange('allTime')
const CUSTOM = { dateFrom: '2026-01-02', dateTo: '2026-01-04' }

const KPI = {
  sports: { __typename: 'SportsKPIs', grossGamingRevenue: 1, totalStakes: 2, totalPayouts: 3, netRevenue: 100 },
  matka: { __typename: 'MatkaKPIs', grossGamingRevenue: 1, totalStakes: 2, totalPayouts: 3, netRevenue: 50 },
  casino: { __typename: 'CasinoKPIs', grossGamingRevenue: 1, totalStakes: 2, totalPayouts: 3, netRevenue: 25 },
}

const FOUR_ROWS: PnlDataPoint[] = [
  { date: '2026-01-04T10:00:00.000Z', dimension: 'Sports', value: 100 },
  { date: '2026-01-03T10:00:00.000Z', dimension: 'Casino', value: -40 },
  { date: '2026-01-02T10:00:00.000Z', dimension: 'All', value: 0 },
  { date: '2026-01-01T10:00:00.000Z', dimension: 'Matka', value: 300 },
]

function manyRows(count: number): PnlDataPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    dimension: ['Sports', 'Casino', 'Matka', 'All'][index % 4],
    value: (index + 1) * 137,
  }))
}

const counts = { pnl: 0, sports: 0, matka: 0, casino: 0 }

type KpiDomain = 'sports' | 'matka' | 'casino'

interface MockSet {
  range?: { dateFrom: string; dateTo: string }
  rows?: PnlDataPoint[]
  pnlError?: string
  sportsError?: string
  /** The server refuses these totals as the reporting resolvers do for a role without the domain's view. */
  refused?: KpiDomain[]
  delay?: number
}

const KPI_DOCUMENTS = { sports: SPORTS_KPIS_QUERY, matka: MATKA_KPIS_QUERY, casino: CASINO_KPIS_QUERY }

function refusedKpi(domain: KpiDomain, filter: object): MockedResponse {
  return {
    request: { query: KPI_DOCUMENTS[domain], variables: filter },
    result: () => {
      counts[domain] += 1
      return {
        data: { [`${domain}KPIs`]: null },
        errors: [new GraphQLError(`Forbidden: insufficient permissions for reporting.${domain}:view`)],
      }
    },
    maxUsageCount: 10,
  }
}

function mocksFor({ range = ALL_TIME, rows = FOUR_ROWS, pnlError, sportsError, refused = [], delay }: MockSet = {}): MockedResponse[] {
  const filter = { filter: { dateFrom: range.dateFrom, dateTo: range.dateTo } }
  const kpi = (domain: KpiDomain, mock: MockedResponse) =>
    (refused.includes(domain) ? refusedKpi(domain, filter) : mock)
  const pnl: MockedResponse = pnlError
    ? { request: { query: PNL_QUERY, variables: { range: pnlRangeDays(range.dateFrom, range.dateTo), ...range } }, error: new Error(pnlError) }
    : {
        request: { query: PNL_QUERY, variables: { range: pnlRangeDays(range.dateFrom, range.dateTo), ...range } },
        result: () => {
          counts.pnl += 1
          return { data: { pnl: rows.map((row) => ({ __typename: 'ReportRow', ...row })) } }
        },
        maxUsageCount: 10,
        delay,
      }
  const sports: MockedResponse = sportsError
    ? { request: { query: SPORTS_KPIS_QUERY, variables: filter }, error: new Error(sportsError) }
    : {
        request: { query: SPORTS_KPIS_QUERY, variables: filter },
        result: () => {
          counts.sports += 1
          return { data: { sportsKPIs: KPI.sports } }
        },
        maxUsageCount: 10,
      }
  return [
    pnl,
    kpi('sports', sports),
    kpi('matka', {
      request: { query: MATKA_KPIS_QUERY, variables: filter },
      result: () => {
        counts.matka += 1
        return { data: { matkaKPIs: KPI.matka } }
      },
      maxUsageCount: 10,
    }),
    kpi('casino', {
      request: { query: CASINO_KPIS_QUERY, variables: filter },
      result: () => {
        counts.casino += 1
        return { data: { casinoKPIs: KPI.casino } }
      },
      maxUsageCount: 10,
    }),
  ]
}

/** A COMMISSION agent's ledger days (agentTrends' date and commission) for one filter. */
function commissionDaysMock(filter: Record<string, string>, days: Array<{ date: string; commission: number }>): MockedResponse {
  return {
    request: { query: AGENT_COMMISSION_DAYS_QUERY, variables: { filter } },
    result: { data: { agentTrends: days.map((day) => ({ __typename: 'AgentTrendPoint', ...day })) } },
    maxUsageCount: 10,
  }
}

function renderPage(mocks: MockedResponse[]) {
  return render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={['/reporting/pnl']}>
        <PageEyebrowProvider value="Reporting">
          <PNLPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function latest(name: string): HookCall {
  const call = [...apollo.queries].reverse().find((candidate) => candidate.name === name)
  assert.ok(call, `Expected a useQuery call for ${name}`)
  return call
}

function normalised(document: unknown): string {
  const body = (document as { loc?: { source?: { body?: string } } }).loc?.source?.body
  assert.ok(body, 'Expected the GraphQL source body')
  return body.replace(/\s+/g, ' ').trim()
}

function table(name = 'Profit & Loss Data'): HTMLElement {
  return screen.getByRole('table', { name })
}

function bodyRows(name?: string): HTMLElement[] {
  return within(table(name)).getAllByRole('row').slice(1)
}

function currentPage(): string | null {
  return screen.getByRole('button', { current: 'page' }).textContent
}

function lastExport(): ExportOptions {
  const options = exporter.options.at(-1) as ExportOptions | undefined
  assert.ok(options, 'Expected useTableExport options')
  return options
}

async function loaded(text = '+₹200.00') {
  await screen.findByText(text)
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  apollo.queries.length = 0
  guard.calls.length = 0
  guard.allowed = true
  auth.isAgent = false
  auth.agent = undefined
  exporter.options.length = 0
  exporter.handleExport.mockReset()
  period.today = computeReportingDateRange('today').dateFrom
  counts.pnl = 0
  counts.sports = 0
  counts.matka = 0
  counts.casino = 0
})

describe('PNLPage contract', () => {
  test('sends the four legacy documents with the exact initial variables and options, inside the agent-bypassing guard', async () => {
    renderPage(mocksFor())
    await loaded()

    assert.deepStrictEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.pnl', actions: ['view'] }],
      bypassForAgents: true,
    })
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Profit & Loss Report')
    assert.ok(screen.queryByText('Analyze profit and loss performance across all domains') === null)
    assert.ok(screen.queryByText('Reporting') === null)
    assert.deepStrictEqual(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
      ['Profit & Loss Data'],
    )

    const pnl = latest('PNL')
    assert.equal(pnl.document, PNL_QUERY)
    assert.equal(
      normalised(PNL_QUERY),
      'query PNL($range: String, $dateFrom: String, $dateTo: String) { pnl(range: $range, dateFrom: $dateFrom, dateTo: $dateTo) { dimension value date } }',
    )
    assert.deepStrictEqual(pnl.options, {
      variables: { range: pnlRangeDays(ALL_TIME.dateFrom, ALL_TIME.dateTo), ...ALL_TIME },
      errorPolicy: 'all',
      skip: false,
      fetchPolicy: 'network-only',
      notifyOnNetworkStatusChange: true,
    })
    // the range is the calendar distance from 1 Jan 2000 to today (IST), counted independently here
    const [year, month, day] = ALL_TIME.dateTo.split('-').map(Number)
    assert.equal(
      (pnl.options.variables as { range: string }).range,
      String(Math.round((Date.UTC(year, month - 1, day) - Date.UTC(2000, 0, 1)) / 864e5)),
    )

    const sports = latest('SportsKPIs')
    assert.equal(sports.document, SPORTS_KPIS_QUERY)
    assert.equal(
      normalised(SPORTS_KPIS_QUERY),
      'query SportsKPIs($filter: SportsReportingFilter) { sportsKPIs(filter: $filter) { grossGamingRevenue totalStakes totalPayouts netRevenue } }',
    )
    assert.deepStrictEqual(sports.options, {
      variables: { filter: { ...ALL_TIME } },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
      skip: false,
      notifyOnNetworkStatusChange: true,
    })

    for (const [name, document, field, type] of [
      ['MatkaKPIs', MATKA_KPIS_QUERY, 'matkaKPIs', 'MatkaReportingFilter'],
      ['CasinoKPIs', CASINO_KPIS_QUERY, 'casinoKPIs', 'CasinoReportingFilter'],
    ] as const) {
      const call = latest(name)
      assert.equal(call.document, document)
      assert.equal(
        normalised(document),
        `query ${name}($filter: ${type}) { ${field}(filter: $filter) { grossGamingRevenue totalStakes totalPayouts netRevenue } }`,
      )
      assert.deepStrictEqual(call.options, {
        variables: { filter: { ...ALL_TIME } },
        errorPolicy: 'all',
        fetchPolicy: 'network-only',
        skip: false,
      })
    }
    // A COMMISSION agent's ledger days are not asked for anyone else.
    assert.equal(latest('AgentCommissionDays').options.skip, true)
  })

  test('a denied caller starts no query', () => {
    guard.allowed = false
    renderPage(mocksFor())

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(apollo.queries.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })

  test('shows the legacy figures, signed amounts, statuses and counts', async () => {
    renderPage(mocksFor())
    await loaded()

    const stats = screen.getByRole('group', { name: 'P&L statistics' })
    const figure = (label: string) => within(stats).getByText(label).parentElement?.textContent
    // all domains: (100 + 50 + 25) converted ×2; the change runs from the oldest day (300) to the newest (100)
    assert.equal(figure('Total P&L'), 'Total P&L₹350.00Change: -66.67%')
    assert.equal(figure('Average P&L'), 'Average P&L₹180.004 days')
    assert.equal(figure('Win Rate'), 'Win Rate50.0%2 profitable, 1 loss')
    assert.equal(figure('Profitable Days'), 'Profitable Days2Best: ₹600.00')

    const rows = bodyRows()
    assert.deepStrictEqual(
      rows.map((tr) => Array.from(tr.querySelectorAll('td')).map((cell) => cell.textContent)),
      [
        ['yyyy-MM-dd HH:mm 2026-01-04', 'Sports', '+₹200.00', 'Profit'],
        ['yyyy-MM-dd HH:mm 2026-01-03', 'Casino', '₹-80.00', 'Loss'],
        ['yyyy-MM-dd HH:mm 2026-01-02', 'All', '+₹0.00', 'Profit'],
        ['yyyy-MM-dd HH:mm 2026-01-01', 'Matka', '+₹600.00', 'Profit'],
      ],
    )
    screen.getByText('4 records')
    screen.getByText('Total 4 records')
    assert.equal(within(table()).getByRole('columnheader', { name: /P&L/ }).getAttribute('aria-sort'), 'none')
  })

  test('a COMMISSION agent reads its posted commission (not its downline GGR), with commission copy, statuses and export names (F-REP-13)', async () => {
    auth.isAgent = true
    auth.agent = { schemeType: 'COMMISSION', allowedDomains: ['sports', 'casino', 'matka'] }
    renderPage([
      ...mocksFor(),
      commissionDaysMock({ ...ALL_TIME }, [
        { date: '2026-01-04', commission: 100 },
        { date: '2026-01-03', commission: 0 },
        { date: '2026-01-02', commission: 40 },
      ]),
      commissionDaysMock({ ...ALL_TIME, domain: 'casino' }, [{ date: '2026-01-04', commission: 75 }]),
    ])
    await screen.findByText('+₹200.00')

    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Commission Earned Report')
    assert.ok(screen.queryByText('Track your commission earnings from player turnover') === null)
    screen.getByRole('heading', { level: 2, name: 'Commission Earned Data' })
    const stats = screen.getByRole('group', { name: 'Commission statistics' })
    for (const label of ['Total Commission', 'Avg Commission', 'Earning Rate', 'Best Earning']) {
      within(stats).getByText(label)
    }
    // (100 + 40) converted ×2, from the ledger days; the GGR documents are not sent for this agent.
    assert.equal(within(stats).getByText('Total Commission').parentElement?.querySelector('div + div')?.textContent, '₹280.00')
    for (const name of ['PNL', 'SportsKPIs', 'MatkaKPIs', 'CasinoKPIs']) assert.equal(latest(name).options.skip, true, name)
    assert.deepStrictEqual(latest('AgentCommissionDays').options.variables, { filter: { ...ALL_TIME } })
    assert.equal(counts.pnl + counts.sports + counts.matka + counts.casino, 0)

    const commissionTable = table('Commission Earned Data')
    within(commissionTable).getByRole('columnheader', { name: /Commission/ })
    assert.deepStrictEqual(
      bodyRows('Commission Earned Data').map((tr) => Array.from(tr.querySelectorAll('td')).slice(1).map((cell) => cell.textContent)),
      [['All', '+₹200.00', 'Earned'], ['All', '+₹80.00', 'Earned']],
    )
    screen.getByRole('searchbox', { name: 'Search commission' })

    const options = lastExport()
    assert.equal(options.filename, 'Commission-Earned-Report')
    assert.equal(options.sheetName, 'Commission')
    assert.equal(options.title, 'Commission Earned — 2 record(s)')
    assert.deepStrictEqual(options.columns.map((column) => column.header), ['Date', 'Domain', 'Commission', 'Status'])

    // A domain tab asks for that domain's posted commission.
    fireEvent.click(within(screen.getByRole('group', { name: 'Domain filter' })).getByRole('button', { name: 'Casino' }))
    await screen.findByText('+₹150.00')
    assert.deepStrictEqual(latest('AgentCommissionDays').options.variables, { filter: { ...ALL_TIME, domain: 'casino' } })
    assert.equal(within(stats).getByText('Total Commission').parentElement?.querySelector('div + div')?.textContent, '₹150.00')
  })

  test('shows every domain tab to an admin and only the allowed ones to an agent', async () => {
    const scenarios: Array<{ agent?: MockAgent; visible: string[]; hidden: string[] }> = [
      { visible: ['All Domains', 'Sports', 'Casino', 'Matka'], hidden: [] },
      { agent: { schemeType: 'CREDIT', allowedDomains: ['sports'] }, visible: ['All Domains', 'Sports'], hidden: ['Casino', 'Matka'] },
      { agent: { schemeType: 'SHARING', allowedDomains: ['casino', 'matka'] }, visible: ['All Domains', 'Casino', 'Matka'], hidden: ['Sports'] },
      { agent: { schemeType: 'CREDIT' }, visible: ['All Domains', 'Sports', 'Casino', 'Matka'], hidden: [] },
    ]
    for (const scenario of scenarios) {
      auth.isAgent = Boolean(scenario.agent)
      auth.agent = scenario.agent
      renderPage(mocksFor())
      const group = screen.getByRole('group', { name: 'Domain filter' })
      for (const label of scenario.visible) within(group).getByRole('button', { name: label })
      for (const label of scenario.hidden) assert.equal(within(group).queryByRole('button', { name: label }), null)
      assert.equal(within(group).getByRole('button', { name: 'All Domains' }).getAttribute('aria-pressed'), 'true')
      cleanup()
    }
  })
})

describe('PNLPage filters', () => {
  test('a domain tab keeps its own rows only, its cards follow it, the total switches and it returns to page 1', async () => {
    renderPage(mocksFor({ rows: manyRows(25) }))
    await screen.findByText('Total 25 records')

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    assert.equal(currentPage(), '2')
    fireEvent.click(within(screen.getByRole('group', { name: 'Domain filter' })).getByRole('button', { name: 'Sports' }))

    await waitFor(() => assert.equal(currentPage(), '1'))
    // 25 rows cycle Sports, Casino, Matka, All: the 7 Sports rows (F-REP-07: the All rows showed under every tab)
    screen.getByText('Total 7 records')
    assert.ok(bodyRows().every((tr) => /Sports/.test(tr.querySelectorAll('td')[1]?.textContent ?? '')))
    const stats = screen.getByRole('group', { name: 'P&L statistics' })
    assert.equal(within(stats).getByText('Total P&L').parentElement?.querySelector('div + div')?.textContent, '₹200.00')
    // F-REP-17: the averages count the tab's 7 days, not the 25 rows of every domain
    within(stats).getByText('7 days')
    assert.equal(within(stats).getByText('Win Rate').parentElement?.textContent, 'Win Rate100.0%7 profitable, 0 loss')
    screen.getByText('1 filter applied')
  })

  test('search narrows the rows on the converted amount and returns to page 1', async () => {
    renderPage(mocksFor({ rows: manyRows(25) }))
    await screen.findByText('Total 25 records')

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search P&L' }), { target: { value: '₹2,740' } })

    await waitFor(() => assert.equal(currentPage(), '1'))
    // 10 × 137 = 1370, converted ×2 = 2740
    screen.getByText('Total 1 records')
    screen.getByText('1 record')
    assert.equal(bodyRows().length, 1)
    assert.equal(lastExport().data.length, 1)
  })

  test('a period sends the new range to all four queries and returns to page 1; Clear all restores everything', async () => {
    renderPage([...mocksFor({ rows: manyRows(25) }), ...mocksFor({ range: CUSTOM, rows: FOUR_ROWS })])
    await screen.findByText('Total 25 records')

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search P&L' }), { target: { value: '2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Custom Range' }))

    await screen.findByText('+₹200.00')
    assert.equal(currentPage(), '1')
    assert.deepStrictEqual(latest('PNL').options.variables, { range: '2', ...CUSTOM })
    for (const name of ['SportsKPIs', 'MatkaKPIs', 'CasinoKPIs']) {
      assert.deepStrictEqual(latest(name).options.variables, { filter: { ...CUSTOM } })
    }
    assert.equal(screen.getByTestId('period-state').textContent, `custom|${CUSTOM.dateFrom}|${CUSTOM.dateTo}`)
    screen.getByText('2 filters applied')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await screen.findByText('Total 25 records')
    assert.equal(screen.getByTestId('period-state').textContent, `allTime|${ALL_TIME.dateFrom}|${ALL_TIME.dateTo}`)
    assert.equal((screen.getByRole('searchbox', { name: 'Search P&L' }) as HTMLInputElement).value, '')
    assert.deepStrictEqual(latest('PNL').options.variables, {
      range: pnlRangeDays(ALL_TIME.dateFrom, ALL_TIME.dateTo),
      ...ALL_TIME,
    })
    screen.getByText('0 filters applied')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
  })

  test('Today sends a zero-day range', async () => {
    const today = computeReportingDateRange('today')
    renderPage([...mocksFor(), ...mocksFor({ range: today, rows: [] })])
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Apply Today' }))
    await screen.findByText('No P&L data')
    assert.deepStrictEqual(latest('PNL').options.variables, { range: '0', ...today })
  })
})

describe('PNLPage table', () => {
  test('sorts only the current page by amount and by date, and a third press clears', async () => {
    renderPage(mocksFor())
    await loaded()

    const header = within(table()).getByRole('columnheader', { name: /P&L/ })
    const button = within(header).getByRole('button', { name: 'P&L' })
    const amounts = () => bodyRows().map((tr) => tr.querySelectorAll('td')[2]?.textContent)

    fireEvent.click(button)
    assert.equal(header.getAttribute('aria-sort'), 'ascending')
    assert.deepStrictEqual(amounts(), ['₹-80.00', '+₹0.00', '+₹200.00', '+₹600.00'])
    fireEvent.click(button)
    assert.equal(header.getAttribute('aria-sort'), 'descending')
    assert.deepStrictEqual(amounts(), ['+₹600.00', '+₹200.00', '+₹0.00', '₹-80.00'])
    fireEvent.click(button)
    assert.equal(header.getAttribute('aria-sort'), 'none')
    assert.deepStrictEqual(amounts(), ['+₹200.00', '₹-80.00', '+₹0.00', '+₹600.00'])

    const dateHeader = within(table()).getByRole('columnheader', { name: /Date/ })
    fireEvent.click(within(dateHeader).getByRole('button', { name: 'Date' }))
    assert.deepStrictEqual(amounts(), ['+₹600.00', '+₹0.00', '₹-80.00', '+₹200.00'])
  })

  test('pages 20 rows at a time and a new page size returns to page 1', async () => {
    renderPage(mocksFor({ rows: manyRows(25) }))
    await screen.findByText('Total 25 records')
    assert.equal(bodyRows().length, 20)

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(currentPage(), '2'))
    assert.equal(bodyRows().length, 5)

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '10' } })
    await waitFor(() => assert.equal(currentPage(), '1'))
    assert.equal(bodyRows().length, 10)
    screen.getByRole('button', { name: 'Page 3' })
    assert.deepStrictEqual(
      Array.from((screen.getByLabelText('Rows per page:') as HTMLSelectElement).options).map((option) => option.value),
      ['10', '20', '50', '100'],
    )
  })

  test('exports the filtered rows under the legacy names, and Export waits for rows', async () => {
    renderPage(mocksFor())
    const exportButton = () => screen.getByRole('button', { name: 'Export Excel' })
    assert.equal(exportButton().hasAttribute('disabled'), true)
    await loaded()
    assert.equal(exportButton().hasAttribute('disabled'), false)

    const options = lastExport()
    assert.equal(options.filename, 'PNL-Report')
    assert.equal(options.sheetName, 'P&L')
    assert.equal(options.title, 'P&L — 4 record(s)')
    assert.deepStrictEqual(options.data.map((row) => row.dimension), ['Sports', 'Casino', 'All', 'Matka'])
    assert.deepStrictEqual(
      options.columns.map(({ header, key, width }) => ({ header, key, width })),
      [
        { header: 'Date', key: 'date', width: 18 },
        { header: 'Domain', key: 'dimension', width: 12 },
        { header: 'P&L', key: 'value', width: 14 },
        { header: 'Status', key: 'status', width: 10 },
      ],
    )
    assert.deepStrictEqual(options.columns.map((column) => column.getter(FOUR_ROWS[1])), [
      'yyyy-MM-dd HH:mm 2026-01-03',
      'Casino',
      -40,
      'Loss',
    ])

    fireEvent.click(exportButton())
    assert.equal(exporter.handleExport.mock.calls.length, 1)
  })

  test('Refresh refetches the PNL operation only', async () => {
    renderPage(mocksFor())
    await loaded()
    assert.deepStrictEqual(counts, { pnl: 1, sports: 1, matka: 1, casino: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(counts.pnl, 2))
    assert.deepStrictEqual(counts, { pnl: 2, sports: 1, matka: 1, casino: 1 })
  })
})

describe('PNLPage states', () => {
  test('loading, then rows', async () => {
    renderPage(mocksFor({ delay: 30 }))
    screen.getByText('Loading Profit & Loss Data')
    assert.equal(table().getAttribute('aria-busy'), 'true')
    await loaded()
    assert.ok(screen.queryByText('Loading Profit & Loss Data') === null)
  })

  test('empty: the empty state, zero figures and a disabled export', async () => {
    renderPage(mocksFor({ rows: [] }))
    await screen.findByText('No P&L data')
    screen.getByText('No records match the current domain, period and search filters.')
    screen.getByText('Total 0 records')
    screen.getByText('0 records')
    const stats = screen.getByRole('group', { name: 'P&L statistics' })
    within(stats).getByText('0 days')
    within(stats).getByText('0 profitable, 0 loss')
    assert.equal(screen.getByRole('button', { name: 'Export Excel' }).hasAttribute('disabled'), true)
  })

  test('a failed PNL query shows its message and Retry fetches again', async () => {
    renderPage([
      ...mocksFor({ pnlError: 'P&L service unavailable' }),
      ...mocksFor().slice(0, 1),
    ])
    await screen.findByText('P&L service unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await loaded()
    assert.ok(screen.queryByText('P&L service unavailable') === null)
  })

  test('a failed total keeps the rows and says the totals are incomplete', async () => {
    renderPage(mocksFor({ sportsError: 'Sports totals unavailable' }))
    await loaded()
    await screen.findByText('Some totals could not be loaded')
    const stats = screen.getByRole('group', { name: 'P&L statistics' })
    // sports is missing: (50 + 25) converted ×2
    assert.equal(within(stats).getByText('Total P&L').parentElement?.querySelector('div + div')?.textContent, '₹150.00')
    assert.equal(bodyRows().length, 4)
    // raised by a failure, so it is announced; no refusal is claimed
    assert.ok(screen.getByText('Some totals could not be loaded').closest('[role="status"]'))
    assert.ok(screen.queryByText('Some totals are not included') === null)
  })

  test('a caller refused the domain reports is told which totals are left out, not to change the period', async () => {
    renderPage(mocksFor({ refused: ['sports', 'matka', 'casino'] }))
    await loaded()
    const title = await screen.findByText('Some totals are not included')
    screen.getByText('You do not have access to the Sports, Casino and Matka reports, so Total P&L does not include them.')
    assert.ok(screen.queryByText('Some totals could not be loaded') === null)
    assert.ok(screen.queryByText(/Change the period to try again/) === null)
    // it comes back on every load for this caller, so it is part of the page, not an announcement
    assert.equal(title.closest('[role="status"], [role="alert"]'), null)
    assert.deepStrictEqual(counts, { pnl: 1, sports: 1, matka: 1, casino: 1 })

    // the legacy figure stays (nothing it could add up) and the rows load under reporting.pnl:view
    const stats = screen.getByRole('group', { name: 'P&L statistics' })
    assert.equal(within(stats).getByText('Total P&L').parentElement?.querySelector('div + div')?.textContent, '₹0.00')
    assert.equal(bodyRows().length, 4)

    fireEvent.click(within(screen.getByRole('group', { name: 'Domain filter' })).getByRole('button', { name: 'Casino' }))
    await screen.findByText('You do not have access to the Casino report, so Total P&L does not include it.')
  })

  test('a SHARING or CREDIT agent does not ask for a domain it lacks, so no notice names that domain (SCO-07)', async () => {
    const stats = () => screen.getByRole('group', { name: 'P&L statistics' })
    const total = () => within(stats()).getByText('Total P&L').parentElement?.querySelector('div + div')?.textContent
    for (const schemeType of ['SHARING', 'CREDIT']) {
      counts.pnl = 0
      counts.sports = 0
      counts.matka = 0
      counts.casino = 0
      auth.isAgent = true
      auth.agent = { schemeType, allowedDomains: ['sports', 'matka'] }
      // the API refuses casino to this agent, as it does to an agent without the domain
      renderPage(mocksFor({ refused: ['casino'] }))
      await loaded()
      // sports and matka load: (100 + 50) converted ×2
      await waitFor(() => assert.equal(total(), '₹300.00', schemeType))
      assert.equal(latest('CasinoKPIs').options.skip, true, schemeType)
      assert.equal(latest('SportsKPIs').options.skip, false, schemeType)
      assert.equal(latest('MatkaKPIs').options.skip, false, schemeType)
      assert.deepStrictEqual(counts, { pnl: 1, sports: 1, matka: 1, casino: 0 }, schemeType)
      assert.ok(screen.queryByText('Some totals are not included') === null, schemeType)
      assert.ok(screen.queryByText('Some totals could not be loaded') === null, schemeType)
      cleanup()
    }

    // a refusal of a total the agent does ask for still says so
    auth.agent = { schemeType: 'SHARING', allowedDomains: ['sports', 'casino', 'matka'] }
    renderPage(mocksFor({ refused: ['casino'] }))
    await loaded()
    await screen.findByText('You do not have access to the Casino report, so Total P&L does not include it.')
    assert.equal(latest('CasinoKPIs').options.skip, false)
  })

  test('only the totals feeding the Total card raise a notice, each with its own reason', async () => {
    renderPage(mocksFor({ refused: ['casino'], sportsError: 'Sports totals unavailable' }))
    await loaded()
    await screen.findByText('Some totals could not be loaded')
    screen.getByText('You do not have access to the Casino report, so Total P&L does not include it.')
    const stats = screen.getByRole('group', { name: 'P&L statistics' })
    // only matka loaded: 50 converted ×2
    assert.equal(within(stats).getByText('Total P&L').parentElement?.querySelector('div + div')?.textContent, '₹100.00')

    const domains = screen.getByRole('group', { name: 'Domain filter' })
    fireEvent.click(within(domains).getByRole('button', { name: 'Casino' }))
    await waitFor(() => assert.ok(screen.queryByText('Some totals could not be loaded') === null))
    screen.getByText('Some totals are not included')

    fireEvent.click(within(domains).getByRole('button', { name: 'Matka' }))
    await waitFor(() => assert.ok(screen.queryByText('Some totals are not included') === null))
    assert.ok(screen.queryByText('Some totals could not be loaded') === null)
    assert.equal(within(stats).getByText('Total P&L').parentElement?.querySelector('div + div')?.textContent, '₹100.00')
  })
})
