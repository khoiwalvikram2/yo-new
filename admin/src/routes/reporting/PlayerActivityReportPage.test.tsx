/**
 * /reporting/players/activity against a mocked GraphQL server (MockedProvider + MemoryRouter). The real
 * page, the kit and ReportingPeriodFilter render; only the kit date-range pill is stubbed (it has its own
 * suite), so a custom range can be applied in one click. useQuery is wrapped, not replaced: every
 * document and option the page passes is recorded, and every refetch is counted, while the real Apollo
 * hooks run against the mocks.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { computeReportingDateRange, type ReportingDateRange } from '@/modules/reporting/reportingDateFilter'
import PlayerActivityReportPage from './PlayerActivityReportPage'
import {
  ACTIVE_PLAYERS_QUERY,
  CASINO_KPIS_QUERY,
  CASINO_PLAYER_BREAKDOWN_QUERY,
  MATKA_KPIS_QUERY,
  MATKA_PLAYER_BREAKDOWN_QUERY,
  PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY,
  SPORTS_KPIS_QUERY,
  SPORTS_PLAYER_BREAKDOWN_QUERY,
  USERS_BY_IDS_QUERY,
} from './playerActivityReportQueries'
import { playerActivityPeriodDays } from './playerActivityReportModel'

interface HookCall {
  name: string
  document: unknown
  options: Record<string, unknown>
}

interface MockAgent {
  allowedDomains?: string[]
}

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  bypassForAgents?: boolean
}

interface DateRangeFieldProps {
  label?: string
  valueLabel?: string
  appliedPreset: string
  onApply: (payload: { kind: 'preset'; preset: string } | { kind: 'custom'; from: string; to: string }) => void
  onReset: () => void
}

const apollo = vi.hoisted(() => ({
  queries: [] as HookCall[],
  refetches: [] as string[],
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
  const nameOf = (document: unknown) =>
    (document as { definitions?: Array<{ name?: { value?: string } }> }).definitions?.[0]?.name?.value ?? ''
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      const name = nameOf(args[0])
      apollo.queries.push({ name, document: args[0], options: (args[1] ?? {}) as Record<string, unknown> })
      const result = actual.useQuery(...args)
      return {
        ...result,
        refetch: (...refetchArgs: Parameters<typeof result.refetch>) => {
          apollo.refetches.push(name)
          return result.refetch(...refetchArgs)
        },
      }
    },
  }
})

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount * 2,
    formatAmount: (amount: number) =>
      `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  }),
}))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: MockAgent; isAgent: () => boolean }) => unknown) =>
    selector({ agent: auth.agent, isAgent: () => auth.isAgent }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, bypassForAgents, children }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required, bypassForAgents })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

// The kit pill and its panel have their own suites (DateRangeField, ReportingPeriodFilter); this stand-in
// applies a custom range in one click and shows the label the page's period filter computes.
vi.mock('@/ui/components/DateRangeField', () => ({
  DateRangeField: ({ label = 'Period', valueLabel, appliedPreset, onApply, onReset }: DateRangeFieldProps) => (
    <div data-testid="period-pill">
      <output aria-label={`${label} applied`}>{`${appliedPreset}|${valueLabel ?? ''}`}</output>
      <button type="button" onClick={() => onApply({ kind: 'custom', from: '2026-01-02', to: '2026-01-04' })}>
        Apply Custom Range
      </button>
      <button type="button" onClick={onReset}>
        Reset Period
      </button>
    </div>
  ),
}))

type Row = Record<string, unknown>

function breakdown(playerId: string, overrides: Row = {}): Row {
  return {
    playerId,
    playerUsername: `player_${playerId}`,
    playerPhone: null,
    directAgentId: null,
    directAgentName: null,
    totalStakes: 0,
    totalPayouts: 0,
    grossGamingRevenue: 0,
    betCount: 0,
    avgStake: 0,
    winRate: 0,
    ...overrides,
  }
}

function user(id: string, overrides: Row = {}): Row {
  return { id, name: null, username: `player_${id}`, email: null, phone: null, status: null, ...overrides }
}

function stats(playerId: string, overrides: Row = {}): Row {
  return {
    playerId,
    totalDepositAmount: 0,
    totalDepositCount: 0,
    totalWithdrawalAmount: 0,
    totalWithdrawalCount: 0,
    rangeDepositAmount: 0,
    rangeDepositCount: 0,
    rangeWithdrawalAmount: 0,
    rangeWithdrawalCount: 0,
    ...overrides,
  }
}

const SPORTS_ROWS = [
  breakdown('101', {
    playerUsername: 'rk_sharma88',
    playerPhone: '9810000001',
    directAgentId: '7',
    directAgentName: 'Kiran D.',
    totalStakes: 1000,
    totalPayouts: 400,
    grossGamingRevenue: 600,
    betCount: 10,
  }),
  breakdown('102', { playerUsername: 'vjy_2401', totalStakes: 200, totalPayouts: 0, grossGamingRevenue: 200 }),
]
const CASINO_ROWS = [
  breakdown('101', { totalStakes: 500, totalPayouts: 100, grossGamingRevenue: 400, betCount: 5 }),
]
const MATKA_ROWS = [
  breakdown('103', { playerUsername: 'meena.p', totalStakes: 300, totalPayouts: 0, grossGamingRevenue: 300, betCount: 3 }),
]
const USERS = [
  user('101', { name: 'Rakesh Sharma', email: 'rk@example.test', phone: '9810000001', status: 'active' }),
  user('102', { status: 'inactive' }),
  user('103', { name: 'Meena P', email: 'meena@example.test', status: 'pending' }),
]
const STATS = [
  stats('101', {
    totalDepositAmount: 5000,
    totalDepositCount: 3,
    rangeDepositAmount: 1000,
    rangeDepositCount: 1,
    totalWithdrawalAmount: 2000,
    totalWithdrawalCount: 1,
  }),
]
const KPIS = {
  sports: { totalStakes: 1200, totalPayouts: 400, grossGamingRevenue: 800, betCount: 10 },
  casino: { totalStakes: 500, totalPayouts: 100, grossGamingRevenue: 400, betCount: 5 },
  matka: { totalStakes: 300, totalPayouts: 0, grossGamingRevenue: 300, betCount: 3 },
}

function mock(query: unknown, variables: Row, data: Row): MockedResponse {
  return {
    request: { query: query as MockedResponse['request']['query'], variables },
    result: { data },
    maxUsageCount: 20,
  }
}

interface Scenario {
  range: ReportingDateRange
  sports?: Row[]
  casino?: Row[]
  matka?: Row[]
  /** Each id list the users and stats queries will be asked for. */
  idSets?: string[][]
  users?: Row[]
  stats?: Row[]
}

function scenarioMocks({
  range,
  sports = SPORTS_ROWS,
  casino = CASINO_ROWS,
  matka = MATKA_ROWS,
  idSets = [['101', '102', '103']],
  users = USERS,
  stats: statRows = STATS,
}: Scenario): MockedResponse[] {
  const filter = { dateFrom: range.dateFrom, dateTo: range.dateTo }
  const idMocks = idSets.flatMap((ids) => [
    mock(USERS_BY_IDS_QUERY, { ids }, { usersByIds: users.filter((u) => ids.includes(String(u.id))) }),
    mock(
      PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY,
      { ids, ...filter },
      { playerActivityDepositWithdrawalStats: statRows.filter((s) => ids.includes(String(s.playerId))) },
    ),
  ])
  return [
    mock(SPORTS_PLAYER_BREAKDOWN_QUERY, { filter }, { sportsPlayerBreakdown: sports }),
    mock(CASINO_PLAYER_BREAKDOWN_QUERY, { filter }, { casinoPlayerBreakdown: casino }),
    mock(MATKA_PLAYER_BREAKDOWN_QUERY, { filter }, { matkaPlayerBreakdown: matka }),
    mock(SPORTS_KPIS_QUERY, { filter }, { sportsKPIs: KPIS.sports }),
    mock(CASINO_KPIS_QUERY, { filter }, { casinoKPIs: KPIS.casino }),
    mock(MATKA_KPIS_QUERY, { filter }, { matkaKPIs: KPIS.matka }),
    mock(ACTIVE_PLAYERS_QUERY, { dateRange: filter }, { overviewKPIs: { activePlayers: 42 } }),
    ...idMocks,
  ]
}

function renderPage(mocks: MockedResponse[]) {
  return render(
    <MockedProvider mocks={mocks} addTypename={false}>
      <MemoryRouter initialEntries={['/reporting/players/activity']}>
        <PageEyebrowProvider value="Reporting">
          <PlayerActivityReportPage />
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

function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table', { name: 'Player activity' })
  return within(table).getAllByRole('row').slice(1)
}

function rowText(username: string): string {
  const match = bodyRows().find((row) => within(row).queryByText(username) !== null)
  assert.ok(match, `Expected a row for ${username}`)
  return match.textContent ?? ''
}

async function loaded(text = 'meena.p') {
  await screen.findByText(text)
  await waitFor(() => assert.equal(screen.getByRole('table', { name: 'Player activity' }).getAttribute('aria-busy'), 'false'))
}

function currentPage(): string | null {
  return screen.getByRole('button', { current: 'page' }).textContent
}

const ALL_TIME = computeReportingDateRange('allTime')

beforeEach(() => {
  apollo.queries.length = 0
  apollo.refetches.length = 0
  auth.isAgent = false
  auth.agent = undefined
  guard.allowed = true
  guard.calls.length = 0
})

describe('PlayerActivityReportPage contracts', () => {
  test('sends the nine legacy documents with their exact variables and options under the guard', async () => {
    renderPage(scenarioMocks({ range: ALL_TIME }))

    // Before any data: the id-driven queries are skipped with empty id lists.
    assert.deepStrictEqual(latest('UsersByIds').options, {
      variables: { ids: [] },
      skip: true,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })
    assert.deepStrictEqual(latest('PlayerActivityDepositWithdrawalStats').options, {
      variables: { ids: [], ...ALL_TIME },
      skip: true,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })

    await loaded()
    const filter = { dateFrom: ALL_TIME.dateFrom, dateTo: ALL_TIME.dateTo }
    for (const name of ['SportsPlayerBreakdown', 'CasinoPlayerBreakdown', 'MatkaPlayerBreakdown']) {
      assert.deepStrictEqual(latest(name).options, {
        variables: { filter },
        skip: false,
        errorPolicy: 'all',
        fetchPolicy: 'network-only',
      })
    }
    for (const name of ['SportsKPIsActivity', 'CasinoKPIsActivity', 'MatkaKPIsActivity']) {
      assert.deepStrictEqual(latest(name).options, {
        variables: { filter },
        errorPolicy: 'all',
        fetchPolicy: 'network-only',
      })
    }
    assert.deepStrictEqual(latest('ActivePlayersActivity').options, {
      variables: { dateRange: filter },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })
    assert.deepStrictEqual(latest('UsersByIds').options, {
      variables: { ids: ['101', '102', '103'] },
      skip: false,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })
    assert.deepStrictEqual(latest('PlayerActivityDepositWithdrawalStats').options, {
      variables: { ids: ['101', '102', '103'], ...filter },
      skip: false,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })

    assert.equal(latest('SportsPlayerBreakdown').document, SPORTS_PLAYER_BREAKDOWN_QUERY)
    assert.equal(
      normalised(SPORTS_PLAYER_BREAKDOWN_QUERY),
      'query SportsPlayerBreakdown($filter: SportsDrillDownFilter!) { sportsPlayerBreakdown(filter: $filter) { playerId playerUsername playerPhone directAgentId directAgentName totalStakes totalPayouts grossGamingRevenue betCount avgStake winRate } }',
    )
    assert.equal(
      normalised(CASINO_PLAYER_BREAKDOWN_QUERY),
      'query CasinoPlayerBreakdown($filter: CasinoDrillDownFilter!) { casinoPlayerBreakdown(filter: $filter) { playerId playerUsername playerPhone directAgentId directAgentName totalStakes totalPayouts grossGamingRevenue betCount avgStake winRate } }',
    )
    assert.equal(
      normalised(MATKA_PLAYER_BREAKDOWN_QUERY),
      'query MatkaPlayerBreakdown($filter: MatkaDrillDownFilter!) { matkaPlayerBreakdown(filter: $filter) { playerId playerUsername playerPhone directAgentId directAgentName totalStakes totalPayouts grossGamingRevenue betCount avgStake winRate } }',
    )
    assert.equal(
      normalised(USERS_BY_IDS_QUERY),
      'query UsersByIds($ids: [ID!]!) { usersByIds(ids: $ids) { id name username email phone status } }',
    )
    assert.equal(
      normalised(PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY),
      'query PlayerActivityDepositWithdrawalStats($ids: [ID!]!, $dateFrom: String, $dateTo: String) { playerActivityDepositWithdrawalStats(ids: $ids, dateFrom: $dateFrom, dateTo: $dateTo) { playerId totalDepositAmount totalDepositCount totalWithdrawalAmount totalWithdrawalCount rangeDepositAmount rangeDepositCount rangeWithdrawalAmount rangeWithdrawalCount } }',
    )
    assert.equal(
      normalised(SPORTS_KPIS_QUERY),
      'query SportsKPIsActivity($filter: SportsReportingFilter) { sportsKPIs(filter: $filter) { totalStakes totalPayouts grossGamingRevenue betCount } }',
    )
    assert.equal(
      normalised(CASINO_KPIS_QUERY),
      'query CasinoKPIsActivity($filter: CasinoReportingFilter) { casinoKPIs(filter: $filter) { totalStakes totalPayouts grossGamingRevenue betCount } }',
    )
    assert.equal(
      normalised(MATKA_KPIS_QUERY),
      'query MatkaKPIsActivity($filter: MatkaReportingFilter) { matkaKPIs(filter: $filter) { totalStakes totalPayouts grossGamingRevenue betCount } }',
    )
    assert.equal(
      normalised(ACTIVE_PLAYERS_QUERY),
      'query ActivePlayersActivity($dateRange: DashboardDateRange) { overviewKPIs(dateRange: $dateRange) { activePlayers } }',
    )

    assert.deepStrictEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.players-activity', actions: ['view'] }],
      bypassForAgents: true,
    })
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Player Activity Report')
    assert.ok(screen.queryByText('Reporting') === null)
    assert.ok(screen.queryByText('Analyze player betting activity across all domains') === null)
    assert.deepStrictEqual(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
      ['Player Activity'],
    )
  })

  test('starts no query when the guard denies the caller', () => {
    guard.allowed = false
    renderPage(scenarioMocks({ range: ALL_TIME }))

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(apollo.queries.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
    assert.deepStrictEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.players-activity', actions: ['view'] }],
      bypassForAgents: true,
    })
  })

  test('shows the merged rows, KPI figures and legacy cell copy', async () => {
    renderPage(scenarioMocks({ range: ALL_TIME }))
    await loaded()

    const days = playerActivityPeriodDays(ALL_TIME.dateFrom, ALL_TIME.dateTo).toLocaleString()
    const card = screen.getByRole('region', { name: 'Player Activity' })
    within(card).getByText('3 players')
    screen.getByText('Total 3 players')
    assert.equal(bodyRows().length, 3)

    // Sports + casino merged, user details joined, stats joined (amounts converted x2).
    assert.equal(
      rowText('rk_sharma88'),
      [
        'rk_sharma88',
        'Rakesh Sharma',
        'rk@example.test',
        '9810000001',
        'ACTIVE',
        'Kiran D.',
        '₹10,000.00(3)',
        '₹2,000.00(1)',
        '₹4,000.00(1)',
        '₹0.00(0)',
        '15',
        `${(15 / Number(playerActivityPeriodDays(ALL_TIME.dateFrom, ALL_TIME.dateTo))).toFixed(2)} bets/day`,
        '₹3,000.00',
        '₹1,000.00',
        // the GGR carries its house sign in words for assistive tech (its colour says it on screen)
        'House gain ₹2,000.00',
        '₹200.00',
        '33.3%',
        days,
        'Yes',
      ].join(''),
    )
    const phone = screen.getByRole('link', { name: '9810000001' })
    assert.equal(phone.getAttribute('href'), '/players/profile/101')
    // No name, email, phone or agent: dashes; inactive status; no stats row; no bets in the period.
    assert.match(rowText('vjy_2401'), /^vjy_2401———INACTIVE—₹0\.00\(0\)/)
    assert.match(rowText('vjy_2401'), /No$/)
    // A status outside active/inactive keeps its text, upper-cased.
    assert.match(rowText('meena.p'), /^meena\.pMeena Pmeena@example\.test—PENDING—₹0\.00\(0\)/)

    const stats = screen.getByRole('group', { name: 'Player activity statistics' })
    const figure = (label: string) => within(stats).getByText(label).parentElement?.textContent
    assert.equal(figure('Active Players'), 'Active Players423 showing')
    assert.equal(figure('Total Bets'), 'Total Bets18Avg: 6.0/player')
    assert.equal(figure('Total Stakes'), 'Total Stakes₹4,000.00Avg: ₹1,333.33')
    assert.equal(figure('Avg Bets/Player'), 'Avg Bets/Player6.0Average per player')
  })
})

describe('PlayerActivityReportPage domains and agents', () => {
  test('a domain tab asks only for its own breakdown and the tab panel follows it', async () => {
    renderPage(scenarioMocks({ range: ALL_TIME, idSets: [['101', '102', '103'], ['101']] }))
    await loaded()

    const tabs = screen.getByRole('tablist', { name: 'Domain' })
    assert.deepStrictEqual(
      within(tabs).getAllByRole('tab').map((tab) => tab.textContent),
      ['All Domains', 'Sports', 'Casino', 'Matka'],
    )
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Casino' }))
    await waitFor(() => {
      assert.equal(latest('SportsPlayerBreakdown').options.skip, true)
      assert.equal(latest('CasinoPlayerBreakdown').options.skip, false)
      assert.equal(latest('MatkaPlayerBreakdown').options.skip, true)
    })
    assert.equal(within(tabs).getByRole('tab', { name: 'Casino' }).getAttribute('aria-selected'), 'true')
    screen.getByRole('tabpanel', { name: 'Casino' })
    await waitFor(() => assert.equal(bodyRows().length, 1))
    // The KPI totals are never domain-filtered.
    assert.equal(latest('SportsKPIsActivity').options.skip, undefined)
  })

  test('an agent sees and asks for only its allowed domains, and the tabs keep one tab stop', async () => {
    auth.isAgent = true
    auth.agent = { allowedDomains: ['sports'] }
    renderPage(scenarioMocks({ range: ALL_TIME, idSets: [['101', '102']] }))
    await loaded('vjy_2401')

    const tabs = screen.getByRole('tablist', { name: 'Domain' })
    assert.deepStrictEqual(
      within(tabs).getAllByRole('tab').map((tab) => tab.textContent),
      ['All Domains', 'Sports'],
    )
    assert.equal(latest('SportsPlayerBreakdown').options.skip, false)
    assert.equal(latest('CasinoPlayerBreakdown').options.skip, true)
    assert.equal(latest('MatkaPlayerBreakdown').options.skip, true)
    assert.ok(screen.queryByText('meena.p') === null)

    const allTab = within(tabs).getByRole('tab', { name: 'All Domains' })
    const sportsTab = within(tabs).getByRole('tab', { name: 'Sports' })
    assert.equal(allTab.getAttribute('tabindex'), '0')
    assert.equal(sportsTab.getAttribute('tabindex'), '-1')
    allTab.focus()
    fireEvent.keyDown(allTab, { key: 'ArrowRight' })
    await waitFor(() => assert.equal(sportsTab.getAttribute('aria-selected'), 'true'))
    assert.ok(document.activeElement === sportsTab, 'focus follows the selection')
  })

  test('an agent with no domain list is treated as allowed every domain', async () => {
    auth.isAgent = true
    auth.agent = {}
    renderPage(scenarioMocks({ range: ALL_TIME }))
    await loaded()
    assert.equal(within(screen.getByRole('tablist', { name: 'Domain' })).getAllByRole('tab').length, 4)
    assert.equal(latest('CasinoPlayerBreakdown').options.skip, false)
  })
})

describe('PlayerActivityReportPage filters, sorting and paging', () => {
  test('a period preset or custom range re-queries every dated operation; Clear all returns to All time', async () => {
    const today = computeReportingDateRange('today')
    const custom = { dateFrom: '2026-01-02', dateTo: '2026-01-04' }
    renderPage([
      ...scenarioMocks({ range: ALL_TIME }),
      ...scenarioMocks({ range: today }),
      ...scenarioMocks({ range: custom }),
    ])
    await loaded()

    fireEvent.click(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: 'Today' }))
    await waitFor(() => {
      assert.deepStrictEqual(latest('SportsPlayerBreakdown').options.variables, { filter: today })
      assert.deepStrictEqual(latest('MatkaKPIsActivity').options.variables, { filter: today })
      assert.deepStrictEqual(latest('ActivePlayersActivity').options.variables, { dateRange: today })
    })
    await loaded()
    screen.getByText('1 filter applied')

    fireEvent.click(screen.getByRole('button', { name: 'Apply Custom Range' }))
    await waitFor(() => {
      assert.deepStrictEqual(latest('CasinoPlayerBreakdown').options.variables, { filter: custom })
      assert.deepStrictEqual(latest('PlayerActivityDepositWithdrawalStats').options.variables, {
        ids: ['101', '102', '103'],
        ...custom,
      })
    })
    await loaded()
    assert.equal(screen.getByLabelText('Period applied').textContent, 'custom|02 Jan 2026 – 04 Jan 2026')
    // Three calendar days in the custom period; 15 bets over 3 days.
    assert.match(rowText('rk_sharma88'), /5\.00 bets\/day/)
    assert.match(rowText('rk_sharma88'), /33\.3%3Yes$/)

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.deepStrictEqual(latest('SportsPlayerBreakdown').options.variables, { filter: ALL_TIME }))
    screen.getByText('0 filters applied')
  })

  test('the local search matches the legacy fields and shows the empty hint when nothing matches', async () => {
    renderPage(scenarioMocks({ range: ALL_TIME }))
    await loaded()

    const search = screen.getByRole('searchbox', { name: 'Search players' })
    assert.equal(search.getAttribute('placeholder'), 'Search by username, name, email, phone, ID...')
    fireEvent.change(search, { target: { value: 'MEENA@' } })
    await waitFor(() => assert.equal(bodyRows().length, 1))
    screen.getByText('1 player')
    screen.getByText('1 filter applied')
    // The KPI totals stay the domain totals; the averages follow the searched players.
    screen.getByText('Avg: 18.0/player')

    fireEvent.change(search, { target: { value: 'nobody' } })
    await screen.findByText('No players found for the selected period. Try adjusting the date range or search.')
    screen.getByText('Total 0 players')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.equal(bodyRows().length, 3))
    assert.equal((search as HTMLInputElement).value, '')
  })

  test('pages the filtered list, sorts only the current page, and resets the page on filters', async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      breakdown(String(index + 1), { playerUsername: `p${String(index + 1).padStart(2, '0')}`, betCount: 26 - (index + 1) }),
    )
    const ids = many.map((row) => String(row.playerId))
    renderPage(scenarioMocks({ range: ALL_TIME, sports: many, casino: [], matka: [], idSets: [ids], users: [], stats: [] }))
    await loaded('p01')

    screen.getByText('Total 25 players')
    assert.equal(bodyRows().length, 20)
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(currentPage(), '2'))
    assert.deepStrictEqual(bodyRows().map((row) => within(row).getAllByRole('cell')[0].textContent), [
      'p21',
      'p22',
      'p23',
      'p24',
      'p25',
    ])

    const header = screen.getByRole('columnheader', { name: /Total Bets/ })
    const sortButton = within(header).getByRole('button', { name: 'Total Bets' })
    fireEvent.click(sortButton)
    assert.equal(header.getAttribute('aria-sort'), 'ascending')
    // Ascending within page 2 only: p25 has the fewest bets of the whole list and of this page.
    assert.deepStrictEqual(bodyRows().map((row) => within(row).getAllByRole('cell')[0].textContent), [
      'p25',
      'p24',
      'p23',
      'p22',
      'p21',
    ])
    // Sorting does not change the page; page 1 sorts its own twenty rows.
    assert.equal(currentPage(), '2')
    fireEvent.click(screen.getByRole('button', { name: 'Page 1' }))
    await waitFor(() => assert.equal(within(bodyRows()[0]).getAllByRole('cell')[0].textContent, 'p20'))
    fireEvent.click(sortButton)
    assert.equal(header.getAttribute('aria-sort'), 'descending')
    assert.equal(within(bodyRows()[0]).getAllByRole('cell')[0].textContent, 'p01')
    fireEvent.click(sortButton)
    assert.equal(header.getAttribute('aria-sort'), 'none')

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search players' }), { target: { value: 'p2' } })
    await waitFor(() => assert.equal(currentPage(), '1'))
    screen.getByText('Total 6 players')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search players' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '10' } })
    await waitFor(() => assert.equal(currentPage(), '1'))
    assert.equal(bodyRows().length, 10)
    screen.getByRole('button', { name: 'Page 3' })
  })
})

describe('PlayerActivityReportPage states and refresh', () => {
  test('keeps the table headers while loading, then shows the empty hint for an empty period', async () => {
    renderPage(scenarioMocks({ range: ALL_TIME, sports: [], casino: [], matka: [], idSets: [] }))

    screen.getByText('Loading Player activity')
    screen.getByRole('columnheader', { name: /Username/ })
    screen.getByRole('columnheader', { name: /Bets in Period/ })
    await screen.findByText('No players found for the selected period. Try adjusting the date range or search.')
    screen.getByText('Total 0 players')
    screen.getByText('0 players')
    assert.equal(latest('UsersByIds').options.skip, true)
    assert.equal(latest('PlayerActivityDepositWithdrawalStats').options.skip, true)
  })

  test('reports a failed domain beside the rows that did load', async () => {
    const mocks = scenarioMocks({ range: ALL_TIME }).map((entry) =>
      entry.request.query === CASINO_PLAYER_BREAKDOWN_QUERY
        ? { ...entry, result: { errors: [new GraphQLError('casino service down')] } }
        : entry,
    )
    renderPage(mocks)
    await loaded()

    const alert = await screen.findByRole('alert')
    within(alert).getByText('Failed to load some data')
    within(alert).getByText('Casino: casino service down')
    assert.equal(bodyRows().length, 3)
  })

  test('Refresh refetches the selected domain breakdowns and every other operation', async () => {
    renderPage(scenarioMocks({ range: ALL_TIME, idSets: [['101', '102', '103'], ['101', '102']] }))
    await loaded()

    apollo.refetches.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    assert.deepStrictEqual(apollo.refetches, [
      'SportsPlayerBreakdown',
      'CasinoPlayerBreakdown',
      'MatkaPlayerBreakdown',
      'SportsKPIsActivity',
      'CasinoKPIsActivity',
      'MatkaKPIsActivity',
      'ActivePlayersActivity',
      'UsersByIds',
      'PlayerActivityDepositWithdrawalStats',
    ])
    await loaded()

    fireEvent.click(screen.getByRole('tab', { name: 'Sports' }))
    await waitFor(() => assert.equal(bodyRows().length, 2))
    await waitFor(() => assert.equal(screen.getByRole('table', { name: 'Player activity' }).getAttribute('aria-busy'), 'false'))
    apollo.refetches.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    assert.deepStrictEqual(apollo.refetches, [
      'SportsPlayerBreakdown',
      'SportsKPIsActivity',
      'CasinoKPIsActivity',
      'MatkaKPIsActivity',
      'ActivePlayersActivity',
      'UsersByIds',
      'PlayerActivityDepositWithdrawalStats',
    ])
  })
})
