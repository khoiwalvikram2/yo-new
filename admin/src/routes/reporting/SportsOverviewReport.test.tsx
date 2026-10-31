/**
 * /reporting/sports against a mocked GraphQL server (MockedProvider + MemoryRouter). The real page, the
 * real reporting store, the kit, the Task 121 drill-down pieces and the real Apollo hooks run; useQuery is
 * wrapped, not replaced, so every option the page's hooks pass is recorded. The period control has its own
 * suite (modules/reporting/ui/ReportingPeriodFilter.test.tsx) and the contributors panel its own
 * (ReportDetailDrawer.test.tsx); both are recording stubs here. recharts draws for real at a fixed size.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import type { DocumentNode } from 'graphql'
import {
  SPORTS_BREAKDOWN_QUERY,
  SPORTS_EVENT_BREAKDOWN_QUERY,
  SPORTS_KPIS_QUERY,
  SPORTS_LEAGUE_BREAKDOWN_QUERY,
  SPORTS_MARKET_BREAKDOWN_QUERY,
  SPORTS_TRENDS_QUERY,
} from '@/modules/reporting/graphql'
import { computeReportingDateRange, type ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'
import chartStyles from '@/modules/reporting/ui/reportCharts.module.css'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useReportingStore, type DrillDownLevel } from '@/state/reportingStore'
import SportsOverviewReport from './SportsOverviewReport'
import styles from './SportsOverviewReport.module.css'

interface HookCall {
  name: string
  document: unknown
  options: Record<string, unknown>
}

interface PeriodStubProps {
  dateFrom: string
  dateTo: string
  preset?: ReportingDatePreset
  onChange: (dateFrom: string, dateTo: string, preset: ReportingDatePreset) => void
}

interface DrawerStubProps {
  domain?: string
  filter?: Record<string, unknown>
  selectedPlayerId?: string | null
  selectedAgentId?: string | null
}

const apollo = vi.hoisted(() => ({ queries: [] as HookCall[] }))

const guard = vi.hoisted(() => ({ allowed: true, calls: [] as unknown[] }))

const drawer = vi.hoisted(() => ({ calls: [] as unknown[] }))

const period = vi.hoisted(() => ({ calls: [] as unknown[] }))

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
  useFormatDate: () => ({ formatDate: (value: string, pattern: string) => `${pattern}:${value}` }),
}))

vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }))

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

vi.mock('@/modules/reporting/ui/ReportingPeriodFilter', () => ({
  ReportingPeriodFilter: (props: PeriodStubProps) => {
    period.calls.push(props)
    return (
      <div role="group" aria-label="Period (stub)">
        <output data-testid="period-state">{`${props.preset}|${props.dateFrom}|${props.dateTo}`}</output>
        <button type="button" onClick={() => props.onChange('2026-01-02', '2026-01-04', 'custom')}>
          Apply Custom Range
        </button>
      </div>
    )
  },
}))

vi.mock('@/modules/reporting/ui/ReportDetailDrawer', () => ({
  ReportDetailDrawer: (props: DrawerStubProps) => {
    drawer.calls.push(props)
    return <section aria-label="Contributors (stub)">{String(props.filter?.sportId ?? 'none')}</section>
  },
}))

/* ResponsiveContainer measures its parent, which is 0x0 in jsdom, and then draws nothing. This stand-in
   hands the chart a fixed width and the container's own height, so recharts draws the real lines and the
   legend (the overview chart legend tests do the same). */
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  const React = await import('react')
  function FixedContainer({
    children,
    height,
  }: {
    children: React.ReactElement<{ width?: number; height?: number }>
    height?: number | string
  }) {
    return React.createElement(
      'div',
      { className: 'recharts-responsive-container' },
      React.cloneElement(children, { width: 640, height: Number(height) }),
    )
  }
  return { ...actual, ResponsiveContainer: FixedContainer }
})

const ALL_TIME = computeReportingDateRange('allTime')

const KPIS = {
  totalStakes: 9000,
  totalPayouts: 8100,
  totalExposure: 0,
  grossGamingRevenue: 900,
  netRevenue: 0,
  holdPercentage: 0.1,
  betCount: 2300,
  playerCount: 75,
  activePlayerCount: 60,
}

const TRENDS = [
  { date: '2026-10-01', stakes: 100, payouts: 60, ggr: 40, betCount: 5, playerCount: 2 },
  { date: '2026-10-02', stakes: 120, payouts: 70, ggr: 50, betCount: 6, playerCount: 3 },
]

const sport = (id: string, name: string, totalStakes: number, ggr: number) => ({
  id,
  name,
  totalStakes,
  totalPayouts: totalStakes - ggr,
  grossGamingRevenue: ggr,
  betCount: 100,
  playerCount: 10,
})

const SPORTS = [
  sport('sp-1', 'Cricket', 5000, 1000),
  sport('sp-2', 'Football', 3000, -200),
  sport('sp-3', 'Tennis', 1000, 100),
]

const LEAGUES = [
  {
    leagueId: 'lg-1',
    leagueName: 'IPL',
    sportId: 'sp-1',
    sportName: 'Cricket',
    totalStakes: 4000,
    totalPayouts: 3500,
    grossGamingRevenue: 500,
    betCount: 80,
    playerCount: 8,
    eventCount: 2,
  },
]

const EVENTS = [
  {
    eventId: 'ev-1',
    eventName: 'MI vs CSK',
    leagueId: 'lg-1',
    leagueName: 'IPL',
    sportId: 'sp-1',
    sportName: 'Cricket',
    totalStakes: 2000,
    totalPayouts: 1500,
    grossGamingRevenue: 500,
    betCount: 40,
    playerCount: 4,
    startTime: '2026-10-01T14:00:00.000Z',
  },
]

const MARKETS = [
  {
    marketId: 'mk-1',
    marketName: 'Match Odds',
    eventId: 'ev-1',
    eventName: 'MI vs CSK',
    leagueId: 'lg-1',
    leagueName: 'IPL',
    sportId: 'sp-1',
    sportName: 'Cricket',
    totalStakes: 1500,
    totalPayouts: 1000,
    grossGamingRevenue: 500,
    betCount: 30,
    playerCount: 3,
  },
]

type OperationName =
  | 'SportsKPIs'
  | 'SportsTrends'
  | 'SportsBreakdown'
  | 'SportsLeagueBreakdown'
  | 'SportsEventBreakdown'
  | 'SportsMarketBreakdown'

/** What the mocked server answers; every request is recorded with its variables. */
const server = {
  calls: [] as { name: OperationName; variables: Record<string, unknown> }[],
  sports: SPORTS as unknown[],
  kpis: KPIS as unknown,
  errors: {} as Partial<Record<OperationName, string>>,
  delay: 0,
}

/** The server's answer as it sends it: every object carries its __typename. */
function typed(value: unknown, typename: string): unknown {
  if (Array.isArray(value)) return value.map((item) => typed(item, typename))
  if (value && typeof value === 'object') return { __typename: typename, ...value }
  return value
}

function responder(
  document: DocumentNode,
  name: OperationName,
  field: string,
  typename: string,
  rows: () => unknown,
): MockedResponse {
  return {
    request: { query: document },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    delay: server.delay,
    result: (variables: Record<string, unknown>) => {
      server.calls.push({ name, variables })
      const message = server.errors[name]
      if (message) return { data: { [field]: null }, errors: [new GraphQLError(message)] }
      return { data: { [field]: typed(rows(), typename) } }
    },
  }
}

function mocks(): MockedResponse[] {
  return [
    responder(SPORTS_KPIS_QUERY, 'SportsKPIs', 'sportsKPIs', 'SportsKPIs', () => server.kpis),
    responder(SPORTS_TRENDS_QUERY, 'SportsTrends', 'sportsTrends', 'SportsTrendPoint', () => TRENDS),
    responder(SPORTS_BREAKDOWN_QUERY, 'SportsBreakdown', 'sportsBreakdown', 'SportsBreakdownItem', () => server.sports),
    responder(SPORTS_LEAGUE_BREAKDOWN_QUERY, 'SportsLeagueBreakdown', 'sportsLeagueBreakdown', 'SportsLeagueRow', () => LEAGUES),
    responder(SPORTS_EVENT_BREAKDOWN_QUERY, 'SportsEventBreakdown', 'sportsEventBreakdown', 'SportsEventRow', () => EVENTS),
    responder(SPORTS_MARKET_BREAKDOWN_QUERY, 'SportsMarketBreakdown', 'sportsMarketBreakdown', 'SportsMarketRow', () => MARKETS),
  ]
}

function renderPage() {
  return render(
    <MockedProvider mocks={mocks()}>
      <MemoryRouter initialEntries={['/reporting/sports']}>
        <PageEyebrowProvider value="Reporting">
          <SportsOverviewReport />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

/** Variables as the server saw them, without undefined keys (the wire drops them too). */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

function lastCall(name: OperationName): Record<string, unknown> {
  const call = [...server.calls].reverse().find((candidate) => candidate.name === name)
  assert.ok(call, `Expected a ${name} request`)
  return plain(call.variables) as Record<string, unknown>
}

function count(name: OperationName): number {
  return server.calls.filter((call) => call.name === name).length
}

function latestHook(name: string): HookCall {
  const call = [...apollo.queries].reverse().find((candidate) => candidate.name === name)
  assert.ok(call, `Expected a useQuery call for ${name}`)
  return call
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: 'Sports breakdown' })
}

function bodyRows(): HTMLElement[] {
  return within(table()).getAllByRole('row').slice(1)
}

function firstCells(): string[] {
  return bodyRows().map((row) => row.querySelector('td')?.querySelector(`.${styles.entityName}`)?.textContent ?? '')
}

function headers(): string[] {
  return within(table()).getAllByRole('columnheader').map((cell) => cell.textContent ?? '')
}

function path(): DrillDownLevel[] {
  return useReportingStore.getState().drillDownPath
}

function setPath(levels: DrillDownLevel[]) {
  useReportingStore.setState({ drillDownPath: levels })
}

const CRICKET: DrillDownLevel = { type: 'sport', id: 'sp-1', name: 'Cricket' }
const IPL: DrillDownLevel = { type: 'league', id: 'lg-1', name: 'IPL' }
const MATCH: DrillDownLevel = { type: 'event', id: 'ev-1', name: 'MI vs CSK' }

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  apollo.queries.length = 0
  guard.calls.length = 0
  guard.allowed = true
  drawer.calls.length = 0
  period.calls.length = 0
  server.calls.length = 0
  server.sports = SPORTS
  server.kpis = KPIS
  server.errors = {}
  server.delay = 0
  useReportingStore.setState({
    filters: { dateFrom: ALL_TIME.dateFrom, dateTo: ALL_TIME.dateTo, currency: undefined },
    drillDownPath: [],
    activeFilters: {},
  })
  /* recharts animates lines in from nothing unless the viewer prefers reduced motion; jsdom never advances
     the animation, so the charts are asked for reduced motion and draw at once. */
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
})

describe('SportsOverviewReport contract', () => {
  test('runs the six legacy hooks with the root filter inside the agent-bypassing guard, and draws the root', async () => {
    renderPage()
    await screen.findByText('Cricket')

    assert.deepStrictEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.sports', actions: ['view'] }],
      bypassForAgents: true,
    })
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Sports Overview Report')
    assert.ok(screen.queryByText('Analyze sports betting performance and revenue across all sports') === null)
    assert.ok(screen.queryByText('Reporting') === null)

    // the hooks' documents and options, in the legacy order
    const documents: Record<string, DocumentNode> = {
      SportsKPIs: SPORTS_KPIS_QUERY,
      SportsTrends: SPORTS_TRENDS_QUERY,
      SportsBreakdown: SPORTS_BREAKDOWN_QUERY,
      SportsLeagueBreakdown: SPORTS_LEAGUE_BREAKDOWN_QUERY,
      SportsEventBreakdown: SPORTS_EVENT_BREAKDOWN_QUERY,
      SportsMarketBreakdown: SPORTS_MARKET_BREAKDOWN_QUERY,
    }
    assert.deepStrictEqual(apollo.queries.slice(0, 6).map((call) => call.name), Object.keys(documents))
    for (const [name, document] of Object.entries(documents)) assert.equal(latestHook(name).document, document)

    const root = { dateFrom: ALL_TIME.dateFrom, dateTo: ALL_TIME.dateTo }
    const kpiOptions = latestHook('SportsKPIs').options
    assert.deepStrictEqual(plain(kpiOptions.variables), { filter: root })
    assert.equal(kpiOptions.errorPolicy, 'all')
    assert.equal(kpiOptions.fetchPolicy, 'network-only')
    assert.deepStrictEqual(plain(latestHook('SportsBreakdown').options.variables), { filter: root, dimension: 'sport' })
    // the drill-down hooks receive the page's own filter object (currency key included, undefined)
    const leagueVariables = latestHook('SportsLeagueBreakdown').options.variables as { filter: Record<string, unknown> }
    assert.deepStrictEqual(Object.keys(leagueVariables.filter), ['dateFrom', 'dateTo', 'currency'])
    assert.deepStrictEqual(plain(leagueVariables), { filter: root })
    assert.equal(latestHook('SportsMarketBreakdown').options.skip, true)

    await waitFor(() => assert.equal(count('SportsEventBreakdown'), 1))
    assert.deepStrictEqual(lastCall('SportsKPIs'), { filter: root })
    assert.deepStrictEqual(lastCall('SportsTrends'), { filter: root })
    assert.deepStrictEqual(lastCall('SportsBreakdown'), { filter: root, dimension: 'sport' })
    assert.deepStrictEqual(lastCall('SportsLeagueBreakdown'), { filter: root })
    assert.equal(count('SportsMarketBreakdown'), 0)

    // the four totals, converted and formatted as before
    const stats = screen.getByRole('group', { name: 'Sports totals' })
    for (const text of [
      'Total GGR', '₹1,800.00', 'Hold: 10.00%',
      'Total Stakes', '₹18,000.00', 'Payouts: ₹16,200.00',
      'Total Bets', '2,300', 'Avg: 30.7/player',
      'Active Players', '60', '75 total',
    ]) {
      within(stats).getByText(text)
    }

    // the root table: sports, legacy headers, signed GGR inks, Total N items
    assert.deepStrictEqual(headers(), ['Sport', 'Total Stakes', 'Total Payouts', 'GGR', 'Bets', 'Players'])
    assert.deepStrictEqual(firstCells(), ['Cricket', 'Football', 'Tennis'])
    const football = bodyRows()[1]
    // the stub formatter prints the sign after the symbol; the real one keeps whatever sign it is given
    assert.ok(within(football).getByText('₹-400.00').classList.contains(styles.loss))
    assert.ok(within(bodyRows()[0]).getByText('₹2,000.00').classList.contains(styles.gain))
    screen.getByText('Total 3 items')
    screen.getByRole('navigation', { name: 'Drill-down path' })
    assert.equal(screen.getByText('All Sports').closest('[aria-current]')?.getAttribute('aria-current'), 'location')

    // the contributors panel gets the same filter, with no drill-down context yet
    const contributors = drawer.calls.at(-1) as DrawerStubProps
    assert.equal(contributors.domain, 'sports')
    assert.deepStrictEqual(plain(contributors.filter), root)
  })

  test('a denied caller starts no query and sees the denial', () => {
    guard.allowed = false
    renderPage()
    screen.getByRole('alert')
    assert.equal(apollo.queries.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })

  test('no totals are shown until the KPI query answers with figures', async () => {
    server.kpis = null
    renderPage()
    await screen.findByText('Cricket')
    assert.equal(screen.queryByRole('group', { name: 'Sports totals' }), null)
  })
})

describe('SportsOverviewReport drill-down', () => {
  test('clicking a sport row drills into its leagues: path, breadcrumb, every query and the contributors filter', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Cricket'))

    await screen.findByText('IPL')
    assert.deepStrictEqual(path(), [CRICKET])
    const drilled = { dateFrom: ALL_TIME.dateFrom, dateTo: ALL_TIME.dateTo, sportId: 'sp-1' }
    await waitFor(() => assert.deepStrictEqual(lastCall('SportsLeagueBreakdown'), { filter: drilled }))
    assert.deepStrictEqual(lastCall('SportsKPIs'), { filter: drilled })
    assert.deepStrictEqual(lastCall('SportsTrends'), { filter: drilled })
    assert.deepStrictEqual(lastCall('SportsBreakdown'), { filter: drilled, dimension: 'sport' })
    assert.deepStrictEqual(lastCall('SportsEventBreakdown'), { filter: drilled })

    assert.deepStrictEqual(headers(), ['League', 'Total Stakes', 'Total Payouts', 'GGR', 'Bets', 'Players'])
    within(bodyRows()[0]).getByText('Cricket') // the league's sport on the dim line
    const crumbs = screen.getByRole('navigation', { name: 'Drill-down path' })
    within(crumbs).getByRole('button', { name: 'All Sports' })
    assert.equal(within(crumbs).getByText('Cricket').closest('[aria-current]')?.getAttribute('aria-current'), 'location')
    assert.deepStrictEqual(plain((drawer.calls.at(-1) as DrawerStubProps).filter), drilled)
    screen.getByRole('searchbox', { name: 'Search by league name' })
  })

  test('Enter on a focused event row drills to its markets, whose rows list and do not drill', async () => {
    setPath([CRICKET, IPL])
    renderPage()
    const eventCell = await screen.findByText('MI vs CSK')
    const row = eventCell.closest('tr')
    assert.ok(row)
    assert.equal(row.getAttribute('tabindex'), '0')
    fireEvent.keyDown(row, { key: 'Enter' })

    await screen.findByText('Match Odds')
    assert.deepStrictEqual(path(), [CRICKET, IPL, MATCH])
    await waitFor(() =>
      assert.deepStrictEqual(lastCall('SportsMarketBreakdown'), {
        filter: {
          dateFrom: ALL_TIME.dateFrom,
          dateTo: ALL_TIME.dateTo,
          sportId: 'sp-1',
          leagueId: 'lg-1',
          eventId: 'ev-1',
        },
      }),
    )
    assert.deepStrictEqual(headers(), ['Market', 'Total Stakes', 'Total Payouts', 'GGR', 'Bets', 'Players'])
    const marketRow = screen.getByText('Match Odds').closest('tr')
    assert.ok(marketRow)
    assert.equal(marketRow.getAttribute('tabindex'), null)
    fireEvent.click(screen.getByText('Match Odds'))
    fireEvent.keyDown(marketRow, { key: 'Enter' })
    assert.equal(path().length, 3)
  })

  test('a crumb pops back to its level and All Sports returns to the root', async () => {
    setPath([CRICKET, IPL, MATCH])
    renderPage()
    await screen.findByText('Match Odds')
    const crumbs = screen.getByRole('navigation', { name: 'Drill-down path' })

    fireEvent.click(within(crumbs).getByRole('button', { name: 'IPL' }))
    assert.deepStrictEqual(path(), [CRICKET, IPL])
    await screen.findByText('MI vs CSK')

    fireEvent.click(within(crumbs).getByRole('button', { name: 'All Sports' }))
    assert.deepStrictEqual(path(), [])
    await screen.findByText('Football')
  })

  test('a path another report left behind is cleared on arrival', async () => {
    setPath([{ type: 'vendor', id: 'v-1', name: 'Evolution' }])
    renderPage()
    await screen.findByText('Cricket')
    assert.deepStrictEqual(path(), [])
    assert.deepStrictEqual(headers().slice(0, 1), ['Sport'])
  })
})

describe('SportsOverviewReport filters', () => {
  test('search filters the level by its own fields, counts as a filter and Clear all resets search and period', async () => {
    renderPage()
    await screen.findByText('Cricket')
    const search = screen.getByRole('searchbox', { name: 'Search by sport name' })
    assert.equal(search.getAttribute('placeholder'), 'Search by sport name...')

    fireEvent.change(search, { target: { value: 'FOOT' } })
    assert.deepStrictEqual(firstCells(), ['Football'])
    screen.getByText('Total 1 items')
    screen.getByText('1 filter applied')

    fireEvent.click(screen.getByRole('button', { name: 'Apply Custom Range' }))
    screen.getByText('2 filters applied')
    assert.equal(screen.getByTestId('period-state').textContent, 'custom|2026-01-02|2026-01-04')
    assert.deepStrictEqual(
      { dateFrom: useReportingStore.getState().filters.dateFrom, dateTo: useReportingStore.getState().filters.dateTo },
      { dateFrom: '2026-01-02', dateTo: '2026-01-04' },
    )
    await waitFor(() => assert.deepStrictEqual(lastCall('SportsKPIs'), {
      filter: { dateFrom: '2026-01-02', dateTo: '2026-01-04' },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal((screen.getByRole('searchbox', { name: 'Search by sport name' }) as HTMLInputElement).value, '')
    assert.equal(
      screen.getByTestId('period-state').textContent,
      `allTime|${ALL_TIME.dateFrom}|${ALL_TIME.dateTo}`,
    )
    screen.getByText('0 filters applied')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
  })

  test('drilling down is not a filter: Clear all stays hidden and the path stays put', async () => {
    setPath([CRICKET])
    renderPage()
    await screen.findByText('IPL')
    screen.getByText('0 filters applied')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
  })

  test('well-formed active filters become chips; allowed keys reach the filter; chips clear', async () => {
    useReportingStore.setState({
      activeFilters: {
        agentId: { value: 'ag-9', label: 'Agent' },
        domain: { value: 'casino', label: 'Domain' },
        broken: null as unknown as { value: string; label: string },
      },
    })
    renderPage()
    await screen.findByText('Cricket')
    const chips = screen.getByLabelText('Active filters')
    within(chips).getByRole('button', { name: 'Remove Agent: ag-9' })
    within(chips).getByRole('button', { name: 'Remove Domain: casino' })
    await waitFor(() => assert.deepStrictEqual(lastCall('SportsKPIs'), {
      filter: { dateFrom: ALL_TIME.dateFrom, dateTo: ALL_TIME.dateTo, agentId: 'ag-9' },
    }))
    assert.equal(
      (latestHook('SportsLeagueBreakdown').options.variables as { filter: Record<string, unknown> }).filter.domain,
      undefined,
    )

    fireEvent.click(within(chips).getByRole('button', { name: 'Remove Agent: ag-9' }))
    assert.deepStrictEqual(Object.keys(useReportingStore.getState().activeFilters), ['domain', 'broken'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Domain: casino' }))
    assert.equal(screen.queryByLabelText('Active filters'), null)
  })
})

describe('SportsOverviewReport table', () => {
  test('sorting cycles ascending, descending and none on the page, with aria-sort', async () => {
    renderPage()
    await screen.findByText('Cricket')
    const sortButton = within(table()).getByRole('button', { name: 'Total Stakes' })
    const header = sortButton.closest('th')
    assert.ok(header)

    fireEvent.click(sortButton)
    assert.deepStrictEqual(firstCells(), ['Tennis', 'Football', 'Cricket'])
    assert.equal(header.getAttribute('aria-sort'), 'ascending')
    fireEvent.click(sortButton)
    assert.deepStrictEqual(firstCells(), ['Cricket', 'Football', 'Tennis'])
    assert.equal(header.getAttribute('aria-sort'), 'descending')
    fireEvent.click(sortButton)
    assert.deepStrictEqual(firstCells(), ['Cricket', 'Football', 'Tennis'])
    assert.equal(header.getAttribute('aria-sort'), 'none')
    assert.equal(within(table()).queryByRole('button', { name: 'Sport' }), null)
  })

  test('pages 20 rows at a time; a page-size change returns to page 1', async () => {
    server.sports = Array.from({ length: 25 }, (_, index) => sport(`sp-${index + 1}`, `Sport ${index + 1}`, 100 + index, 10))
    renderPage()
    await screen.findByText('Sport 1')
    assert.equal(bodyRows().length, 20)
    screen.getByText('Total 25 items')

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    assert.deepStrictEqual(firstCells(), ['Sport 21', 'Sport 22', 'Sport 23', 'Sport 24', 'Sport 25'])

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '10' } })
    assert.equal(bodyRows().length, 10)
    assert.equal(firstCells()[0], 'Sport 1')
    assert.equal(screen.getByRole('button', { current: 'page' }).textContent, '1')
  })

  test('loading, then empty', async () => {
    server.delay = 30_000
    renderPage()
    await screen.findByText('Loading Sports breakdown')
    cleanup()

    server.delay = 0
    server.sports = []
    renderPage()
    await waitFor(() => assert.equal(count('SportsBreakdown'), 1))
    await within(await screen.findByRole('table', { name: 'Sports breakdown' })).findByText('No data')
    screen.getByText('Total 0 items')
  })

  test('a failed table query shows its message; Retry and Refresh re-ask the totals, the trend and this table', async () => {
    server.errors = { SportsBreakdown: 'Breakdown failed' }
    renderPage()
    await within(table()).findByText('Breakdown failed')
    await waitFor(() => assert.equal(count('SportsEventBreakdown'), 1))
    const before = {
      kpis: count('SportsKPIs'),
      trends: count('SportsTrends'),
      table: count('SportsBreakdown'),
      league: count('SportsLeagueBreakdown'),
      event: count('SportsEventBreakdown'),
    }

    server.errors = {}
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    await screen.findByText('Cricket')
    await waitFor(() => {
      assert.equal(count('SportsKPIs'), before.kpis + 1)
      assert.equal(count('SportsTrends'), before.trends + 1)
      assert.equal(count('SportsBreakdown'), before.table + 1)
    })
    assert.equal(count('SportsLeagueBreakdown'), before.league)
    assert.equal(count('SportsEventBreakdown'), before.event)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })
    await waitFor(() => assert.equal(count('SportsBreakdown'), before.table + 2))
    assert.equal(count('SportsKPIs'), before.kpis + 2)
    assert.equal(count('SportsLeagueBreakdown'), before.league)
  })
})

describe('SportsOverviewReport views', () => {
  /** A slot name from a class list, given the class map that paints it. */
  function slotOf(element: Element | null, map: Record<string, string>): string {
    if (!element) return ''
    return Array.from(element.classList)
      .filter((name) => name in map)
      .map((name) => map[name])
      .join('+')
  }

  const LINE: Record<string, string> = {
    [chartStyles.lineS1]: 's1',
    [chartStyles.lineS2]: 's2',
    [chartStyles.lineS3]: 's3',
  }
  const KEY: Record<string, string> = {
    [chartStyles.keyS1]: 's1',
    [chartStyles.keyS2]: 's2',
    [chartStyles.keyS3]: 's3',
  }

  /** Each legend entry as [name, swatch slot], and each drawn line's slot, in drawing order. */
  function legendAndLines(root: Element): { legend: string[][]; lines: string[] } {
    const legendList = root.querySelector(`.${chartStyles.legend}`)
    assert.ok(legendList, 'the chart draws its legend')
    const legend = Array.from(legendList.children).map((item) => [
      item.textContent ?? '',
      slotOf(item.querySelector('i'), KEY),
    ])
    const lines = Array.from(root.querySelectorAll('.recharts-line')).map((line) => slotOf(line, LINE))
    return { legend, lines }
  }

  test('one tab stop with arrow keys; Trends and Overview draw each legend swatch on its own line', async () => {
    renderPage()
    await screen.findByText('Cricket')
    const tabs = screen.getByRole('tablist', { name: 'View mode' })
    const breakdown = within(tabs).getByRole('tab', { name: 'Breakdown' })
    assert.equal(breakdown.getAttribute('aria-selected'), 'true')
    assert.equal(screen.getByRole('tabpanel').getAttribute('aria-labelledby'), breakdown.id)

    fireEvent.keyDown(breakdown, { key: 'End' })
    const trends = within(tabs).getByRole('tab', { name: 'Trends' })
    assert.equal(trends.getAttribute('aria-selected'), 'true')
    const trendCard = await screen.findByRole('region', { name: 'Performance Trends' })
    within(trendCard).getByText('2 data points')
    await waitFor(() => assert.equal(trendCard.querySelectorAll('.recharts-line').length, 3))
    const trendChart = legendAndLines(trendCard)
    assert.deepStrictEqual(trendChart.legend, [['Stakes', 's1'], ['Payouts', 's2'], ['GGR', 's3']])
    assert.deepStrictEqual(trendChart.lines, ['s1', 's2', 's3'])
    // the legend is ours, in series order: recharts' own name-sorted legend is not drawn
    assert.equal(trendCard.querySelector('.recharts-default-legend'), null)

    fireEvent.keyDown(trends, { key: 'ArrowLeft' })
    assert.equal(within(tabs).getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected'), 'true')
    const contextTrend = await screen.findByRole('region', { name: 'Performance Trends' })
    await waitFor(() => assert.equal(contextTrend.querySelectorAll('.recharts-line').length, 3))
    const contextChart = legendAndLines(contextTrend)
    assert.deepStrictEqual(contextChart.legend, [['Stakes', 's1'], ['Payouts', 's2'], ['GGR', 's3']])
    assert.deepStrictEqual(contextChart.lines, ['s1', 's2', 's3'])
    screen.getByRole('region', { name: 'Top Performers (Stakes)' })
    screen.getByRole('region', { name: 'Distribution (GGR)' })
    assert.equal(screen.queryByRole('table', { name: 'Sports breakdown' }), null)
  })
})
