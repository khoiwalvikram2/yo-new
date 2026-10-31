/**
 * /reporting/players/profitability mounted against MockedProvider (real documents, exact variables: an
 * unmatched request fails the query) and a MemoryRouter. It pins the seven documents and their legacy
 * variables, skips and policies; the RBAC requirement with its agent bypass; the agent domain rules; the
 * merged All Domains rows and the KPI figures; the client-side search, paging and page-local sort; the
 * period control's variables; Refresh; and the loading, empty and error states. Currency, the auth store
 * and the RBAC guard are stubbed; the clock is fixed at 12:00 IST on 7 Oct 2026.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { DocumentNode } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import PlayerProfitabilityPage from './PlayerProfitabilityPage'
import styles from './PlayerProfitabilityPage.module.css'
import {
  ACTIVE_PLAYERS_QUERY,
  CASINO_KPIS_QUERY,
  CASINO_PLAYER_BREAKDOWN_QUERY,
  MATKA_KPIS_QUERY,
  MATKA_PLAYER_BREAKDOWN_QUERY,
  SPORTS_KPIS_QUERY,
  SPORTS_PLAYER_BREAKDOWN_QUERY,
} from './playerProfitabilityQueries'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  bypassForAgents?: boolean
}

const apollo = vi.hoisted(() => ({
  queries: [] as Array<{ name: string; options: Record<string, unknown> }>,
}))
const auth = vi.hoisted(() => ({
  isAgent: false,
  agent: undefined as { allowedDomains: string[] } | undefined,
}))
const guard = vi.hoisted(() => ({ allowed: true, calls: [] as GuardCall[] }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      const definition = args[0].definitions[0] as { name?: { value?: string } }
      apollo.queries.push({
        name: definition.name?.value ?? '',
        options: args[1] as Record<string, unknown>,
      })
      return actual.useQuery(...args)
    },
  }
})

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount * 2,
    formatAmount: (amount: number) => `INR ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: <T,>(selector: (state: { agent?: { allowedDomains: string[] }; isAgent: () => boolean }) => T) =>
    selector({ agent: auth.agent, isAgent: () => auth.isAgent }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, bypassForAgents, children }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required, bypassForAgents })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

/* 12:00 IST on 7 Oct 2026. */
const NOW = new Date('2026-10-07T06:30:00.000Z')
const ALL_TIME = { dateFrom: '2000-01-01', dateTo: '2026-10-07' }
const TODAY = { dateFrom: '2026-10-07', dateTo: '2026-10-07' }

type Range = typeof ALL_TIME

interface Row {
  __typename: 'PlayerBreakdown'
  playerId: number
  playerUsername: string
  playerPhone: string | null
  directAgentId: string | null
  directAgentName: string | null
  agentChain: string[]
  totalStakes: number
  totalPayouts: number
  grossGamingRevenue: number
  betCount: number
  avgStake: number
  winRate: number
}

function breakdownRow(playerId: number, patch: Partial<Row> = {}): Row {
  return {
    __typename: 'PlayerBreakdown',
    playerId,
    playerUsername: `player_${playerId}`,
    playerPhone: null,
    directAgentId: null,
    directAgentName: 'north_desk',
    agentChain: [],
    totalStakes: playerId * 100,
    totalPayouts: playerId * 40,
    grossGamingRevenue: playerId * 60,
    betCount: playerId,
    avgStake: 100,
    winRate: 0.4,
    ...patch,
  }
}

/* Sports holds players 1-25 (player 1 with an Unknown agent), casino player 1 again and player 26, matka
   player 27: All Domains merges them into 27 players over two pages of 20. */
const SPORTS_ROWS = Array.from({ length: 25 }, (_, index) => breakdownRow(index + 1, index === 0
  ? { directAgentName: 'Unknown' }
  : {}))
const CASINO_ROWS = [
  breakdownRow(1, {
    playerPhone: '9800000001',
    directAgentId: 'ag-9',
    directAgentName: 'east_desk',
    agentChain: ['master', 'east_desk'],
    totalStakes: 500,
    totalPayouts: 900,
    grossGamingRevenue: -400,
    betCount: 5,
  }),
  breakdownRow(26, { totalStakes: 1000, totalPayouts: 200, grossGamingRevenue: 800, betCount: 4 }),
]
const MATKA_ROWS = [breakdownRow(27, { totalStakes: 3000, totalPayouts: 3000, grossGamingRevenue: 0, betCount: 30 })]

const KPIS = {
  sports: { totalStakes: 10000, totalPayouts: 4000, grossGamingRevenue: 6000, betCount: 300 },
  casino: { totalStakes: 1500, totalPayouts: 1500, grossGamingRevenue: 0, betCount: 7 },
  matka: { totalStakes: 500, totalPayouts: 100, grossGamingRevenue: 400, betCount: 3 },
}

interface Counters {
  [name: string]: number
}

interface DataSet {
  sports?: Row[] | Error
  casino?: Row[] | Error
  matka?: Row[] | Error
  sportsKpi?: Error
  activePlayers?: number
}

function mock(
  name: string,
  query: DocumentNode,
  variables: Record<string, unknown>,
  data: Record<string, unknown> | Error,
  counters: Counters,
): MockedResponse {
  return {
    request: { query, variables },
    maxUsageCount: Number.POSITIVE_INFINITY,
    ...(data instanceof Error
      ? {
          result: () => {
            counters[name] = (counters[name] ?? 0) + 1
            return { errors: [{ message: data.message }] } as never
          },
        }
      : {
          result: () => {
            counters[name] = (counters[name] ?? 0) + 1
            return { data }
          },
        }),
  }
}

function mocksFor(range: Range, set: DataSet, counters: Counters): MockedResponse[] {
  const filter = { dateFrom: range.dateFrom, dateTo: range.dateTo }
  const rows = (value: Row[] | Error | undefined, field: string) =>
    value instanceof Error ? value : { [field]: value ?? [] }
  return [
    mock('sports', SPORTS_PLAYER_BREAKDOWN_QUERY, { filter }, rows(set.sports, 'sportsPlayerBreakdown'), counters),
    mock('casino', CASINO_PLAYER_BREAKDOWN_QUERY, { filter }, rows(set.casino, 'casinoPlayerBreakdown'), counters),
    mock('matka', MATKA_PLAYER_BREAKDOWN_QUERY, { filter }, rows(set.matka, 'matkaPlayerBreakdown'), counters),
    mock(
      'sportsKpi',
      SPORTS_KPIS_QUERY,
      { filter },
      set.sportsKpi ?? { sportsKPIs: { __typename: 'SportsKPIs', ...KPIS.sports } },
      counters,
    ),
    mock('casinoKpi', CASINO_KPIS_QUERY, { filter }, { casinoKPIs: { __typename: 'CasinoKPIs', ...KPIS.casino } }, counters),
    mock('matkaKpi', MATKA_KPIS_QUERY, { filter }, { matkaKPIs: { __typename: 'MatkaKPIs', ...KPIS.matka } }, counters),
    mock(
      'activePlayers',
      ACTIVE_PLAYERS_QUERY,
      { dateRange: filter },
      { overviewKPIs: { __typename: 'OverviewKPIs', activePlayers: set.activePlayers ?? 321 } },
      counters,
    ),
  ]
}

const STANDARD: DataSet = { sports: SPORTS_ROWS, casino: CASINO_ROWS, matka: MATKA_ROWS }

function renderPage(set: DataSet = STANDARD, counters: Counters = {}) {
  const mocks = [...mocksFor(ALL_TIME, set, counters), ...mocksFor(TODAY, set, counters)]
  return render(
    <MemoryRouter>
      <MockedProvider mocks={mocks}>
        <PageEyebrowProvider value="Reporting">
          <PlayerProfitabilityPage />
        </PageEyebrowProvider>
      </MockedProvider>
    </MemoryRouter>,
  )
}

function lastOptions(name: string): Record<string, unknown> {
  const call = [...apollo.queries].reverse().find((entry) => entry.name === name)
  assert.ok(call, `useQuery ran ${name}`)
  return call.options
}

function body(document: DocumentNode): string {
  const source = document.loc?.source.body
  assert.ok(source, 'the document keeps its source')
  return source.replace(/\s+/g, ' ').trim()
}

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1)
}

function currentPage(): string | null {
  return screen.getByRole('button', { current: 'page' }).textContent
}

/* Every document has answered once the table stops being busy (isLoading covers all seven). */
async function loaded(total = 'Total 27 players') {
  await screen.findByText(total)
  await waitFor(() => assert.equal(screen.getByRole('table').getAttribute('aria-busy'), 'false'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  apollo.queries.length = 0
  auth.isAgent = false
  auth.agent = undefined
  guard.allowed = true
  guard.calls.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PlayerProfitabilityPage — documents, access and personas', () => {
  test('keeps the seven documents, their legacy variables and policies, the guard and the page frame', async () => {
    renderPage()
    await loaded()

    assert.equal(
      body(SPORTS_PLAYER_BREAKDOWN_QUERY),
      'query SportsPlayerBreakdownProfitability($filter: SportsDrillDownFilter!) { sportsPlayerBreakdown(filter: $filter) { playerId playerUsername playerPhone directAgentId directAgentName agentChain totalStakes totalPayouts grossGamingRevenue betCount avgStake winRate } }',
    )
    assert.equal(
      body(CASINO_PLAYER_BREAKDOWN_QUERY),
      'query CasinoPlayerBreakdownProfitability($filter: CasinoDrillDownFilter!) { casinoPlayerBreakdown(filter: $filter) { playerId playerUsername playerPhone directAgentId directAgentName agentChain totalStakes totalPayouts grossGamingRevenue betCount avgStake winRate } }',
    )
    assert.equal(
      body(MATKA_PLAYER_BREAKDOWN_QUERY),
      'query MatkaPlayerBreakdownProfitability($filter: MatkaDrillDownFilter!) { matkaPlayerBreakdown(filter: $filter) { playerId playerUsername playerPhone directAgentId directAgentName agentChain totalStakes totalPayouts grossGamingRevenue betCount avgStake winRate } }',
    )
    assert.equal(
      body(SPORTS_KPIS_QUERY),
      'query SportsKPIsProfitability($filter: SportsReportingFilter) { sportsKPIs(filter: $filter) { totalStakes totalPayouts grossGamingRevenue betCount } }',
    )
    assert.equal(
      body(CASINO_KPIS_QUERY),
      'query CasinoKPIsProfitability($filter: CasinoReportingFilter) { casinoKPIs(filter: $filter) { totalStakes totalPayouts grossGamingRevenue betCount } }',
    )
    assert.equal(
      body(MATKA_KPIS_QUERY),
      'query MatkaKPIsProfitability($filter: MatkaReportingFilter) { matkaKPIs(filter: $filter) { totalStakes totalPayouts grossGamingRevenue betCount } }',
    )
    assert.equal(
      body(ACTIVE_PLAYERS_QUERY),
      'query ActivePlayersProfitability($dateRange: DashboardDateRange) { overviewKPIs(dateRange: $dateRange) { activePlayers } }',
    )

    for (const name of [
      'SportsPlayerBreakdownProfitability',
      'CasinoPlayerBreakdownProfitability',
      'MatkaPlayerBreakdownProfitability',
    ]) {
      assert.deepEqual(lastOptions(name), {
        variables: { filter: ALL_TIME },
        skip: false,
        errorPolicy: 'all',
        fetchPolicy: 'network-only',
      }, name)
    }
    for (const name of ['SportsKPIsProfitability', 'CasinoKPIsProfitability', 'MatkaKPIsProfitability']) {
      assert.deepEqual(lastOptions(name), {
        variables: { filter: ALL_TIME },
        errorPolicy: 'all',
        fetchPolicy: 'network-only',
      }, name)
    }
    assert.deepEqual(lastOptions('ActivePlayersProfitability'), {
      variables: { dateRange: ALL_TIME },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })

    assert.deepEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.players-profitability', actions: ['view'] }],
      bypassForAgents: true,
    })
    assert.ok(screen.queryByText('Reporting') === null)
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Player Profitability Report')
    assert.ok(screen.queryByText('Analyze player profitability and revenue across all domains') === null)
    assert.equal(screen.getByRole('heading', { level: 2 }).textContent, 'Player Profitability')
    assert.ok(screen.getByRole('button', { name: 'Period: All time' }))
  })

  test('a denied caller starts no query and sees the guard', () => {
    guard.allowed = false
    renderPage()

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(apollo.queries.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })

  test('an agent sees only its domains, and All Domains skips the breakdowns it may not see', async () => {
    auth.isAgent = true
    auth.agent = { allowedDomains: ['sports'] }
    renderPage()
    await loaded('Total 25 players')

    const domains = screen.getByRole('tablist', { name: 'Domain' })
    assert.deepEqual(
      within(domains).getAllByRole('tab').map((tab) => tab.textContent),
      ['All Domains', 'Sports'],
    )
    assert.equal(lastOptions('SportsPlayerBreakdownProfitability').skip, false)
    assert.equal(lastOptions('CasinoPlayerBreakdownProfitability').skip, true)
    assert.equal(lastOptions('MatkaPlayerBreakdownProfitability').skip, true)
    // casino's player 26 never arrives, so only the 25 sports players are listed
    assert.equal(screen.getAllByText('25 players').length, 2, 'the GGR note and the card subtitle')
    assert.equal(screen.queryByRole('link', { name: /player_26/ }), null)

    cleanup()
    apollo.queries.length = 0
    auth.isAgent = true
    auth.agent = undefined
    renderPage()
    await loaded()
    assert.deepEqual(
      within(screen.getByRole('tablist', { name: 'Domain' })).getAllByRole('tab').map((tab) => tab.textContent),
      ['All Domains', 'Sports', 'Casino', 'Matka'],
      'an agent with no allowedDomains falls back to all three',
    )
  })
})

describe('PlayerProfitabilityPage — rows and figures', () => {
  test('merges All Domains by player and prints the legacy cells and KPI figures', async () => {
    renderPage()
    await loaded()

    const first = screen.getByRole('link', { name: /player_1\b/ })
    assert.equal(first.getAttribute('href'), '/players/profile/1')
    assert.ok(within(first).getByText('9800000001'))
    const row = first.closest('tr')
    assert.ok(row)
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent)
    // stakes 100 + 500, payouts 40 + 900, GGR 60 - 400, 6 bets, all converted ×2
    assert.deepEqual(cells, [
      'player_1 9800000001',
      'master > east_desk',
      'INR 1200.00',
      'INR 1880.00',
      'INR -680.00',
      '6',
      'INR 200.00',
      '156.7%',
    ])
    assert.ok(within(row).getByText('INR -680.00').classList.contains(styles.ggrNeg))

    const second = screen.getByRole('link', { name: /player_2\b/ }).closest('tr')
    assert.ok(second)
    assert.ok(within(second).getByText('north_desk'))
    assert.ok(within(second).getByText('INR 240.00').classList.contains(styles.ggrPos))
    assert.ok(within(second).getByText('40.0%'))

    assert.ok(screen.getByText('INR 12800.00'))
    assert.equal(screen.getAllByText('27 players').length, 2, 'the GGR note and the card subtitle')
    assert.ok(screen.getByText('INR 24000.00'))
    assert.ok(screen.getByText('310 bets'))
    assert.ok(screen.getByText('INR 11200.00'))
    assert.ok(screen.getByText('Payout: 46.7%'))
    assert.ok(screen.getByText('321'))
    assert.ok(screen.getByText('20 showing'))
    assert.ok(screen.getByText('Total 27 players'))
    assert.equal(bodyRows().length, 20)
  })

  test('a domain tab runs only its breakdown, shows its rows and returns to page one; the selected tab keeps the page', async () => {
    renderPage()
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    assert.equal(currentPage(), '2')
    assert.equal(bodyRows().length, 7)
    // a press on the tab already selected changes nothing, as the legacy radio did
    fireEvent.click(screen.getByRole('tab', { name: 'All Domains' }))
    assert.equal(currentPage(), '2')
    assert.equal(bodyRows().length, 7)

    // one tab stop for the strip, arrows move the selection: All Domains → Sports → Casino
    const allTab = screen.getByRole('tab', { name: 'All Domains' })
    assert.equal(allTab.getAttribute('tabindex'), '0')
    assert.equal(screen.getByRole('tab', { name: 'Casino' }).getAttribute('tabindex'), '-1')
    assert.equal(screen.getByRole('tabpanel', { name: 'All Domains' }).id, allTab.getAttribute('aria-controls'))
    fireEvent.keyDown(allTab, { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Sports' }), { key: 'ArrowRight' })
    await screen.findByText('Total 2 players')
    assert.equal(screen.getByRole('tab', { name: 'Casino' }).getAttribute('aria-selected'), 'true')
    assert.ok(screen.getByRole('tabpanel', { name: 'Casino' }))
    assert.equal(currentPage(), '1')
    assert.equal(lastOptions('SportsPlayerBreakdownProfitability').skip, true)
    assert.equal(lastOptions('CasinoPlayerBreakdownProfitability').skip, false)
    assert.equal(lastOptions('MatkaPlayerBreakdownProfitability').skip, true)
    // a single domain shows its own figures for player 1: 500 staked, converted ×2
    const first = screen.getByRole('link', { name: /player_1\b/ }).closest('tr')
    assert.ok(first)
    assert.ok(within(first).getByText('INR 1000.00'))
    // the KPI row never follows the tab
    assert.ok(screen.getByText('INR 12800.00'))
  })
})

describe('PlayerProfitabilityPage — filters, paging and sorting', () => {
  test('search filters on the client, resets the page, and Clear all empties it and keeps focus in the bar', async () => {
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))

    const bar = screen.getByRole('search', { name: 'Filters' })
    const search = within(bar).getByRole('searchbox', { name: 'Search players' })
    assert.equal(search.getAttribute('placeholder'), 'Search by username, phone, ID...')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
    assert.ok(within(bar).getByText('0 filters applied'))
    fireEvent.change(search, { target: { value: 'PLAYER_2' } })
    // player_2, player_20 to player_27: the typed text is lower-cased and matched anywhere in the name
    await screen.findByText('Total 9 players')
    assert.equal(currentPage(), '1')
    assert.equal(screen.getAllByText('9 players').length, 2)
    assert.ok(within(bar).getByText('1 filter applied'))

    const clear = screen.getByRole('button', { name: 'Clear all' })
    clear.focus()
    fireEvent.click(clear)
    await screen.findByText('Total 27 players')
    assert.equal((search as HTMLInputElement).value, '')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
    await waitFor(() => assert.ok(bar.contains(document.activeElement), 'focus stays in the filter bar'))
  })

  test('a period preset asks every document for its range, and Clear all returns to All time', async () => {
    const counters: Counters = {}
    renderPage(STANDARD, counters)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))

    fireEvent.click(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: 'Today' }))
    await waitFor(() => {
      assert.deepEqual(lastOptions('SportsPlayerBreakdownProfitability').variables, { filter: TODAY })
      assert.deepEqual(lastOptions('MatkaKPIsProfitability').variables, { filter: TODAY })
      assert.deepEqual(lastOptions('ActivePlayersProfitability').variables, { dateRange: TODAY })
    })
    assert.equal(currentPage(), '1')
    await screen.findByRole('button', { name: 'Period: 07 Oct 2026 – 07 Oct 2026' })
    await waitFor(() => assert.equal(counters.activePlayers, 2))

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => {
      assert.deepEqual(lastOptions('CasinoPlayerBreakdownProfitability').variables, { filter: ALL_TIME })
    })
    assert.ok(await screen.findByRole('button', { name: 'Period: All time' }))
  })

  test('a sort orders the current page only and keeps the page; a new page size starts at page one', async () => {
    renderPage()
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    const header = screen.getByRole('columnheader', { name: /Total Stakes/ })
    const sortButton = within(header).getByRole('button', { name: 'Total Stakes' })
    fireEvent.click(sortButton)
    fireEvent.click(sortButton)
    assert.equal(header.getAttribute('aria-sort'), 'descending')
    assert.equal(currentPage(), '2')
    // page two holds players 21-27; descending stakes puts matka's 3000 first, then 25 × 100 = 2500
    const firstLinks = bodyRows().slice(0, 2).map((row) => within(row).getByRole('link').textContent)
    assert.deepEqual(firstLinks, ['player_27', 'player_25'])
    assert.equal(bodyRows().length, 7)

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '10' } })
    await waitFor(() => assert.equal(currentPage(), '1'))
    assert.equal(bodyRows().length, 10)
    assert.ok(screen.getByRole('button', { name: 'Page 3' }))
    assert.deepEqual(
      Array.from((screen.getByLabelText('Rows per page:') as HTMLSelectElement).options).map((option) => option.value),
      ['10', '20', '50', '100'],
    )
  })

  test('Refresh re-runs the visible tab’s breakdowns and every KPI document', async () => {
    const counters: Counters = {}
    renderPage(STANDARD, counters)
    await loaded()
    await waitFor(() => assert.equal(counters.activePlayers, 1))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      for (const name of ['sports', 'casino', 'matka', 'sportsKpi', 'casinoKpi', 'matkaKpi', 'activePlayers']) {
        assert.equal(counters[name], 2, name)
      }
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Matka' }))
    await screen.findByText('Total 1 players')
    const before = { ...counters }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(counters.activePlayers, (before.activePlayers ?? 0) + 1))
    await waitFor(() => assert.equal(counters.matka, (before.matka ?? 0) + 1))
    assert.equal(counters.sports, before.sports)
    assert.equal(counters.casino, before.casino)
  })
})

describe('PlayerProfitabilityPage — loading, empty and error states', () => {
  test('shows the table loading state first, then the empty state with zero totals', async () => {
    renderPage({ sports: [], casino: [], matka: [] })

    assert.ok(screen.getByText('Loading Player profitability'))
    assert.ok(screen.getByRole('columnheader', { name: /Win Rate/ }))
    assert.ok(await screen.findByText('No data'))
    assert.ok(screen.getByText('Total 0 players'))
    assert.equal(screen.getAllByText('0 players').length, 2)
  })

  test('a failed breakdown keeps the rows that arrived under an error with Retry; a failed total says so', async () => {
    const counters: Counters = {}
    renderPage({ sports: new Error('Sports breakdown failed'), casino: CASINO_ROWS, matka: MATKA_ROWS, sportsKpi: new Error('KPI failed') }, counters)

    const alert = await screen.findByText('Sports breakdown failed')
    assert.ok(alert)
    assert.ok(screen.getByRole('link', { name: /player_26/ }))
    assert.ok(screen.getByText('Some totals could not be loaded'))
    const retries = counters.casino ?? 0
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.equal(counters.casino, retries + 1))
  })

  test('a permission refusal stays silent: what arrived is shown with no error, Retry or totals notice', async () => {
    const refusal = new Error('Forbidden: insufficient permissions for reporting.sports:view')
    renderPage({ sports: refusal, casino: CASINO_ROWS, matka: MATKA_ROWS, sportsKpi: refusal })
    await loaded('Total 3 players')

    assert.ok(screen.getByRole('link', { name: /player_26/ }))
    assert.ok(screen.getByRole('link', { name: /player_27/ }))
    assert.ok(screen.queryByText(/Forbidden/) === null)
    assert.equal(screen.queryByRole('button', { name: 'Retry' }), null)
    assert.ok(screen.queryByText('Some totals could not be loaded') === null)
    // Total GGR is casino's 0 and matka's 400 alone, converted ×2
    assert.ok(screen.getByText('INR 800.00'))
  })

  test('with every breakdown failing the table shows the error alone', async () => {
    renderPage({
      sports: new Error('Breakdown service unavailable'),
      casino: new Error('Breakdown service unavailable'),
      matka: new Error('Breakdown service unavailable'),
    })

    assert.ok(await screen.findByText('Breakdown service unavailable'))
    assert.ok(screen.getByRole('button', { name: 'Retry' }))
    assert.equal(screen.queryByRole('link', { name: /player_/ }), null)
  })
})
