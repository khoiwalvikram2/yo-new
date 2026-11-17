/**
 * /reporting/matka against a mocked GraphQL server (MockedProvider with a link that answers each
 * operation by name and records what was sent, + MemoryRouter). The real page, the shared reporting
 * hooks and store, the kit and the drill-down pieces render; useQuery is wrapped, not replaced, so
 * every option the hooks pass is recorded. The period control has its own suite
 * (modules/reporting/ui/ReportingPeriodFilter.test.tsx) and is a deterministic stand-in here. The
 * clock is fixed at 2026-10-07 11:30 IST.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloLink, Observable, type FetchResult } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import {
  MATKA_AGENT_BREAKDOWN_QUERY,
  MATKA_KPIS_QUERY,
  MATKA_MARKET_BREAKDOWN_QUERY,
  MATKA_PLAYER_BREAKDOWN_QUERY,
  MATKA_SESSION_BREAKDOWN_QUERY,
  MATKA_TYPE_BREAKDOWN_QUERY,
} from '@/modules/reporting/graphql'
import type { ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useReportingStore, type DrillDownLevel, type ReportingFilters } from '@/state/reportingStore'
import MatkaRiskReport from './MatkaRiskReport'

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

type Variables = Record<string, unknown>
type Reply = FetchResult | Error | Promise<FetchResult | Error>

const apollo = vi.hoisted(() => ({ queries: [] as HookCall[] }))

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
      <button type="button" onClick={() => onChange('2026-10-07', '2026-10-07', 'today')}>Apply Today</button>
      <button type="button" onClick={() => onChange('2026-10-01', '2026-10-03', 'custom')}>Apply Custom Range</button>
    </div>
  ),
}))

const NOW = new Date('2026-10-07T06:00:00.000Z')
const ALL_TIME = { dateFrom: '2000-01-01', dateTo: '2026-10-07' }

const KPIS = {
  totalStakes: 1864200,
  totalPayouts: 1592600,
  totalExposure: 0,
  grossGamingRevenue: 271600,
  netRevenue: 0,
  holdPercentage: 0.1457,
  betCount: 88420,
  playerCount: 4000,
  activePlayerCount: 1250,
}

function typeRow(matkaType: string | null, stakes: number, ggr: number, bets = 10) {
  return { matkaType, totalStakes: stakes, totalPayouts: 0, grossGamingRevenue: ggr, betCount: bets, playerCount: 1, marketCount: 3 }
}

const TYPES = [typeRow('Kalyan', 1864200, 271600, 88420), typeRow('Milan', 894700, -67600, 42180)]

const MARKETS = [
  { matkaId: 12, marketName: 'Kalyan Day', matkaType: 'Kalyan', totalStakes: 500, totalPayouts: 0, grossGamingRevenue: 50, betCount: 4, playerCount: 2, sessionCount: 2 },
]
const SESSIONS = [
  { marketSession: 'OPEN', matkaId: 12, marketName: 'Kalyan Day', totalStakes: 300, totalPayouts: 0, grossGamingRevenue: 30, betCount: 3, playerCount: 2 },
]
const AGENTS = [
  { agentId: 'ag-1', agentName: 'Kiran', totalStakes: 200, totalPayouts: 0, grossGamingRevenue: 20, betCount: 2, playerCount: 1, commission: 7 },
]
const PLAYERS = [
  { playerId: 41, playerUsername: 'riya', playerPhone: null, directAgentId: null, directAgentName: null, totalStakes: 100, totalPayouts: 0, grossGamingRevenue: -10, betCount: 9, avgStake: 11, winRate: 0.4567 },
  { playerId: 42, playerUsername: null, playerPhone: null, directAgentId: null, directAgentName: null, totalStakes: 90, totalPayouts: 0, grossGamingRevenue: 5, betCount: 1, avgStake: 90, winRate: 0.75 },
]

/* ------------------------------ the server ------------------------------ */

const network: Array<{ name: string; variables: Variables }> = []
let handlers: Record<string, (variables: Variables) => Reply> = {}

function data(field: string, value: unknown): FetchResult {
  return { data: { [field]: value } }
}

function defaultHandlers(): Record<string, (variables: Variables) => Reply> {
  return {
    MatkaKPIs: () => data('matkaKPIs', KPIS),
    MatkaTypeBreakdown: (variables) => {
      const filter = variables.filter as { matkaType?: string }
      return data('matkaTypeBreakdown', filter.matkaType ? TYPES.filter((row) => row.matkaType === filter.matkaType) : TYPES)
    },
    MatkaMarketBreakdown: () => data('matkaMarketBreakdown', MARKETS),
    MatkaSessionBreakdown: () => data('matkaSessionBreakdown', SESSIONS),
    MatkaAgentBreakdown: () => data('matkaAgentBreakdown', AGENTS),
    MatkaPlayerBreakdown: () => data('matkaPlayerBreakdown', PLAYERS),
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

function renderPage() {
  return render(
    <MockedProvider link={serverLink} addTypename={false}>
      <MemoryRouter initialEntries={['/reporting/matka']}>
        <PageEyebrowProvider value="Reporting">
          <MatkaRiskReport />
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

function table(): HTMLElement {
  return screen.getByRole('table', { name: 'Matka breakdown' })
}

function bodyRows(): HTMLElement[] {
  return within(table()).getAllByRole('row').slice(1)
}

function cells(tr: HTMLElement): string[] {
  return Array.from(tr.querySelectorAll('td')).map((cell) => cell.textContent ?? '')
}

function headers(): string[] {
  return within(table()).getAllByRole('columnheader').map((th) => th.textContent ?? '')
}

async function loaded(text = 'Kalyan') {
  await within(await screen.findByRole('table', { name: 'Matka breakdown' })).findByText(text)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  apollo.queries.length = 0
  guard.calls.length = 0
  guard.allowed = true
  toasts.error.mockReset()
  toasts.success.mockReset()
  network.length = 0
  handlers = defaultHandlers()
  seedStore({ tenant: 'core', ...ALL_TIME, schemeType: 'COMMISSION' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MatkaRiskReport contract', () => {
  test('runs the six legacy documents through the shared hooks, inside the agent-bypassing guard', async () => {
    renderPage()
    await loaded()

    assert.deepStrictEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.matka', actions: ['view'] }],
      bypassForAgents: true,
    })
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Matka Risk Report')
    assert.ok(screen.queryByText('Analyze matka betting performance and risk exposure across all markets') === null)
    assert.ok(screen.queryByText('Reporting') === null)
    assert.deepStrictEqual(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
      ['Matka Risk Report'],
    )

    const documents = [
      ['MatkaKPIs', MATKA_KPIS_QUERY, undefined],
      ['MatkaTypeBreakdown', MATKA_TYPE_BREAKDOWN_QUERY, 'Failed to load matka type breakdown'],
      ['MatkaMarketBreakdown', MATKA_MARKET_BREAKDOWN_QUERY, 'Failed to load market breakdown'],
      ['MatkaSessionBreakdown', MATKA_SESSION_BREAKDOWN_QUERY, 'Failed to load session breakdown'],
      ['MatkaAgentBreakdown', MATKA_AGENT_BREAKDOWN_QUERY, 'Failed to load agent breakdown'],
      ['MatkaPlayerBreakdown', MATKA_PLAYER_BREAKDOWN_QUERY, 'Failed to load player breakdown'],
    ] as const
    // every hook runs on every render, in the legacy order, whatever the level
    assert.deepStrictEqual(
      apollo.queries.slice(0, 6).map((call) => call.name),
      documents.map(([name]) => name),
    )
    // only the MatkaDrillDownFilter fields go out: the store's schemeType is dropped, its tenant kept
    const expected = { filter: { tenant: 'core', ...ALL_TIME } }
    for (const [name, document, failure] of documents) {
      const call = [...apollo.queries].reverse().find((candidate) => candidate.name === name)
      assert.ok(call, name)
      assert.equal(call.document, document)
      assert.deepStrictEqual(call.options.variables, expected, name)
      assert.equal(call.options.errorPolicy, 'all')
      assert.equal(call.options.fetchPolicy, 'network-only')
      assert.equal(typeof call.options.onError, failure ? 'function' : 'undefined')
      assert.deepStrictEqual(lastSent(name), expected, name)
      assert.equal(sent(name).length, 1, `${name} is sent once`)
    }
  })

  test('a denied caller starts no query', () => {
    guard.allowed = false
    renderPage()

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(apollo.queries.length, 0)
    assert.equal(network.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })

  test('shows the legacy figures and the matka-type rows with converted amounts and signed GGR', async () => {
    renderPage()
    await loaded()

    const stats = await screen.findByRole('group', { name: 'Matka statistics' })
    const figure = (label: string) => within(stats).getByText(label).parentElement?.textContent
    assert.equal(figure('Total GGR'), 'Total GGR₹5,43,200.00Hold: 14.57%')
    assert.equal(figure('Total Stakes'), 'Total Stakes₹37,28,400.00Payouts: ₹31,85,200.00')
    assert.equal(figure('Total Bets'), `Total Bets${(88420).toLocaleString()}Avg: 22.1/player`)
    assert.equal(figure('Active Players'), 'Active Players12504000 total')

    assert.deepStrictEqual(headers(), ['Matka Type', 'Total Stakes', 'GGR', 'Bets', 'Markets'])
    assert.deepStrictEqual(bodyRows().map(cells), [
      ['Kalyan', '₹37,28,400.00', '₹5,43,200.00', (88420).toLocaleString(), '3'],
      ['Milan', '₹17,89,400.00', '₹-1,35,200.00', (42180).toLocaleString(), '3'],
    ])
    const ggr = (index: number) => bodyRows()[index].querySelectorAll('td')[2].firstElementChild
    assert.notEqual(ggr(0)?.className, ggr(1)?.className, 'a gain and a loss read differently')
    screen.getByText('Total 2 items')
    assert.equal(screen.queryByRole('navigation', { name: 'Drill-down path' }), null)
  })

  test('on arrival the period becomes All time in the shared store, and the queries follow it', async () => {
    seedStore({ tenant: 'core', dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    renderPage()
    await loaded()

    await waitFor(() => assert.deepStrictEqual(lastSent('MatkaTypeBreakdown'), { filter: { tenant: 'core', ...ALL_TIME } }))
    assert.deepStrictEqual(
      { dateFrom: useReportingStore.getState().filters.dateFrom, dateTo: useReportingStore.getState().filters.dateTo },
      ALL_TIME,
    )
    assert.equal(screen.getByTestId('period-state').textContent, `allTime|${ALL_TIME.dateFrom}|${ALL_TIME.dateTo}`)
  })

  test('a drill-down path left by another report is dropped on arrival; a matka path is kept', async () => {
    seedStore({ ...ALL_TIME }, [{ type: 'sport', id: 4, name: 'Cricket' }])
    const first = renderPage()
    await loaded()
    await waitFor(() => assert.deepStrictEqual(useReportingStore.getState().drillDownPath, []))
    assert.equal(screen.queryByRole('navigation', { name: 'Drill-down path' }), null)
    first.unmount()

    seedStore({ ...ALL_TIME }, [{ type: 'matkaType', id: 'Kalyan', name: 'Kalyan' }])
    renderPage()
    await screen.findByRole('navigation', { name: 'Drill-down path' })
    assert.deepStrictEqual(useReportingStore.getState().drillDownPath, [{ type: 'matkaType', id: 'Kalyan', name: 'Kalyan' }])
    await waitFor(() => assert.deepStrictEqual(lastSent('MatkaTypeBreakdown'), { filter: { ...ALL_TIME, matkaType: 'Kalyan' } }))
  })
})

describe('MatkaRiskReport drill-down', () => {
  test('a click on a matka-type row opens its markets, and the drill-down goes on; the breadcrumbs lead back (F-REP-01)', async () => {
    renderPage()
    await loaded()

    fireEvent.click(within(bodyRows()[0]).getByText('₹37,28,400.00'))

    const path = await screen.findByRole('navigation', { name: 'Drill-down path' })
    assert.deepStrictEqual(useReportingStore.getState().drillDownPath, [{ type: 'matkaType', id: 'Kalyan', name: 'Kalyan' }])
    assert.equal(within(path).getByText('Kalyan').closest('[aria-current="location"]') !== null, true)
    // The cards follow the level: the KPIs are asked for the type (the server's filter now takes it).
    await waitFor(() => assert.deepStrictEqual(lastSent('MatkaKPIs'), { filter: { tenant: 'core', ...ALL_TIME, matkaType: 'Kalyan' } }))
    // The type's markets, not the clicked type row again.
    await loaded('Kalyan Day')
    assert.deepStrictEqual(headers(), ['Market', 'Total Stakes', 'GGR', 'Sessions'])
    assert.deepStrictEqual(lastSent('MatkaMarketBreakdown'), { filter: { tenant: 'core', ...ALL_TIME, matkaType: 'Kalyan' } })
    assert.equal(screen.getByRole('searchbox', { name: 'Search the matka report' }).getAttribute('placeholder'), 'Search by market name...')

    // a market row carries its id, so the drill-down continues to the market's sessions
    assert.equal(bodyRows()[0].getAttribute('tabindex'), '0')
    fireEvent.click(within(bodyRows()[0]).getByText('₹1,000.00'))
    await waitFor(() => assert.deepStrictEqual(useReportingStore.getState().drillDownPath.map((level) => level.type), ['matkaType', 'market']))
    await loaded('OPEN')
    assert.deepStrictEqual(headers(), ['Session', 'Total Stakes', 'GGR', 'Bets'])

    fireEvent.click(within(path).getByRole('button', { name: 'All Matka' }))
    await waitFor(() => assert.deepStrictEqual(useReportingStore.getState().drillDownPath, []))
    await waitFor(() => assert.deepStrictEqual(bodyRows().map((tr) => cells(tr)[0]), ['Kalyan', 'Milan']))
  })

  test('a focused row opens with Enter, once', async () => {
    renderPage()
    await loaded()

    const second = bodyRows()[1]
    assert.equal(second.getAttribute('tabindex'), '0')
    second.focus()
    fireEvent.keyDown(second, { key: 'Enter' })
    await waitFor(() => assert.deepStrictEqual(useReportingStore.getState().drillDownPath, [{ type: 'matkaType', id: 'Milan', name: 'Milan' }]))
  })

  test('opening a row from a later page shows the new level from its first page', async () => {
    handlers.MatkaTypeBreakdown = (variables) => {
      const filter = variables.filter as { matkaType?: string }
      const many = Array.from({ length: 25 }, (_, index) => typeRow(`Type ${String(index + 1).padStart(2, '0')}`, 100 + index, index))
      return data('matkaTypeBreakdown', filter.matkaType ? many.filter((row) => row.matkaType === filter.matkaType) : many)
    }
    handlers.MatkaMarketBreakdown = (variables) => {
      const filter = variables.filter as { matkaType?: string }
      return data('matkaMarketBreakdown', [{ ...MARKETS[0], marketName: `${filter.matkaType} Market`, matkaType: filter.matkaType }])
    }
    renderPage()
    await loaded('Type 01')

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(bodyRows().length, 5))
    fireEvent.click(within(bodyRows()[0]).getByText('Type 21'))

    await loaded('Type 21 Market')
    assert.equal(bodyRows().length, 1)
    screen.getByText('Total 1 items')
  })

  test('deeper levels draw their own columns: the player level shows win-rate pills and ID lines', async () => {
    seedStore({ ...ALL_TIME }, [
      { type: 'matkaType', id: 'Kalyan', name: 'Kalyan' },
      { type: 'market', id: 12, name: 'Kalyan Day' },
      { type: 'session', id: 'OPEN', name: 'OPEN' },
      { type: 'agent', id: 'ag-1', name: 'Kiran' },
      { type: 'player', id: 41, name: 'riya' },
    ])
    renderPage()
    await loaded('riya')

    assert.deepStrictEqual(headers(), ['Player', 'Total Stakes', 'Avg Stake', 'Win Rate', 'Bets'])
    assert.deepStrictEqual(bodyRows().map(cells), [
      ['riyaID: 41', '₹200.00', '₹22.00', '45.67%', '9'],
      ['N/AID: 42', '₹180.00', '₹180.00', '75.00%', '1'],
    ])
    assert.deepStrictEqual(lastSent('MatkaPlayerBreakdown'), {
      filter: { ...ALL_TIME, matkaType: 'Kalyan', matkaId: 12, marketSession: 'OPEN', agentId: 'ag-1', playerId: 41 },
    })
    assert.equal(screen.getByRole('searchbox', { name: 'Search the matka report' }).getAttribute('placeholder'), 'Search by username, ID...')
    // a player row opens nothing
    assert.equal(bodyRows()[0].getAttribute('tabindex'), null)

    // the breadcrumb for the market level pops the levels below it and shows the market's sessions
    const path = screen.getByRole('navigation', { name: 'Drill-down path' })
    fireEvent.click(within(path).getByRole('button', { name: 'Kalyan Day' }))
    await waitFor(() => assert.equal(useReportingStore.getState().drillDownPath.length, 2))
    await loaded('OPEN')
    assert.deepStrictEqual(headers(), ['Session', 'Total Stakes', 'GGR', 'Bets'])
    assert.deepStrictEqual(lastSent('MatkaSessionBreakdown'), { filter: { ...ALL_TIME, matkaType: 'Kalyan', matkaId: 12 } })
  })
})

describe('MatkaRiskReport filters, table and states', () => {
  test('search narrows the rows; Clear all resets the search and the period to All time', async () => {
    renderPage()
    await loaded()

    const search = screen.getByRole('searchbox', { name: 'Search the matka report' })
    assert.equal(search.getAttribute('placeholder'), 'Search by matka type...')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
    screen.getByText('0 filters applied')

    fireEvent.change(search, { target: { value: 'MIL' } })
    assert.deepStrictEqual(bodyRows().map((tr) => cells(tr)[0]), ['Milan'])
    screen.getByText('1 filter applied')

    fireEvent.click(screen.getByRole('button', { name: 'Apply Today' }))
    await waitFor(() => assert.deepStrictEqual(lastSent('MatkaTypeBreakdown'), {
      filter: { tenant: 'core', dateFrom: '2026-10-07', dateTo: '2026-10-07' },
    }))
    assert.equal(screen.getByTestId('period-state').textContent, 'today|2026-10-07|2026-10-07')
    screen.getByText('2 filters applied')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal((search as HTMLInputElement).value, '')
    assert.equal(screen.getByTestId('period-state').textContent, `allTime|${ALL_TIME.dateFrom}|${ALL_TIME.dateTo}`)
    await waitFor(() => assert.deepStrictEqual(lastSent('MatkaTypeBreakdown'), { filter: { tenant: 'core', ...ALL_TIME } }))
    screen.getByText('0 filters applied')
  })

  test('a custom period goes to the shared store and every query', async () => {
    renderPage()
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Apply Custom Range' }))
    const expected = { filter: { tenant: 'core', dateFrom: '2026-10-01', dateTo: '2026-10-03' } }
    for (const name of ['MatkaKPIs', 'MatkaTypeBreakdown', 'MatkaMarketBreakdown', 'MatkaSessionBreakdown', 'MatkaAgentBreakdown', 'MatkaPlayerBreakdown']) {
      await waitFor(() => assert.deepStrictEqual(lastSent(name), expected, name))
    }
    assert.equal(useReportingStore.getState().filters.dateFrom, '2026-10-01')
    assert.equal(useReportingStore.getState().filters.dateTo, '2026-10-03')
  })

  test('active filter chips: allowed keys reach the queries, a chip removes its filter', async () => {
    seedStore({ ...ALL_TIME }, [], {
      whitelabelId: { value: 'wl-7', label: 'Whitelabel' },
      campaignId: { value: 'c-1', label: 'Campaign' },
    })
    renderPage()
    await loaded()

    assert.deepStrictEqual(lastSent('MatkaTypeBreakdown'), { filter: { ...ALL_TIME, whitelabelId: 'wl-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Whitelabel: wl-7' }))
    await waitFor(() => assert.deepStrictEqual(Object.keys(useReportingStore.getState().activeFilters), ['campaignId']))
    await waitFor(() => assert.deepStrictEqual(lastSent('MatkaTypeBreakdown'), { filter: { ...ALL_TIME } }))
  })

  test('sorting orders the page and paging follows the legacy sizes and total', async () => {
    handlers.MatkaTypeBreakdown = () => data(
      'matkaTypeBreakdown',
      Array.from({ length: 25 }, (_, index) => typeRow(`Type ${String(index + 1).padStart(2, '0')}`, 1000 - index, index % 2 ? index : -index)),
    )
    renderPage()
    await loaded('Type 01')

    assert.equal(bodyRows().length, 20)
    screen.getByText('Total 25 items')
    const sizes = within(screen.getByRole('combobox', { name: /Rows per page/ })).getAllByRole('option').map((option) => option.textContent)
    assert.deepStrictEqual(sizes, ['10', '20', '50', '100'])

    fireEvent.click(within(table()).getByRole('button', { name: 'Total Stakes' }))
    assert.equal(cells(bodyRows()[0])[0], 'Type 20', 'ascending orders the 20 rows of the page only')
    fireEvent.click(within(table()).getByRole('button', { name: 'Total Stakes' }))
    assert.equal(cells(bodyRows()[0])[0], 'Type 01')

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    assert.deepStrictEqual(bodyRows().map((tr) => cells(tr)[0]), ['Type 21', 'Type 22', 'Type 23', 'Type 24', 'Type 25'])

    fireEvent.change(screen.getByRole('combobox', { name: /Rows per page/ }), { target: { value: '10' } })
    assert.equal(bodyRows().length, 10)
    assert.equal(screen.getByRole('button', { current: 'page' }).textContent, '1')
  })

  test('Refresh asks the server again for the figures and the level shown', async () => {
    renderPage()
    await loaded()
    await screen.findByRole('group', { name: 'Matka statistics' })
    const before = { kpis: sent('MatkaKPIs').length, type: sent('MatkaTypeBreakdown').length, market: sent('MatkaMarketBreakdown').length }

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(sent('MatkaKPIs').length, before.kpis + 1))
    await waitFor(() => assert.equal(sent('MatkaTypeBreakdown').length, before.type + 1))
    assert.equal(sent('MatkaMarketBreakdown').length, before.market)
  })

  test('loading, then an empty level', async () => {
    let release: (reply: FetchResult) => void = () => undefined
    handlers.MatkaTypeBreakdown = () => new Promise<FetchResult>((resolve) => {
      release = resolve
    })
    handlers.MatkaKPIs = () => new Promise<FetchResult>(() => undefined)
    renderPage()

    await screen.findByText('Loading Matka breakdown')
    assert.equal(table().getAttribute('aria-busy'), 'true')
    assert.equal(screen.queryByRole('group', { name: 'Matka statistics' }), null, 'no figures before the KPIs arrive')

    await act(async () => {
      release(data('matkaTypeBreakdown', []))
    })
    await within(table()).findByText('No data')
    screen.getByText('Total 0 items')
  })

  test('a failed breakdown shows its error with Retry, and the hook still raises its toast', async () => {
    let fail = true
    handlers.MatkaTypeBreakdown = () => (fail ? new Error('Matka service unavailable') : data('matkaTypeBreakdown', TYPES))
    renderPage()

    await within(await screen.findByRole('table', { name: 'Matka breakdown' })).findByText('Matka service unavailable')
    await waitFor(() => assert.ok(toasts.error.mock.calls.some(([message, title]) =>
      message === 'Matka service unavailable' && title === 'Failed to load matka type breakdown')))

    fail = false
    fireEvent.click(within(table()).getByRole('button', { name: 'Retry' }))
    await loaded()
  })
})
