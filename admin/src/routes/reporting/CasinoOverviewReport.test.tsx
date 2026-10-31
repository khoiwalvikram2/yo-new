/**
 * /reporting/casino against MockedProvider + MemoryRouter. The real page, its data hooks
 * (modules/reporting/hooks), the drill-down pieces (modules/reporting/ui) and the kit render. useQuery
 * is wrapped, not replaced, so every option the page passes is recorded while the real Apollo hook runs;
 * the network is a link inside MockedProvider that answers each operation by name and records the
 * variables it was sent. The shared reporting store is a real zustand store without persistence. The
 * clock is fixed at 2026-10-07 11:30 IST. recharts' ResponsiveContainer measures nothing in jsdom, so it
 * is replaced by a fixed 800px box; the charts inside are real, which lets the legend test compare each
 * swatch with the line it names.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloLink, Observable, type FetchResult } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import {
  CASINO_GAME_BREAKDOWN_QUERY,
  CASINO_KPIS_QUERY,
  CASINO_TRENDS_QUERY,
  CASINO_VENDOR_BREAKDOWN_QUERY,
} from '@/modules/reporting/graphql'
import charts from '@/modules/reporting/ui/reportCharts.module.css'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useReportingStore } from '@/state/reportingStore'
import pager from '@/ui/components/Pagination.module.css'
import pill from '@/ui/components/StatusPill.module.css'
import CasinoOverviewReport from './CasinoOverviewReport'
import styles from './CasinoOverviewReport.module.css'

interface HookCall {
  name: string
  document: unknown
  options: Record<string, unknown>
}

type Responder = (variables: Record<string, unknown>) => FetchResult | Error | 'pending'

const apollo = vi.hoisted(() => ({ queries: [] as HookCall[] }))
const guard = vi.hoisted(() => ({ allowed: true, calls: [] as unknown[] }))
const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

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

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    bypassForAgents,
    children,
  }: { required: unknown; bypassForAgents?: boolean; children: ReactNode }) => {
    guard.calls.push({ required, bypassForAgents })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount * 2,
    formatAmount: (amount: number) =>
      `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  }),
}))

vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }))
vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDate: (value: string, pattern: string) => `${pattern}:${value}`,
    formatDateTime: (value: string, pattern: string) => `${pattern}|${value}`,
  }),
}))

vi.mock('@/shared/services/notification', () => ({
  notify: { error: feedback.error, success: feedback.success },
}))

vi.mock('@/state/reportingStore', async () => {
  const { create } = await import('zustand')
  interface Level {
    type: string
    id?: string | number
    name: string
  }
  interface State {
    filters: Record<string, unknown>
    setFilters: (next: Record<string, unknown>) => void
    drillDownPath: Level[]
    pushDrillDownLevel: (level: Level) => void
    popDrillDownLevel: () => void
    resetDrillDownPath: () => void
    activeFilters: Record<string, { value: string | number; label: string }>
    removeFilter: (key: string) => void
    clearAllFilters: () => void
  }
  const useReportingStore = create<State>()((set) => ({
    filters: {},
    setFilters: (next) => set((state) => ({ filters: { ...state.filters, ...next } })),
    drillDownPath: [],
    pushDrillDownLevel: (level) => set((state) => ({ drillDownPath: [...state.drillDownPath, level] })),
    popDrillDownLevel: () => set((state) => ({ drillDownPath: state.drillDownPath.slice(0, -1) })),
    resetDrillDownPath: () => set({ drillDownPath: [] }),
    activeFilters: {},
    removeFilter: (key) =>
      set((state) => {
        const next = { ...state.activeFilters }
        delete next[key]
        return { activeFilters: next }
      }),
    clearAllFilters: () => set({ activeFilters: {} }),
  }))
  return { useReportingStore }
})

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  const { cloneElement, isValidElement } = await import('react')
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }: { children: ReactNode; height?: number | string }) => (
      <div className="recharts-responsive-container">
        {isValidElement(children)
          ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, {
              width: 800,
              height: typeof height === 'number' ? height : 300,
            })
          : children}
      </div>
    ),
  }
})

/* ------------------------------------------------------------------ data */

const KPIS = {
  totalStakes: 5984300,
  totalPayouts: 4523000,
  grossGamingRevenue: 1461300,
  netRevenue: 1400000,
  holdPercentage: 0.2442,
  betCount: 630820,
  playerCount: 2100,
  activePlayerCount: 1834,
}

/* Constant series, stakes above payouts above GGR, so each line's height says which series it is. */
const TRENDS = [
  { date: '2026-10-05', stakes: 150, payouts: 100, ggr: 50, betCount: 9, playerCount: 3 },
  { date: '2026-10-06', stakes: 150, payouts: 100, ggr: 50, betCount: 8, playerCount: 3 },
  { date: '2026-10-07', stakes: 150, payouts: 100, ggr: 50, betCount: 7, playerCount: 2 },
]

const vendorRow = (overrides: Record<string, unknown>) => ({
  vendorId: null,
  vendorName: null,
  providerId: null,
  totalStakes: 0,
  totalPayouts: 0,
  grossGamingRevenue: 0,
  betCount: 0,
  playerCount: 0,
  gameCount: 0,
  ...overrides,
})

const VENDORS = [
  vendorRow({ vendorId: 'v1', vendorName: 'Evolution', providerId: 'p1', totalStakes: 3421000, totalPayouts: 2608600, grossGamingRevenue: 812400, betCount: 342180, playerCount: 1200, gameCount: 48 }),
  vendorRow({ vendorId: 'v2', vendorName: 'Ezugi', providerId: 'p1', totalStakes: 2563300, totalPayouts: 1914400, grossGamingRevenue: -64890, betCount: 288640, playerCount: 900, gameCount: 31 }),
  vendorRow({ totalStakes: 100, totalPayouts: null, grossGamingRevenue: 0, betCount: null, playerCount: null, gameCount: null }),
]

const gameRow = (overrides: Record<string, unknown>) => ({
  gameId: null,
  gameName: null,
  vendorId: 'v1',
  vendorName: 'Evolution',
  totalStakes: 0,
  totalPayouts: 0,
  grossGamingRevenue: 0,
  betCount: 0,
  playerCount: 0,
  rtp: null,
  ...overrides,
})

const GAMES = [
  gameRow({ gameId: 'g1', gameName: 'Lightning Roulette', totalStakes: 1000, totalPayouts: 960, grossGamingRevenue: 40, betCount: 50, playerCount: 10, rtp: 0.962 }),
  gameRow({ gameId: 'g2', gameName: 'Crazy Time', totalStakes: 3000, totalPayouts: 2775, grossGamingRevenue: 225, betCount: 70, playerCount: 12, rtp: 92.5 }),
  gameRow({ gameId: 'g3', gameName: 'Monopoly Live', totalStakes: 2000, totalPayouts: 1760, grossGamingRevenue: 240, betCount: 30, playerCount: 8, rtp: 88 }),
]

const PLAYERS = [
  {
    playerId: 'u1',
    playerUsername: 'kiran',
    playerPhone: null,
    directAgentId: 'a1',
    directAgentName: 'Agent One',
    totalStakes: 500,
    totalPayouts: 450,
    grossGamingRevenue: 50,
    betCount: 20,
    avgStake: 25,
    winRate: 0.4,
  },
]

const network = vi.hoisted(() => ({
  calls: [] as { name: string; variables: Record<string, unknown> }[],
  responders: {} as Record<string, Responder>,
}))

function defaultResponders(): Record<string, Responder> {
  return {
    CasinoKPIs: () => ({ data: { casinoKPIs: KPIS } }),
    CasinoTrends: () => ({ data: { casinoTrends: TRENDS } }),
    CasinoVendorBreakdown: () => ({ data: { casinoVendorBreakdown: VENDORS } }),
    CasinoGameBreakdown: () => ({ data: { casinoGameBreakdown: GAMES } }),
    CasinoPlayerBreakdown: () => ({ data: { casinoPlayerBreakdown: PLAYERS } }),
    CasinoAgentBreakdown: () => ({ data: { casinoAgentBreakdown: [] } }),
  }
}

function link() {
  return new ApolloLink(
    (operation) =>
      new Observable<FetchResult>((observer) => {
        network.calls.push({ name: operation.operationName, variables: operation.variables })
        const responder = network.responders[operation.operationName]
        const result = responder ? responder(operation.variables) : { data: null }
        if (result === 'pending') return
        if (result instanceof Error) {
          observer.error(result)
          return
        }
        observer.next(result)
        observer.complete()
      }),
  )
}

function renderPage() {
  return render(
    <MockedProvider link={link()} addTypename={false}>
      <MemoryRouter initialEntries={['/reporting/casino']}>
        <PageEyebrowProvider value="Reporting">
          <CasinoOverviewReport />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

/* ------------------------------------------------------------------ helpers */

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

function lastCall(name: string) {
  const calls = network.calls.filter((call) => call.name === name)
  return calls[calls.length - 1]
}

function callCount(name: string): number {
  return network.calls.filter((call) => call.name === name).length
}

function lastHook(name: string): HookCall | undefined {
  const calls = apollo.queries.filter((call) => call.name === name)
  return calls[calls.length - 1]
}

function breakdownTable(name: 'Vendor breakdown' | 'Game breakdown') {
  return screen.getByRole('table', { name })
}

function bodyRows(table: HTMLElement): HTMLElement[] {
  return within(table).getAllByRole('row').filter((row) => row.closest('tbody'))
}

function rowWith(table: HTMLElement, text: string): HTMLElement {
  const row = bodyRows(table).find((candidate) => within(candidate).queryByText(text))
  assert.ok(row, `row with ${text}`)
  return row
}

function cellTexts(row: HTMLElement): string[] {
  return within(row).getAllByRole('cell').map((cell) => cell.textContent ?? '')
}

async function vendorsShown() {
  return screen.findByText('Evolution', { selector: 'span' })
}

const TODAY = '2026-10-07'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T06:00:00.000Z'))
  apollo.queries.length = 0
  network.calls.length = 0
  network.responders = defaultResponders()
  guard.allowed = true
  guard.calls.length = 0
  feedback.error.mockReset()
  feedback.success.mockReset()
  useReportingStore.setState({
    filters: { tenant: 'core', dateFrom: '2026-09-01', dateTo: '2026-09-30', schemeType: 'CREDIT', domain: 'sports' },
    drillDownPath: [],
    activeFilters: {},
  } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

/* ------------------------------------------------------------------ tests */

describe('CasinoOverviewReport — guard and queries', () => {
  test('the page sits behind reporting.casino view, which agents bypass; a denied caller starts no query', () => {
    guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    assert.deepEqual(guard.calls[0], {
      required: [{ domain: 'reporting.casino', actions: ['view'] }],
      bypassForAgents: true,
    })
    assert.equal(apollo.queries.length, 0)
    assert.equal(network.calls.length, 0)
  })

  test('a visit opens on All time and sends the four queries the legacy page sent, with the same filter', async () => {
    renderPage()
    await vendorsShown()
    const state = useReportingStore.getState() as unknown as { filters: Record<string, unknown> }
    assert.equal(state.filters.dateFrom, '2000-01-01')
    assert.equal(state.filters.dateTo, TODAY)

    const drill = { dateFrom: '2000-01-01', dateTo: TODAY, currency: undefined, tenant: 'core' }
    const vendor = lastHook('CasinoVendorBreakdown')
    assert.equal(vendor?.document, CASINO_VENDOR_BREAKDOWN_QUERY)
    assert.deepEqual(vendor?.options.variables, { filter: drill })
    assert.equal(vendor?.options.errorPolicy, 'all')
    assert.equal(vendor?.options.fetchPolicy, 'network-only')
    assert.equal(typeof vendor?.options.onError, 'function')
    assert.equal(lastHook('CasinoGameBreakdown')?.document, CASINO_GAME_BREAKDOWN_QUERY)
    assert.deepEqual(lastHook('CasinoGameBreakdown')?.options.variables, { filter: drill })

    // KPIs and trends merge the store filters and keep only CasinoReportingFilter fields
    const reporting = { tenant: 'core', dateFrom: '2000-01-01', dateTo: TODAY }
    assert.equal(lastHook('CasinoKPIs')?.document, CASINO_KPIS_QUERY)
    assert.deepEqual(lastHook('CasinoKPIs')?.options, {
      variables: { filter: reporting },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })
    assert.equal(lastHook('CasinoTrends')?.document, CASINO_TRENDS_QUERY)
    assert.deepEqual(lastHook('CasinoTrends')?.options.variables, { filter: reporting })

    await waitFor(() => assert.deepEqual(plain(lastCall('CasinoVendorBreakdown')?.variables), { filter: plain(drill) }))
    assert.deepEqual(plain(lastCall('CasinoKPIs')?.variables), { filter: reporting })
    // no vendor or game is drilled, so the contributors ask for nothing
    assert.equal(callCount('CasinoPlayerBreakdown'), 0)
    assert.equal(callCount('CasinoAgentBreakdown'), 0)
    assert.ok(screen.getByText('Drill into a vendor or select a game to see contributing players and agents.'))
  })

  test('a drill-down path another report left behind is reset on arrival; the page’s own is kept', async () => {
    useReportingStore.setState({ drillDownPath: [{ type: 'sport', id: 4, name: 'Cricket' }] } as never)
    const first = renderPage()
    await vendorsShown()
    assert.deepEqual((useReportingStore.getState() as unknown as { drillDownPath: unknown[] }).drillDownPath, [])
    first.unmount()

    useReportingStore.setState({ drillDownPath: [{ type: 'vendor', id: 'v1', name: 'Evolution' }] } as never)
    renderPage()
    await screen.findByText('Crazy Time')
    assert.equal((useReportingStore.getState() as unknown as { drillDownPath: unknown[] }).drillDownPath.length, 1)
  })
})

describe('CasinoOverviewReport — page and figures', () => {
  test('one h1 with the section eyebrow, the legacy subtitle and a Refresh action', async () => {
    renderPage()
    await vendorsShown()
    const headings = screen.getAllByRole('heading', { level: 1 })
    assert.equal(headings.length, 1)
    assert.equal(headings[0].textContent, 'Casino Overview Report')
    assert.ok(screen.queryByText('Reporting') === null)
    assert.ok(screen.queryByText('Analyze casino gaming performance and revenue across all vendors') === null)
    assert.ok(screen.getByRole('button', { name: 'Refresh' }))
  })

  test('the four totals keep the legacy figures and lines', async () => {
    renderPage()
    const group = await screen.findByRole('group', { name: 'Casino totals' })
    const text = group.textContent ?? ''
    for (const piece of [
      'Total GGR',
      '₹29,22,600.00',
      'Hold: 24.42%',
      'Total Stakes',
      '₹1,19,68,600.00',
      'Payouts: ₹90,46,000.00',
      'Total Bets',
      (630820).toLocaleString(),
      'Avg: 300.4/player',
      'Active Players',
      '1834',
      '2100 total',
    ]) {
      assert.ok(text.includes(piece), piece)
    }
  })

  test('the vendor table: legacy columns, converted amounts, signed GGR ink, N/A and the item total', async () => {
    renderPage()
    await vendorsShown()
    const table = breakdownTable('Vendor breakdown')
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent)
    assert.deepEqual(headers, ['Vendor', 'Total Stakes', 'Total Payouts', 'GGR', 'Bets', 'Players', 'Games'])
    assert.deepEqual(cellTexts(rowWith(table, 'Evolution')), [
      'Evolution',
      '₹68,42,000.00',
      '₹52,17,200.00',
      '₹16,24,800.00',
      (342180).toLocaleString(),
      (1200).toLocaleString(),
      '48',
    ])
    const ezugi = rowWith(table, 'Ezugi')
    assert.ok(within(ezugi).getByText('₹-1,29,780.00').classList.contains(styles.loss))
    assert.ok(within(rowWith(table, 'Evolution')).getByText('₹16,24,800.00').classList.contains(styles.gain))
    assert.deepEqual(cellTexts(rowWith(table, 'N/A')), ['N/A', '₹200.00', '₹0.00', '₹0.00', '0', '0', '0'])
    assert.ok(screen.getByText('Total 3 items'))
    assert.ok(within(screen.getByRole('region', { name: 'Casino Overview Report' })).getByRole('table'))
  })
})

describe('CasinoOverviewReport — drill-down', () => {
  test('a click on a vendor row drills into it once; the games and contributors follow', async () => {
    renderPage()
    await vendorsShown()
    const evolution = rowWith(breakdownTable('Vendor breakdown'), 'Evolution')
    fireEvent.click(within(evolution).getByText('48'))

    const path = (useReportingStore.getState() as unknown as { drillDownPath: unknown[] }).drillDownPath
    assert.deepEqual(path, [{ type: 'vendor', id: 'v1', name: 'Evolution' }])
    const table = await screen.findByRole('table', { name: 'Game breakdown' })
    assert.deepEqual(within(table).getAllByRole('columnheader').map((th) => th.textContent), [
      'Game',
      'Total Stakes',
      'Total Payouts',
      'GGR',
      'Bets',
      'Players',
      'RTP',
    ])
    const crumbs = screen.getByRole('navigation', { name: 'Drill-down path' })
    assert.ok(within(crumbs).getByRole('button', { name: 'All Casino' }))
    assert.equal(within(crumbs).getByText('Evolution').closest('[aria-current]')?.getAttribute('aria-current'), 'location')

    const drill = { dateFrom: '2000-01-01', dateTo: TODAY, tenant: 'core', vendorId: 'v1' }
    await waitFor(() => assert.deepEqual(plain(lastCall('CasinoGameBreakdown')?.variables), { filter: drill }))
    await waitFor(() => assert.deepEqual(plain(lastCall('CasinoPlayerBreakdown')?.variables), { filter: drill }))
    assert.deepEqual(plain(lastCall('CasinoAgentBreakdown')?.variables), { filter: drill })
    assert.ok(await screen.findByText('kiran'))
  })

  test('a vendor row opens from the keyboard too (Enter on the focused row); focus lands on the new crumb', async () => {
    renderPage()
    await vendorsShown()
    const ezugi = rowWith(breakdownTable('Vendor breakdown'), 'Ezugi')
    assert.equal(ezugi.getAttribute('tabindex'), '0')
    ezugi.focus()
    fireEvent.keyDown(ezugi, { key: 'Enter' })
    assert.deepEqual((useReportingStore.getState() as unknown as { drillDownPath: unknown[] }).drillDownPath, [
      { type: 'vendor', id: 'v2', name: 'Ezugi' },
    ])
    // the focused vendor row is gone; focus moves to the current crumb, not the document
    assert.equal(ezugi.isConnected, false)
    const crumbs = screen.getByRole('navigation', { name: 'Drill-down path' })
    assert.equal(document.activeElement, within(crumbs).getByText('Ezugi').closest('[aria-current]'))
  })

  test('a game picked from the keyboard keeps focus on page 1; from a later page focus goes to the crumb', async () => {
    useReportingStore.setState({ drillDownPath: [{ type: 'vendor', id: 'v1', name: 'Evolution' }] } as never)
    network.responders.CasinoGameBreakdown = () => ({
      data: {
        casinoGameBreakdown: Array.from({ length: 25 }, (_, index) =>
          gameRow({ gameId: `g${index + 1}`, gameName: `Game ${index + 1}`, totalStakes: index + 1 }),
        ),
      },
    })
    renderPage()
    await screen.findByText('Game 1')
    const third = rowWith(breakdownTable('Game breakdown'), 'Game 3')
    third.focus()
    fireEvent.keyDown(third, { key: 'Enter' })
    assert.equal(rowWith(breakdownTable('Game breakdown'), 'Game 3').getAttribute('data-state'), 'open')
    assert.equal(document.activeElement, third)

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    const later = rowWith(breakdownTable('Game breakdown'), 'Game 22')
    later.focus()
    fireEvent.keyDown(later, { key: ' ' })
    // the pick returns the table to page 1, as a click does; the focused row left with page 2
    assert.equal(cellTexts(bodyRows(breakdownTable('Game breakdown'))[0])[0], 'Game 1Evolution')
    assert.equal(later.isConnected, false)
    const crumbs = screen.getByRole('navigation', { name: 'Drill-down path' })
    assert.equal(document.activeElement, within(crumbs).getByText('Evolution').closest('[aria-current]'))
    await waitFor(() =>
      assert.deepEqual(plain(lastCall('CasinoPlayerBreakdown')?.variables), {
        filter: { dateFrom: '2000-01-01', dateTo: TODAY, tenant: 'core', vendorId: 'v1', gameId: 'g22' },
      }),
    )
  })

  test('a game click selects it in place, the contributors narrow to it, the same game clears it', async () => {
    useReportingStore.setState({ drillDownPath: [{ type: 'vendor', id: 'v1', name: 'Evolution' }] } as never)
    renderPage()
    await screen.findByText('Crazy Time')
    const table = breakdownTable('Game breakdown')
    const crazy = rowWith(table, 'Crazy Time')
    fireEvent.click(within(crazy).getByText('70'))

    await waitFor(() => assert.equal(rowWith(breakdownTable('Game breakdown'), 'Crazy Time').getAttribute('data-state'), 'open'))
    assert.ok(within(rowWith(breakdownTable('Game breakdown'), 'Crazy Time')).getByText('Selected'))
    assert.equal((useReportingStore.getState() as unknown as { drillDownPath: unknown[] }).drillDownPath.length, 1)
    await waitFor(() =>
      assert.deepEqual(plain(lastCall('CasinoPlayerBreakdown')?.variables), {
        filter: { dateFrom: '2000-01-01', dateTo: TODAY, tenant: 'core', vendorId: 'v1', gameId: 'g2' },
      }),
    )

    fireEvent.click(within(rowWith(breakdownTable('Game breakdown'), 'Crazy Time')).getByText('70'))
    await waitFor(() => assert.equal(rowWith(breakdownTable('Game breakdown'), 'Crazy Time').getAttribute('data-state'), null))
  })

  test('RTP pills keep the legacy colours: above 95% red, above 90% orange, else green', async () => {
    useReportingStore.setState({ drillDownPath: [{ type: 'vendor', id: 'v1', name: 'Evolution' }] } as never)
    network.responders.CasinoGameBreakdown = () => ({
      data: { casinoGameBreakdown: [...GAMES, gameRow({ gameId: 'g4', gameName: 'No RTP' })] },
    })
    renderPage()
    await screen.findByText('Crazy Time')
    const table = breakdownTable('Game breakdown')
    const pillOf = (game: string, text: string) => within(rowWith(table, game)).getByText(text).closest(`.${pill.pill}`)
    assert.ok(pillOf('Lightning Roulette', '96.20%')?.classList.contains(pill.neg))
    assert.ok(pillOf('Crazy Time', '92.50%')?.classList.contains(pill.warn))
    assert.ok(pillOf('Monopoly Live', '88.00%')?.classList.contains(pill.ok))
    assert.ok(pillOf('No RTP', 'N/A')?.classList.contains(pill.neutral))
    assert.ok(within(rowWith(table, 'Crazy Time')).getByText('Evolution'))
  })

  test('the root crumb returns to the vendors and clears the selected game', async () => {
    useReportingStore.setState({ drillDownPath: [{ type: 'vendor', id: 'v1', name: 'Evolution' }] } as never)
    renderPage()
    await screen.findByText('Crazy Time')
    fireEvent.click(within(rowWith(breakdownTable('Game breakdown'), 'Crazy Time')).getByText('70'))
    fireEvent.click(screen.getByRole('button', { name: 'All Casino' }))
    assert.deepEqual((useReportingStore.getState() as unknown as { drillDownPath: unknown[] }).drillDownPath, [])
    assert.ok(await screen.findByRole('table', { name: 'Vendor breakdown' }))
    await waitFor(() =>
      assert.ok(screen.getByText('Drill into a vendor or select a game to see contributing players and agents.')),
    )
  })
})

describe('CasinoOverviewReport — filters, paging and sorting', () => {
  test('search narrows the rows; Clear all shows with it and resets search and period', async () => {
    renderPage()
    await vendorsShown()
    const search = screen.getByRole('searchbox', { name: 'Search vendors' })
    assert.equal(search.getAttribute('placeholder'), 'Search by vendor name...')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
    fireEvent.change(search, { target: { value: 'EZU' } })
    assert.deepEqual(bodyRows(breakdownTable('Vendor breakdown')).map((row) => cellTexts(row)[0]), ['Ezugi'])
    assert.ok(screen.getByText('1 filter applied'))

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    let state = useReportingStore.getState() as unknown as { filters: Record<string, unknown> }
    assert.equal(state.filters.dateFrom, TODAY)
    assert.equal(state.filters.dateTo, TODAY)
    assert.ok(screen.getByText('2 filters applied'))
    await waitFor(() =>
      assert.deepEqual(plain(lastCall('CasinoVendorBreakdown')?.variables), {
        filter: { dateFrom: TODAY, dateTo: TODAY, tenant: 'core' },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    state = useReportingStore.getState() as unknown as { filters: Record<string, unknown> }
    assert.equal(state.filters.dateFrom, '2000-01-01')
    assert.equal(state.filters.dateTo, TODAY)
    assert.equal((screen.getByRole('searchbox', { name: 'Search vendors' }) as HTMLInputElement).value, '')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
    await waitFor(() => assert.equal(bodyRows(breakdownTable('Vendor breakdown')).length, 3))
  })

  test('games are searched by game or vendor name under their own label', async () => {
    useReportingStore.setState({ drillDownPath: [{ type: 'vendor', id: 'v1', name: 'Evolution' }] } as never)
    renderPage()
    await screen.findByText('Crazy Time')
    const search = screen.getByRole('searchbox', { name: 'Search games' })
    assert.equal(search.getAttribute('placeholder'), 'Search by game name...')
    fireEvent.change(search, { target: { value: 'live' } })
    assert.deepEqual(bodyRows(breakdownTable('Game breakdown')).map((row) => cellTexts(row)[0]), ['Monopoly LiveEvolution'])
  })

  test('20 rows a page with Total N items; a new page size returns to page 1', async () => {
    network.responders.CasinoVendorBreakdown = () => ({
      data: {
        casinoVendorBreakdown: Array.from({ length: 25 }, (_, index) =>
          vendorRow({ vendorId: `v${index + 1}`, vendorName: `Vendor ${index + 1}`, totalStakes: index + 1 }),
        ),
      },
    })
    renderPage()
    await screen.findByText('Vendor 1')
    assert.ok(screen.getByText('Total 25 items'))
    assert.equal(bodyRows(breakdownTable('Vendor breakdown')).length, 20)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    assert.deepEqual(
      bodyRows(breakdownTable('Vendor breakdown')).map((row) => cellTexts(row)[0]),
      ['Vendor 21', 'Vendor 22', 'Vendor 23', 'Vendor 24', 'Vendor 25'],
    )
    // the pager closes a Card body="table", so it takes the embedded look (no rule, no second inset)
    assert.ok(screen.getByRole('navigation', { name: 'Pagination' }).classList.contains(pager.embedded))
    const size = within(screen.getByRole('navigation', { name: 'Pagination' })).getByRole('combobox')
    assert.deepEqual(Array.from((size as HTMLSelectElement).options).map((option) => option.value), ['10', '20', '50', '100'])
    fireEvent.change(size, { target: { value: '10' } })
    const rows = bodyRows(breakdownTable('Vendor breakdown'))
    assert.equal(rows.length, 10)
    assert.equal(cellTexts(rows[0])[0], 'Vendor 1')
  })

  test('a column sort orders the rows of the page: ascending, descending, then as served', async () => {
    renderPage()
    await vendorsShown()
    const names = () => bodyRows(breakdownTable('Vendor breakdown')).map((row) => cellTexts(row)[0])
    assert.deepEqual(names(), ['Evolution', 'Ezugi', 'N/A'])
    const header = () => within(breakdownTable('Vendor breakdown')).getByRole('columnheader', { name: /GGR/ })
    fireEvent.click(within(header()).getByRole('button'))
    assert.equal(header().getAttribute('aria-sort'), 'ascending')
    assert.deepEqual(names(), ['Ezugi', 'N/A', 'Evolution'])
    fireEvent.click(within(header()).getByRole('button'))
    assert.equal(header().getAttribute('aria-sort'), 'descending')
    assert.deepEqual(names(), ['Evolution', 'N/A', 'Ezugi'])
    fireEvent.click(within(header()).getByRole('button'))
    assert.equal(header().getAttribute('aria-sort'), 'none')
    assert.deepEqual(names(), ['Evolution', 'Ezugi', 'N/A'])
  })

  test('each level sorts the legacy columns: the figures, then Games for vendors and RTP for games', async () => {
    const sortableHeaders = (table: HTMLElement) =>
      within(table)
        .getAllByRole('columnheader')
        .filter((th) => within(th).queryByRole('button'))
        .map((th) => th.textContent)
    renderPage()
    await vendorsShown()
    assert.deepEqual(sortableHeaders(breakdownTable('Vendor breakdown')), [
      'Total Stakes',
      'Total Payouts',
      'GGR',
      'Bets',
      'Players',
      'Games',
    ])
    fireEvent.click(within(rowWith(breakdownTable('Vendor breakdown'), 'Evolution')).getByText('48'))
    await screen.findByText('Crazy Time')
    assert.deepEqual(sortableHeaders(breakdownTable('Game breakdown')), [
      'Total Stakes',
      'Total Payouts',
      'GGR',
      'Bets',
      'Players',
      'RTP',
    ])
    const rtp = () => within(breakdownTable('Game breakdown')).getByRole('columnheader', { name: /RTP/ })
    fireEvent.click(within(rtp()).getByRole('button'))
    assert.equal(rtp().getAttribute('aria-sort'), 'ascending')
    assert.deepEqual(
      bodyRows(breakdownTable('Game breakdown')).map((row) => cellTexts(row)[0]),
      ['Monopoly LiveEvolution', 'Crazy TimeEvolution', 'Lightning RouletteEvolution'],
    )
  })

  test('store filter chips show, feed the query and can be removed', async () => {
    useReportingStore.setState({ activeFilters: { agentId: { value: 'a-7', label: 'Agent' } } } as never)
    renderPage()
    await vendorsShown()
    await waitFor(() =>
      assert.deepEqual(plain(lastCall('CasinoVendorBreakdown')?.variables), {
        filter: { dateFrom: '2000-01-01', dateTo: TODAY, tenant: 'core', agentId: 'a-7' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Agent: a-7' }))
    assert.deepEqual((useReportingStore.getState() as unknown as { activeFilters: object }).activeFilters, {})
    await waitFor(() =>
      assert.deepEqual(plain(lastCall('CasinoVendorBreakdown')?.variables), {
        filter: { dateFrom: '2000-01-01', dateTo: TODAY, tenant: 'core' },
      }),
    )
  })
})

describe('CasinoOverviewReport — views and charts', () => {
  function legendAndLines(scope: HTMLElement) {
    const swatchSlot: Record<string, string> = {
      [charts.keyS1]: charts.lineS1,
      [charts.keyS2]: charts.lineS2,
      [charts.keyS3]: charts.lineS3,
    }
    const legend = Array.from(scope.querySelectorAll(`.${charts.legend} li`)).map((item) => {
      const swatch = item.querySelector('i')
      const keyClass = Array.from(swatch?.classList ?? []).find((name) => name in swatchSlot)
      return { name: item.textContent ?? '', lineClass: keyClass ? swatchSlot[keyClass] : undefined }
    })
    /* The first point's y of the line drawn with a class: the higher the series, the smaller the y. */
    const lineY = (lineClass: string | undefined) => {
      const layer = lineClass ? scope.querySelector(`.recharts-line.${lineClass}`) : null
      const d = layer?.querySelector('path.recharts-line-curve')?.getAttribute('d') ?? ''
      const match = /M\s*(-?[\d.]+)[ ,](-?[\d.]+)/.exec(d)
      return match ? Number(match[2]) : Number.NaN
    }
    return { legend, lineY }
  }

  test('the view tabs are one tab stop with arrow keys, and each panel is labelled by its tab', async () => {
    renderPage()
    await vendorsShown()
    const tablist = screen.getByRole('tablist', { name: 'View mode' })
    const tabs = within(tablist).getAllByRole('tab')
    assert.deepEqual(tabs.map((tab) => tab.textContent), ['Breakdown', 'Overview', 'Trends'])
    assert.deepEqual(tabs.map((tab) => tab.getAttribute('tabindex')), ['0', '-1', '-1'])
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    const overview = screen.getByRole('tab', { name: 'Overview' })
    assert.equal(overview.getAttribute('aria-selected'), 'true')
    const panel = screen.getByRole('tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), overview.id)
    assert.equal(screen.queryByRole('table', { name: 'Vendor breakdown' }), null)
    await waitFor(() =>
      assert.deepEqual(
        within(panel).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
        ['Performance Trends', 'Top Performers (Stakes)', 'Distribution (GGR)'],
      ),
    )
    assert.ok(within(panel).getByText('Top 3 entries'))
  })

  test('the Trends legend lists Stakes, Payouts, GGR and each swatch is the colour of its own line', async () => {
    renderPage()
    await vendorsShown()
    fireEvent.click(screen.getByRole('tab', { name: 'Trends' }))
    const card = await screen.findByRole('region', { name: 'Performance Trends' })
    assert.ok(within(card).getByText('3 data points'))
    await waitFor(() => assert.equal(card.querySelectorAll(`.${charts.legend} li`).length, 3))
    await waitFor(() => assert.equal(card.querySelectorAll('.recharts-line path.recharts-line-curve').length, 3))
    const { legend, lineY } = legendAndLines(card)
    assert.deepEqual(legend.map((item) => item.name), ['Stakes', 'Payouts', 'GGR'])
    const [stakes, payouts, ggr] = legend.map((item) => lineY(item.lineClass))
    // converted values 300 > 200 > 100: the Stakes swatch's line is the highest, GGR's the lowest
    assert.ok(stakes < payouts && payouts < ggr, `y: stakes ${stakes}, payouts ${payouts}, ggr ${ggr}`)
    assert.deepEqual(new Set(legend.map((item) => item.lineClass)).size, 3)
  })

  test('the Overview trend legend matches its lines the same way', async () => {
    renderPage()
    await vendorsShown()
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    const card = await screen.findByRole('region', { name: 'Performance Trends' })
    await waitFor(() => assert.equal(card.querySelectorAll('.recharts-line path.recharts-line-curve').length, 3))
    const { legend, lineY } = legendAndLines(card)
    assert.deepEqual(legend.map((item) => item.name), ['Stakes', 'Payouts', 'GGR'])
    const [stakes, payouts, ggr] = legend.map((item) => lineY(item.lineClass))
    assert.ok(stakes < payouts && payouts < ggr, `y: stakes ${stakes}, payouts ${payouts}, ggr ${ggr}`)
  })
})

describe('CasinoOverviewReport — loading, empty, error and refresh', () => {
  test('loading names the table while the vendors load', async () => {
    network.responders.CasinoVendorBreakdown = () => 'pending'
    renderPage()
    const table = await screen.findByRole('table', { name: 'Vendor breakdown' })
    assert.equal(table.getAttribute('aria-busy'), 'true')
    assert.ok(within(table).getByText('Loading Vendor breakdown'))
  })

  test('no vendors reads No data', async () => {
    network.responders.CasinoVendorBreakdown = () => ({ data: { casinoVendorBreakdown: [] } })
    renderPage()
    const table = await screen.findByRole('table', { name: 'Vendor breakdown' })
    await waitFor(() => assert.ok(within(table).getByText('No data')))
    assert.ok(screen.getByText('Total 0 items'))
  })

  test('a failed breakdown shows its message with Retry and keeps the legacy toast', async () => {
    network.responders.CasinoVendorBreakdown = () => ({
      data: null,
      errors: [new GraphQLError('Vendor breakdown unavailable')],
    })
    renderPage()
    const table = await screen.findByRole('table', { name: 'Vendor breakdown' })
    await waitFor(() => assert.ok(within(table).getByText('Vendor breakdown unavailable')))
    await waitFor(() => assert.ok(feedback.error.mock.calls.some((call) => call[1] === 'Failed to load vendor breakdown')))
    const before = callCount('CasinoVendorBreakdown')
    network.responders.CasinoVendorBreakdown = () => ({ data: { casinoVendorBreakdown: VENDORS } })
    fireEvent.click(within(table).getByRole('button', { name: 'Retry' }))
    await vendorsShown()
    assert.equal(callCount('CasinoVendorBreakdown'), before + 1)
  })

  test('Refresh asks again for the four page queries; the contributors keep theirs, as before', async () => {
    useReportingStore.setState({ drillDownPath: [{ type: 'vendor', id: 'v1', name: 'Evolution' }] } as never)
    renderPage()
    await screen.findByText('kiran')
    const page = ['CasinoKPIs', 'CasinoTrends', 'CasinoVendorBreakdown', 'CasinoGameBreakdown']
    const contributors = ['CasinoPlayerBreakdown', 'CasinoAgentBreakdown']
    const before = Object.fromEntries([...page, ...contributors].map((name) => [name, callCount(name)]))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      for (const name of page) assert.ok(callCount(name) > before[name], name)
    })
    /* The legacy page bumped a refresh key in the contributors' filter "to force a refetch", but the
       hooks strip that key before the request (modules/reporting/hooks.ts casinoDrillDownFilterForApi),
       so the variables do not change and Apollo starts no request. Kept as found; reported. */
    for (const name of contributors) assert.equal(callCount(name), before[name], name)
    assert.equal('_refreshKey' in (lastCall('CasinoPlayerBreakdown')?.variables.filter as object), false)
    const hook = lastHook('CasinoPlayerBreakdown')
    assert.equal((hook?.options.variables as { filter: Record<string, unknown> }).filter._refreshKey, undefined)
  })
})
