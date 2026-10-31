/**
 * /reporting/agents/performance against a mocked GraphQL server (MockedProvider with a link that
 * answers each operation by name and records what was sent, + MemoryRouter). The real page, the shared
 * reporting hooks and store, and the kit render; useQuery is wrapped, not replaced, so every option the
 * hooks pass is recorded. The period control has its own suite and is a deterministic stand-in here.
 * The clock is fixed at 2026-10-07 11:30 IST.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloLink, Observable, type FetchResult } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import {
  AGENT_KPIS_QUERY,
  AGENT_PERFORMANCE_QUERY,
  AGENT_PLAYER_BREAKDOWN_QUERY,
} from '@/modules/reporting/graphql'
import type { ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useReportingStore, type DrillDownLevel, type ReportingFilters } from '@/state/reportingStore'
import AgentPerformanceReport from './AgentPerformanceReport'

interface HookCall {
  name: string
  document: unknown
  options: Record<string, unknown>
}

interface MockAgent {
  id: string
  schemeType: string
  allowedDomains?: string[]
}

interface PeriodStubProps {
  dateFrom: string
  dateTo: string
  preset?: ReportingDatePreset
  onChange: (dateFrom: string, dateTo: string, preset: ReportingDatePreset) => void
}

type Variables = Record<string, unknown>
type Reply = FetchResult | Error | Promise<FetchResult | Error>

const apollo = vi.hoisted(() => ({ queries: [] as HookCall[] }))

const auth = vi.hoisted(() => ({ isAgent: false, agent: undefined as MockAgent | undefined }))

const guard = vi.hoisted(() => ({ allowed: true, calls: [] as unknown[] }))

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const nameOf = (document: unknown) =>
    (document as { definitions?: Array<{ name?: { value?: string } }> }).definitions?.[0]?.name?.value ?? ''
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ name: nameOf(args[0]), document: args[0], options: (args[1] ?? {}) as Record<string, unknown> })
      return actual.useQuery(...args)
    },
  }
})

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: MockAgent; isAgent: () => boolean }) => unknown) =>
    selector({ agent: auth.agent, isAgent: () => auth.isAgent }),
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

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount * 2,
    formatAmount: (amount: number) => `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  }),
}))

vi.mock('@/shared/services/notification', () => ({ notify: toasts }))

vi.mock('@/modules/reporting/ui/ReportingPeriodFilter', () => ({
  ReportingPeriodFilter: ({ dateFrom, dateTo, preset, onChange }: PeriodStubProps) => (
    <div role="group" aria-label="Period (stub)">
      <output data-testid="period-state">{`${preset}|${dateFrom}|${dateTo}`}</output>
      <button type="button" onClick={() => onChange('2026-10-06', '2026-10-06', 'yesterday')}>Apply Yesterday</button>
    </div>
  ),
}))

const NOW = new Date('2026-10-07T06:00:00.000Z')
const ALL_TIME = { dateFrom: '2000-01-01', dateTo: '2026-10-07' }

const KPIS = {
  totalTurnover: 5000,
  totalGGR: 900,
  commissionEarned: 70,
  shareEarned: 30,
  downlineTurnover: 0,
  downlineGGR: 0,
  playerCount: 640,
  activePlayerCount: 300,
  betCount: 12000,
  agentCount: 7,
}

const TOTALS = {
  totalTurnover: 4000,
  totalGGR: 800,
  commissionEarned: 60,
  shareEarned: 25,
  agentCount: 2,
  playerCount: 500,
  betCount: 9000,
}

function agent(index: number, overrides: Record<string, unknown> = {}) {
  return {
    agentId: `ag-${index}`,
    agentName: `Agent ${String(index).padStart(2, '0')}`,
    schemeType: 'COMMISSION',
    totalTurnover: 1000,
    totalGGR: 100 + index,
    commissionEarned: 10 + index,
    shareEarned: 1,
    downlineTurnover: 0,
    downlineGGR: 0,
    playerCount: 50 + index,
    betCount: 900 + index,
    level: 1,
    userCutPercent: null,
    agentCutPercent: null,
    domainBreakdown: null,
    ...overrides,
  }
}

const AGENTS = [
  agent(1, {
    agentName: 'Kiran',
    domainBreakdown: [
      { domain: 'sports', turnover: 10, ggr: 5, cut: 40, cutPercent: 5, userCutPercent: 90, agentCutPercent: 85 },
      { domain: 'casino', turnover: 10, ggr: 5, cut: 12, cutPercent: null, userCutPercent: null, agentCutPercent: null },
    ],
  }),
  agent(2, { agentName: null, schemeType: null }),
]

const PLAYERS = [
  { playerId: 41, playerUsername: 'riya', totalStakes: 100, totalPayouts: 80, grossGamingRevenue: 20, betCount: 9, avgStake: 11, winRate: 0.6 },
  { playerId: 42, playerUsername: null, totalStakes: 90, totalPayouts: 95, grossGamingRevenue: -5, betCount: 1, avgStake: 90, winRate: 0.1 },
]

/* ------------------------------ the server ------------------------------ */

const network: Array<{ name: string; variables: Variables }> = []
let handlers: Record<string, (variables: Variables) => Reply> = {}

function data(field: string, value: unknown): FetchResult {
  return { data: { [field]: value } }
}

function defaultHandlers(): Record<string, (variables: Variables) => Reply> {
  return {
    AgentKPIs: () => data('agentKPIs', KPIS),
    AgentPerformance: () => data('agentPerformance', { agents: AGENTS, totals: TOTALS }),
    AgentPlayerBreakdown: () => data('agentPlayerBreakdown', PLAYERS),
  }
}

const serverLink = new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
  network.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) })
  const handler = handlers[operation.operationName]
  let active = true
  Promise.resolve(handler ? handler(operation.variables) : new Error(`Unexpected ${operation.operationName}`)).then(
    (reply) => {
      if (!active) return
      if (reply instanceof Error) observer.error(reply)
      else {
        observer.next(reply)
        observer.complete()
      }
    },
    (error: unknown) => {
      if (active) observer.error(error)
    },
  )
  return () => {
    active = false
  }
}))

function lastQueryVariables(name: string): Variables {
  return JSON.parse(JSON.stringify(
    [...apollo.queries].reverse().find(call => call.name === name)?.options.variables ?? {},
  )) as Variables;
}

function renderPage() {
  return render(
    <MockedProvider link={serverLink} addTypename={false}>
      <MemoryRouter initialEntries={['/reporting/agents/performance']}>
        <PageEyebrowProvider value="Reporting">
          <AgentPerformanceReport />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function seedStore(filters: ReportingFilters, drillDownPath: DrillDownLevel[] = [], activeFilters = {}) {
  useReportingStore.setState({ filters, drillDownPath, activeFilters })
}

const sent = (name: string) => network.filter((request) => request.name === name)
const lastSent = (name: string) => sent(name).at(-1)?.variables

function table(name = 'Agent Performance'): HTMLElement {
  return screen.getByRole('table', { name })
}

function bodyRows(name?: string): HTMLElement[] {
  const body = table(name).querySelector('tbody')
  assert.ok(body)
  return Array.from(body.querySelectorAll(':scope > tr'))
}

function cells(tr: Element): string[] {
  return Array.from(tr.querySelectorAll(':scope > td')).map((cell) => cell.textContent ?? '')
}

function headers(name?: string): string[] {
  return within(table(name)).getAllByRole('columnheader').map((th) => th.textContent ?? '')
}

function footer(name?: string): string[] {
  const row = table(name).querySelector('tfoot tr')
  assert.ok(row, 'Expected a totals row')
  return cells(row)
}

async function loaded(text = 'Kiran', name?: string) {
  await within(await screen.findByRole('table', { name: name ?? 'Agent Performance' })).findByText(text)
}

/** The admin filter for the default state: the store's fields, the period, tenant currency, no domain, the scheme. */
function adminFilter(extra: Variables = {}) {
  return { tenant: 'core', ...ALL_TIME, schemeType: 'COMMISSION', ...extra }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  apollo.queries.length = 0
  guard.calls.length = 0
  guard.allowed = true
  auth.isAgent = false
  auth.agent = undefined
  toasts.error.mockReset()
  toasts.success.mockReset()
  network.length = 0
  handlers = defaultHandlers()
  seedStore({ tenant: 'core', ...ALL_TIME })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AgentPerformanceReport contract', () => {
  test('runs the three legacy documents through the shared hooks, inside the agent-bypassing guard', async () => {
    renderPage()
    await loaded()

    assert.deepStrictEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.agents-performance', actions: ['view'] }],
      bypassForAgents: true,
    })
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Agent Performance Report')
    assert.ok(screen.queryByText('Analyze agent performance, turnover, and earnings across all domains') === null)
    assert.ok(screen.queryByText('Reporting') === null)
    assert.deepStrictEqual(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent), ['Agent Performance'])

    const call = (name: string) => [...apollo.queries].reverse().find((candidate) => candidate.name === name)
    const kpis = call('AgentKPIs')
    const performance = call('AgentPerformance')
    const players = call('AgentPlayerBreakdown')
    assert.ok(kpis && performance && players)
    assert.equal(kpis.document, AGENT_KPIS_QUERY)
    assert.equal(performance.document, AGENT_PERFORMANCE_QUERY)
    assert.equal(players.document, AGENT_PLAYER_BREAKDOWN_QUERY)
    const pageFilter = { tenant: 'core', ...ALL_TIME, currency: undefined, domain: undefined, schemeType: 'COMMISSION' }
    assert.deepStrictEqual(kpis.options, {
      variables: { filter: pageFilter },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
      skip: true,
    })
    assert.deepStrictEqual(performance.options, {
      variables: { filter: pageFilter, limit: 50 },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
      skip: false,
    })
    assert.equal(typeof players.options.onError, 'function')
    assert.deepStrictEqual({ ...players.options, onError: undefined }, {
      variables: { filter: pageFilter },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
      skip: true,
      onError: undefined,
    })

    assert.deepStrictEqual(lastQueryVariables('AgentKPIs'), { filter: adminFilter() })
    assert.deepStrictEqual(lastSent('AgentPerformance'), { filter: adminFilter(), limit: 50 })
    assert.deepStrictEqual(lastQueryVariables('AgentPlayerBreakdown'), { filter: adminFilter() })
    assert.equal(sent('AgentPerformance').length, 1)
    assert.equal(sent('AgentKPIs').length, 0, 'visible totals already supply the KPI cards')
    assert.equal(sent('AgentPlayerBreakdown').length, 0, 'players wait for the player drill-down')
  })

  test('a denied caller starts no query', () => {
    guard.allowed = false
    renderPage()

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(apollo.queries.length, 0)
    assert.equal(network.length, 0)
  })

  test('figures take the totals over the KPIs; the table draws the COMMISSION columns and an aligned totals row', async () => {
    renderPage()
    await loaded()

    const stats = await screen.findByRole('group', { name: 'Agent performance statistics' })
    const figure = (label: string) => within(stats).getByText(label).parentElement?.textContent
    assert.equal(figure('Total Turnover'), 'Total Turnover₹8,000.002 agents')
    assert.equal(figure('Total GGR'), `Total GGR₹1,600.00${(9000).toLocaleString()} bets`)
    assert.equal(figure('Commission'), 'Commission₹120.00Share: ₹50.00')
    assert.equal(figure('Active Agents'), 'Active Agents2500 players')

    assert.deepStrictEqual(headers(), [
      'Agent', 'Total GGR', 'Cut', 'Commission', 'Players', 'Sports Cut', 'Casino Cut', 'Matka Cut', 'Bets',
    ])
    assert.deepStrictEqual(bodyRows().map(cells), [
      ['KiranCOMMISSION', '₹202.00', '₹24.00', '₹22.00', '51', '₹80.0090.0% − 85.0% = 5.0%', '₹24.00', '₹0.00', '901'],
      ['N/A', '₹204.00', '₹26.00', '₹24.00', '52', '₹0.00', '₹0.00', '₹0.00', '902'],
    ])
    assert.deepStrictEqual(footer(), [
      'Total', '₹1,600.00', '₹170.00', '₹120.00', '500', '—', '—', '—', (9000).toLocaleString(),
    ])
    within(screen.getByRole('region', { name: 'Agent Performance' })).getByText('2 agents')
    screen.getByText('Total 2 agents')
    // no row opens anything on this page
    assert.equal(bodyRows()[0].getAttribute('tabindex'), null)
  })
})

describe('AgentPerformanceReport rails and agent branches', () => {
  test.each([
    ['Credit', 'CREDIT'], ['Sharing', 'SHARING'],
  ])('keeps the statistics mounted while Commission switches to %s', async (label, scheme) => {
    renderPage()
    await loaded()
    const stats = screen.getByRole('group', { name: 'Agent performance statistics' })
    const types = screen.getByRole('group', { name: 'Agent type' })
    let release: (reply: FetchResult) => void = () => undefined
    handlers.AgentPerformance = () => new Promise<FetchResult>((resolve) => { release = resolve })

    fireEvent.click(within(types).getByRole('radio', { name: label }))
    await waitFor(() => assert.equal((lastSent('AgentPerformance')?.filter as Variables).schemeType, scheme))
    assert.equal(table().getAttribute('aria-busy'), 'true')
    assert.equal(screen.getByRole('group', { name: 'Agent performance statistics' }), stats,
      'the KPI row must keep its place so the tabs do not jump during the request')
    assert.equal(screen.getByRole('group', { name: 'Agent type' }), types)
    assert.equal(stats.getAttribute('aria-busy'), 'true')
    assert.equal(stats.querySelectorAll('[aria-busy="true"]').length, 4)
    assert.equal(within(stats).queryByText('₹8,000.00'), null,
      'Commission amounts must not appear as figures for the pending scheme')

    await act(async () => { release(data('agentPerformance', {
      agents: [agent(3, { schemeType: scheme })],
      totals: { ...TOTALS, totalTurnover: 123, agentCount: 1 },
    })) })
    await waitFor(() => assert.equal(table().getAttribute('aria-busy'), 'false'))
    assert.equal(screen.getByRole('group', { name: 'Agent performance statistics' }), stats)
    assert.equal(stats.getAttribute('aria-busy'), null)
    within(stats).getByText('₹246.00')
    assert.equal(sent('AgentKPIs').length, 0)
    assert.equal(sent('AgentPlayerBreakdown').length, 0)
  })

  test('the agent type rail re-queries with the scheme, writes the store and redraws the earning columns', async () => {
    renderPage()
    await loaded()

    const types = screen.getByRole('group', { name: 'Agent type' })
    assert.deepStrictEqual(
      within(types).getAllByRole('radio').map((radio) => `${radio.parentElement?.textContent}:${(radio as HTMLInputElement).checked}`),
      ['Commission:true', 'Sharing:false', 'Credit:false'],
    )

    fireEvent.click(within(types).getByRole('radio', { name: 'Credit' }))
    await waitFor(() => assert.deepStrictEqual(lastSent('AgentPerformance'), { filter: adminFilter({ schemeType: 'CREDIT' }), limit: 50 }))
    assert.equal(useReportingStore.getState().filters.schemeType, 'CREDIT')
    await waitFor(() => assert.deepStrictEqual(headers(), [
      'Agent', 'Total GGR', 'Cut', 'Commission', 'Share', 'Players', 'Sports Cut', 'Casino Cut', 'Matka Cut', 'Bets',
    ]))
    await loaded()
    assert.deepStrictEqual(footer().slice(0, 6), ['Total', '₹1,600.00', '₹170.00', '₹120.00', '₹50.00', '500'])

    fireEvent.click(within(types).getByRole('radio', { name: 'Sharing' }))
    await waitFor(() => assert.deepStrictEqual(headers(), [
      'Agent', 'Total GGR', 'Cut', 'Players', 'Sports Cut', 'Casino Cut', 'Matka Cut', 'Bets',
    ]))
  })

  test('rapid Credit then Sharing switches keep the cards in place and ignore the late Credit result', async () => {
    renderPage()
    await loaded()
    const stats = screen.getByRole('group', { name: 'Agent performance statistics' })
    const releases = new Map<string, (reply: FetchResult) => void>()
    handlers.AgentPerformance = (variables) => new Promise<FetchResult>((resolve) => {
      releases.set(String((variables.filter as Variables).schemeType), resolve)
    })
    const types = screen.getByRole('group', { name: 'Agent type' })
    fireEvent.click(within(types).getByRole('radio', { name: 'Credit' }))
    await waitFor(() => assert.ok(releases.has('CREDIT')))
    fireEvent.click(within(types).getByRole('radio', { name: 'Sharing' }))
    await waitFor(() => assert.ok(releases.has('SHARING')))

    await act(async () => { releases.get('CREDIT')?.(data('agentPerformance', {
      agents: [agent(3, { schemeType: 'CREDIT' })], totals: { ...TOTALS, totalTurnover: 9999 },
    })) })
    assert.equal(screen.getByRole('group', { name: 'Agent performance statistics' }), stats)
    assert.equal(stats.getAttribute('aria-busy'), 'true')
    assert.equal(within(stats).queryByText('₹19,998.00'), null)
    assert.equal((within(types).getByRole('radio', { name: 'Sharing' }) as HTMLInputElement).checked, true)

    await act(async () => { releases.get('SHARING')?.(data('agentPerformance', {
      agents: [], totals: Object.fromEntries(Object.keys(TOTALS).map((key) => [key, 0])),
    })) })
    await within(table()).findByText('No data')
    assert.equal(screen.getByRole('group', { name: 'Agent performance statistics' }), stats)
    assert.equal(stats.getAttribute('aria-busy'), null)
    assert.equal(within(stats).getByText('Total Turnover').nextElementSibling?.textContent, '₹0.00')
    assert.equal(sent('AgentKPIs').length, 0)
  })

  test('keeps the same cards through a missing-totals response and its slower KPI fallback', async () => {
    renderPage()
    await loaded()
    const stats = screen.getByRole('group', { name: 'Agent performance statistics' })
    let releasePerformance: (reply: FetchResult) => void = () => undefined
    let releaseKpis: (reply: FetchResult) => void = () => undefined
    handlers.AgentPerformance = () => new Promise<FetchResult>((resolve) => { releasePerformance = resolve })
    handlers.AgentKPIs = () => new Promise<FetchResult>((resolve) => { releaseKpis = resolve })
    fireEvent.click(within(screen.getByRole('group', { name: 'Agent type' })).getByRole('radio', { name: 'Credit' }))
    await waitFor(() => assert.equal(sent('AgentPerformance').length, 2))
    await act(async () => { releasePerformance(data('agentPerformance', { agents: [], totals: null })) })
    await waitFor(() => assert.equal(sent('AgentKPIs').length, 1))
    assert.equal(screen.getByRole('group', { name: 'Agent performance statistics' }), stats)
    assert.equal(stats.getAttribute('aria-busy'), 'true')
    assert.equal(within(stats).queryByText('₹8,000.00'), null)

    await act(async () => { releaseKpis(data('agentKPIs', { ...KPIS, totalTurnover: 234 })) })
    await waitFor(() => assert.equal(stats.getAttribute('aria-busy'), null))
    assert.equal(screen.getByRole('group', { name: 'Agent performance statistics' }), stats)
    within(stats).getByText('₹468.00')
  })

  test('the domain rail re-queries with the domain and writes it to the store', async () => {
    renderPage()
    await loaded()

    const domains = screen.getByRole('group', { name: 'Domain' })
    assert.deepStrictEqual(within(domains).getAllByRole('radio').map((radio) => radio.parentElement?.textContent), [
      'All Domains', 'Sports', 'Casino', 'Matka',
    ])
    fireEvent.click(within(domains).getByRole('radio', { name: 'Casino' }))
    await waitFor(() => assert.deepStrictEqual(lastQueryVariables('AgentKPIs'), { filter: adminFilter({ domain: 'casino' }) }))
    assert.equal(useReportingStore.getState().filters.domain, 'casino')

    fireEvent.click(within(domains).getByRole('radio', { name: 'All Domains' }))
    await waitFor(() => assert.deepStrictEqual(lastQueryVariables('AgentKPIs'), { filter: adminFilter() }))
    assert.equal(useReportingStore.getState().filters.domain, undefined)
  })

  test('the rails start from the stored domain and scheme', async () => {
    seedStore({ tenant: 'core', ...ALL_TIME, domain: 'matka', schemeType: 'CREDIT' })
    renderPage()
    await loaded()

    assert.equal((screen.getByRole('radio', { name: 'Matka' }) as HTMLInputElement).checked, true)
    assert.equal((screen.getByRole('radio', { name: 'Credit' }) as HTMLInputElement).checked, true)
    assert.deepStrictEqual(lastSent('AgentPerformance'), {
      filter: adminFilter({ domain: 'matka', schemeType: 'CREDIT' }),
      limit: 50,
    })
  })

  test('an agent sees their sub-agents, on their own scheme, scoped to their one allowed domain', async () => {
    auth.isAgent = true
    auth.agent = { id: 'ag-9', schemeType: 'SHARING', allowedDomains: ['casino'] }
    renderPage()
    await loaded()

    assert.equal(screen.queryByRole('group', { name: 'Agent type' }), null)
    const domains = screen.getByRole('group', { name: 'Domain' })
    assert.deepStrictEqual(within(domains).getAllByRole('radio').map((radio) => radio.parentElement?.textContent), ['All Domains', 'Casino'])
    const expected = adminFilter({ domain: 'casino', schemeType: 'SHARING', parentAgentId: 'ag-9' })
    await waitFor(() => assert.deepStrictEqual(lastSent('AgentPerformance'), { filter: expected, limit: 50 }))
    assert.deepStrictEqual(lastQueryVariables('AgentKPIs'), { filter: expected })
    assert.deepStrictEqual(lastQueryVariables('AgentPlayerBreakdown'), { filter: expected })
    await waitFor(() => assert.deepStrictEqual(headers(), [
      'Agent', 'Total GGR', 'Cut', 'Players', 'Sports Cut', 'Casino Cut', 'Matka Cut', 'Bets',
    ]))
  })

  test('an agent with several domains keeps All Domains unscoped', async () => {
    auth.isAgent = true
    auth.agent = { id: 'ag-9', schemeType: 'CREDIT', allowedDomains: ['sports', 'matka'] }
    renderPage()
    await loaded()

    assert.deepStrictEqual(
      within(screen.getByRole('group', { name: 'Domain' })).getAllByRole('radio').map((radio) => radio.parentElement?.textContent),
      ['All Domains', 'Sports', 'Matka'],
    )
    await waitFor(() => assert.deepStrictEqual(lastQueryVariables('AgentKPIs'), {
      filter: adminFilter({ schemeType: 'CREDIT', parentAgentId: 'ag-9' }),
    }))
  })
})

describe('AgentPerformanceReport drill path, filters and states', () => {
  test('a path left in the shared store shows the player level, and its crumbs lead back', async () => {
    seedStore({ tenant: 'core', ...ALL_TIME }, [
      { type: 'agent', id: 'ag-1', name: 'Kiran' },
      { type: 'player', id: 41, name: 'riya' },
    ])
    renderPage()
    await loaded('riya', 'Player Performance')

    assert.deepStrictEqual(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent), ['Player Performance'])
    assert.equal(screen.queryByRole('group', { name: 'Agent type' }), null)
    assert.equal(screen.queryByRole('group', { name: 'Domain' }), null)
    assert.deepStrictEqual(lastQueryVariables('AgentPlayerBreakdown'), { filter: adminFilter({ agentId: 'ag-1', playerId: 41 }) })
    assert.deepStrictEqual(headers('Player Performance'), [
      'Player', 'Total Stakes', 'Total Payouts', 'GGR', 'Avg Stake', 'Win Rate', 'Bets',
    ])
    assert.deepStrictEqual(bodyRows('Player Performance').map(cells), [
      ['riyaID: 41', '₹200.00', '₹160.00', '₹40.00', '₹22.00', '60.00%', '9'],
      ['N/AID: 42', '₹180.00', '₹190.00', '₹-10.00', '₹180.00', '10.00%', '1'],
    ])
    assert.equal(table('Player Performance').querySelector('tfoot'), null, 'no totals row at the player level')
    screen.getByText('2 players')
    screen.getByText('Total 2 players')

    const path = screen.getByRole('navigation', { name: 'Drill-down path' })
    assert.equal(within(path).getByText('riya').getAttribute('aria-current'), 'location')
    const kiran = within(path).getByRole('button', { name: 'Kiran' })
    kiran.focus()
    fireEvent.click(kiran)
    await waitFor(() => assert.equal(useReportingStore.getState().drillDownPath.length, 1))
    await loaded('Kiran')
    const current = within(screen.getByRole('navigation', { name: 'Drill-down path' })).getByText('Kiran')
    assert.equal(current.getAttribute('aria-current'), 'location')
    assert.equal(document.activeElement, current, 'focus moves to the new current crumb')
    assert.deepStrictEqual(lastSent('AgentPerformance'), { filter: adminFilter({ agentId: 'ag-1' }), limit: 50 })

    const root = within(screen.getByRole('navigation', { name: 'Drill-down path' })).getByRole('button', { name: 'All Agents' })
    root.focus()
    fireEvent.click(root)
    await waitFor(() => assert.equal(screen.queryByRole('navigation', { name: 'Drill-down path' }), null))
    assert.deepStrictEqual(useReportingStore.getState().drillDownPath, [])
    assert.equal(document.activeElement, table().closest('[tabindex="-1"]'), 'focus moves to the table when the path is gone')
    screen.getByRole('group', { name: 'Agent type' })
  })

  test('search narrows the agents; the period and Clear all go through the shared store', async () => {
    renderPage()
    await loaded()

    const search = screen.getByRole('searchbox', { name: 'Search the agent performance report' })
    assert.equal(search.getAttribute('placeholder'), 'Search by agent name, ID...')
    fireEvent.change(search, { target: { value: 'KIR' } })
    assert.deepStrictEqual(bodyRows().map((tr) => cells(tr)[0]), ['KiranCOMMISSION'])
    screen.getByText('1 agent')
    fireEvent.change(search, { target: { value: 'ag-2' } })
    assert.deepStrictEqual(bodyRows().map((tr) => cells(tr)[0]), ['N/A'])

    fireEvent.click(screen.getByRole('button', { name: 'Apply Yesterday' }))
    await waitFor(() => assert.deepStrictEqual(lastQueryVariables('AgentKPIs'), {
      filter: adminFilter({ dateFrom: '2026-10-06', dateTo: '2026-10-06' }),
    }))
    screen.getByText('2 filters applied')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal((search as HTMLInputElement).value, '')
    assert.equal(screen.getByTestId('period-state').textContent, `allTime|${ALL_TIME.dateFrom}|${ALL_TIME.dateTo}`)
    await waitFor(() => assert.deepStrictEqual(lastQueryVariables('AgentKPIs'), { filter: adminFilter() }))
  })

  test('active filter chips reach the queries as they are; a chip removes its filter', async () => {
    seedStore({ tenant: 'core', ...ALL_TIME }, [], { campaignId: { value: 'c-1', label: 'Campaign' } })
    renderPage()
    await loaded()

    assert.deepStrictEqual(lastQueryVariables('AgentPlayerBreakdown'), { filter: adminFilter({ campaignId: 'c-1' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Campaign: c-1' }))
    await waitFor(() => assert.deepStrictEqual(lastQueryVariables('AgentPlayerBreakdown'), { filter: adminFilter() }))
  })

  test('sorting orders the page by the cut, and paging keeps the legacy sizes and total', async () => {
    handlers.AgentPerformance = () => data('agentPerformance', {
      agents: Array.from({ length: 23 }, (_, index) => agent(index + 1, { commissionEarned: 100 - index, shareEarned: 0 })),
      totals: TOTALS,
    })
    renderPage()
    await loaded('Agent 01')

    assert.equal(bodyRows().length, 20)
    screen.getByText('Total 23 agents')
    fireEvent.click(within(table()).getByRole('button', { name: 'Cut' }))
    assert.equal(cells(bodyRows()[0])[0], 'Agent 20COMMISSION')
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    assert.deepStrictEqual(bodyRows().map((tr) => cells(tr)[0]), ['Agent 23COMMISSION', 'Agent 22COMMISSION', 'Agent 21COMMISSION'])
    const sizes = within(screen.getByRole('combobox', { name: /Rows per page/ })).getAllByRole('option').map((option) => option.textContent)
    assert.deepStrictEqual(sizes, ['10', '20', '50', '100'])
  })

  test('Refresh asks again for the figures and the agents, not the players', async () => {
    renderPage()
    await loaded()
    const before = sent('AgentPlayerBreakdown').length

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    assert.equal(sent('AgentKPIs').length, 0)
    await waitFor(() => assert.equal(sent('AgentPerformance').length, 2))
    assert.equal(sent('AgentPlayerBreakdown').length, before)
  })

  test('loading, then no agents and no totals row', async () => {
    let release: (reply: FetchResult) => void = () => undefined
    handlers.AgentPerformance = () => new Promise<FetchResult>((resolve) => {
      release = resolve
    })
    handlers.AgentKPIs = () => new Promise<FetchResult>(() => undefined)
    renderPage()

    await screen.findByText('Loading Agent Performance')
    assert.equal(table().getAttribute('aria-busy'), 'true')
    const stats = screen.getByRole('group', { name: 'Agent performance statistics' })
    assert.equal(stats.getAttribute('aria-busy'), 'true')

    await act(async () => {
      release(data('agentPerformance', { agents: [], totals: null }))
    })
    await within(table()).findByText('No data')
    assert.equal(table().querySelector('tfoot'), null)
    assert.deepStrictEqual(headers(), ['Agent', 'Total GGR', 'Cut', 'Commission', 'Players', 'Bets'])
    screen.getByText('0 agents')
  })

  test('a failed agent query shows its error with Retry', async () => {
    let fail = true
    handlers.AgentPerformance = () => (fail ? new Error('Agent service unavailable') : data('agentPerformance', { agents: AGENTS, totals: TOTALS }))
    renderPage()

    await within(await screen.findByRole('table', { name: 'Agent Performance' })).findByText('Agent service unavailable')
    fail = false
    fireEvent.click(within(table()).getByRole('button', { name: 'Retry' }))
    await loaded()
  })

  test('a failed player breakdown keeps the hook toast', async () => {
    seedStore({ tenant: 'core', ...ALL_TIME }, [{ type: 'player', id: 41, name: 'riya' }])
    handlers.AgentPlayerBreakdown = () => new Error('Players unavailable')
    renderPage()

    await within(await screen.findByRole('table', { name: 'Player Performance' })).findByText('Players unavailable')
    await waitFor(() => assert.ok(toasts.error.mock.calls.some(([message, title]) =>
      message === 'Players unavailable' && title === 'Failed to load player breakdown')))
  })
})

test('empty report totals fetch the fallback KPIs only after the main report completes', async () => {
  let release: (reply: FetchResult) => void = () => undefined;
  handlers.AgentPerformance = () => new Promise<FetchResult>(resolve => { release = resolve; });
  renderPage(); await screen.findByText('Loading Agent Performance');
  assert.equal(sent('AgentKPIs').length, 0); assert.equal(sent('AgentPlayerBreakdown').length, 0);
  await act(async () => { release(data('agentPerformance', { agents: [], totals: null })); });
  await waitFor(() => assert.equal(screen.getByRole('group', { name: 'Agent performance statistics' }).getAttribute('aria-busy'), null));
  assert.equal(sent('AgentKPIs').length, 1); assert.equal(sent('AgentPlayerBreakdown').length, 0);
});

test('player drill-down and Refresh request players/KPIs and defer the agent table', async () => {
  seedStore({ tenant: 'core', ...ALL_TIME }, [{ type: 'player', id: 41, name: 'riya' }]);
  renderPage(); await loaded('riya', 'Player Performance');
  assert.equal(sent('AgentPerformance').length, 0); assert.equal(sent('AgentPlayerBreakdown').length, 1); assert.equal(sent('AgentKPIs').length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => assert.equal(sent('AgentPlayerBreakdown').length, 2));
  assert.equal(sent('AgentKPIs').length, 2); assert.equal(sent('AgentPerformance').length, 0);
});
