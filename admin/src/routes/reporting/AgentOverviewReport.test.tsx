/**
 * /reporting/agent-overview against a mocked GraphQL server (MockedProvider + MemoryRouter). The real
 * page, its data hooks (modules/reporting/hooks), useExport and the kit render; useQuery/useMutation are
 * wrapped, not replaced, so every option the page passes is recorded while the real Apollo hooks run
 * against the mocks. The date-range pill has its own suite, so a deterministic stand-in drives the
 * applied period here. The clock is fixed at 2026-10-07 11:30 IST.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloLink, Observable } from '@apollo/client'
import { MockLink, MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import {
  AGENT_KPIS_QUERY,
  AGENT_PERFORMANCE_QUERY,
  AGENT_PLAYER_BREAKDOWN_QUERY,
  AGENT_TRENDS_QUERY,
} from '@/modules/reporting/graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import AgentOverviewReport from './AgentOverviewReport'

interface HookCall {
  name: string
  document: unknown
  options: Record<string, unknown>
}

interface MockAgent {
  allowedDomains: string[]
}

interface DateRangeFieldProps {
  label?: string
  presets: readonly { value: string; label: string }[]
  appliedPreset: string
  appliedFrom?: string
  appliedTo?: string
  customValue?: string
  onApply: (payload:
    | { kind: 'preset'; preset: string }
    | { kind: 'custom'; from: string; to: string }
  ) => void
  onReset: () => void
}

const apollo = vi.hoisted(() => ({
  queries: [] as HookCall[],
  mutations: [] as HookCall[],
}))

const auth = vi.hoisted(() => ({
  isAgent: false,
  agent: undefined as MockAgent | undefined,
}))

const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as unknown[],
}))

const store = vi.hoisted(() => ({
  filters: { tenant: 'core', dateFrom: '2000-01-01', dateTo: '2026-10-07' },
}))

const feedback = vi.hoisted(() => ({
  hide: vi.fn(),
  loading: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))

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
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({
        name: nameOf(args[0]),
        document: args[0],
        options: (args[1] ?? {}) as Record<string, unknown>,
      })
      return actual.useMutation(...args)
    },
  }
})

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: MockAgent; isAgent: () => boolean }) => unknown) =>
    selector({ agent: auth.agent, isAgent: () => auth.isAgent }),
}))

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
    formatAmount: (amount: number) => `₹${amount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
  }),
}))

vi.mock('@/state/reportingStore', () => ({
  useReportingStore: () => ({ filters: store.filters }),
}))

vi.mock('@/shared/services/notification', () => ({
  notify: {
    loading: feedback.loading,
    error: feedback.notifyError,
    success: feedback.notifySuccess,
  },
  messageService: {
    success: feedback.success,
    error: feedback.error,
    info: feedback.info,
    warning: feedback.warning,
  },
}))

vi.mock('@/ui/components/DateRangeField', () => ({
  DateRangeField: ({
    label = 'Period',
    presets,
    appliedPreset,
    appliedFrom,
    appliedTo,
    customValue,
    onApply,
    onReset,
  }: DateRangeFieldProps) => (
    <fieldset>
      <legend>{label}</legend>
      <output data-testid="period-state">{`${appliedPreset}|${appliedFrom ?? ''}|${appliedTo ?? ''}|${customValue ?? ''}`}</output>
      <output data-testid="period-presets">{presets.map((preset) => `${preset.value}:${preset.label}`).join(',')}</output>
      <button type="button" onClick={() => onApply({ kind: 'preset', preset: 'today' })}>Apply Today</button>
      <button type="button" onClick={() => onApply({ kind: 'custom', from: '2026-01-02', to: '2026-01-04' })}>
        Apply Custom
      </button>
      <button type="button" onClick={onReset}>Reset Period</button>
    </fieldset>
  ),
}))

/* useExport keeps its export-job document private, and copying it here would add a second copy of the
   operation to the app's GraphQL inventory, so a link in front of the mocks answers that one operation
   by name and records what it was sent. */
const exportRequests: Array<Record<string, unknown>> = []
/** A finished job keeps its file in its row; the hook asks for it by the job's id and the server answers it as a
 *  base64 data URI (2026-11-04). */
const storedFiles = new Map<string, string>()

const exportLink = new ApolloLink((operation, forward) => {
  if (operation.operationName === 'ExportJobDownloadUrlFromHook') {
    return Observable.of({ data: { exportJobDownloadUrl: storedFiles.get(String(operation.variables.jobId)) ?? null } })
  }
  if (operation.operationName !== 'CreateExportJobFromHook') return forward(operation)
  exportRequests.push(operation.variables)
  const format = (operation.variables.input as { exportFormat: string }).exportFormat.toLowerCase()
  const id = `job-${exportRequests.length}`
  storedFiles.set(id, `data:${format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};base64,${btoa(`report.${format}`)}`)
  return Observable.of({
    data: {
      createExportJob: {
        id,
        status: 'completed',
        fileUrl: `exports/t/t/ggr-${id}.csv`,
        errorMessage: null,
      },
    },
  })
})

const NOW = new Date('2026-10-07T06:00:00.000Z')
const INITIAL = { dateFrom: '2026-09-07', dateTo: '2026-10-07' }
const TODAY = { dateFrom: '2026-10-07', dateTo: '2026-10-07' }

const KPIS = {
  totalTurnover: 1250000,
  totalGGR: 82000.5,
  commissionEarned: 4100,
  shareEarned: 900,
  downlineTurnover: 0,
  downlineGGR: 0,
  playerCount: 12,
  activePlayerCount: 4,
  betCount: 300,
  agentCount: 3,
}

function agent(index: number) {
  return {
    agentId: `a1b2c3d4-0000-4000-8000-${String(index).padStart(12, '0')}`,
    agentName: index === 0 ? null : `Agent ${index}`,
    schemeType: 'COMMISSION',
    totalTurnover: 1000 * (index + 1),
    totalGGR: 100 * (index + 1),
    commissionEarned: 10 * (index + 1),
    shareEarned: 0,
    downlineTurnover: 0,
    downlineGGR: 0,
    playerCount: 1200 + index,
    betCount: 10,
    level: 1,
    userCutPercent: null,
    agentCutPercent: null,
    domainBreakdown: null,
  }
}

const AGENTS = Array.from({ length: 12 }, (_, index) => agent(index))

const TRENDS = [
  { date: '2026-10-06', turnover: 500, ggr: 50, commission: 5, share: 1, playerCount: 7 },
  { date: '2026-10-07', turnover: 600, ggr: 60, commission: 6, share: 1, playerCount: 1234 },
]

function player(index: number) {
  return {
    playerId: `p-${index}`,
    playerUsername: index === 0 ? null : `player${index}`,
    totalStakes: 100 * (index + 1),
    totalPayouts: 0,
    grossGamingRevenue: 10 * (index + 1),
    betCount: 1000 + index,
    avgStake: 5,
    winRate: 0,
  }
}

const PLAYERS = Array.from({ length: 55 }, (_, index) => player(index))

const counts = { kpis: 0, trends: 0, performance: 0, players: 0 }

type Filter = Record<string, unknown>

function kpisMock(filter: Filter, agentKPIs: unknown = KPIS): MockedResponse {
  return {
    request: { query: AGENT_KPIS_QUERY, variables: { filter: { ...store.filters, ...filter } } },
    result: () => {
      counts.kpis += 1
      return { data: { agentKPIs } }
    },
  }
}

function trendsMock(filter: Filter, agentTrends: unknown = TRENDS): MockedResponse {
  return {
    request: { query: AGENT_TRENDS_QUERY, variables: { filter: { ...store.filters, ...filter } } },
    result: () => {
      counts.trends += 1
      return { data: { agentTrends } }
    },
  }
}

function performanceMock(filter: Filter, agents: unknown[] = AGENTS): MockedResponse {
  return {
    request: {
      query: AGENT_PERFORMANCE_QUERY,
      variables: { filter: { ...store.filters, ...filter }, limit: 50 },
    },
    result: () => {
      counts.performance += 1
      return { data: { agentPerformance: { agents, totals: null } } }
    },
  }
}

function playersMock(filter: Filter, agentPlayerBreakdown: unknown = PLAYERS): MockedResponse {
  return {
    request: { query: AGENT_PLAYER_BREAKDOWN_QUERY, variables: { filter } },
    result: () => {
      counts.players += 1
      return { data: { agentPlayerBreakdown } }
    },
  }
}

function allMocks(filter: Filter): MockedResponse[] {
  return [kpisMock(filter), trendsMock(filter), performanceMock(filter), playersMock(filter)]
}

/** The export job input: report `ggr`, the processor's format name, the applied range, also as the
 *  dateFrom / dateTo its fetchers read ('csv' and a dateRange alone made every job fail, F-REP-02). */
function exportInput(format: 'csv' | 'xlsx', dateRange: { from: string; to: string }) {
  return {
    input: {
      reportType: 'ggr',
      exportFormat: format.toUpperCase(),
      filtersJson: { dateRange, dateFrom: dateRange.from, dateTo: dateRange.to },
    },
  }
}

function renderPage(mocks: MockedResponse[]) {
  return render(
    <MockedProvider
      mocks={mocks}
      addTypename={false}
      link={ApolloLink.from([exportLink, new MockLink(mocks, false)])}
    >
      <MemoryRouter initialEntries={['/reporting/agent-overview']}>
        <PageEyebrowProvider value="Reporting">
          <AgentOverviewReport />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

const queriesNamed = (name: string) => apollo.queries.filter((call) => call.name === name)
const lastVariables = (name: string) => queriesNamed(name).at(-1)?.options.variables

async function loaded() {
  await screen.findByText('₹25,00,000.00')
}

function bodyRows(table: HTMLElement) {
  return within(table).getAllByRole('row').slice(1)
}

let clicked: HTMLAnchorElement[] = []
/** The Blob behind each object URL the export hook made, in order. */
let savedFiles: Blob[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  apollo.queries.length = 0
  apollo.mutations.length = 0
  guard.allowed = true
  guard.calls.length = 0
  auth.isAgent = false
  auth.agent = undefined
  counts.kpis = 0
  counts.trends = 0
  counts.performance = 0
  counts.players = 0
  exportRequests.length = 0
  for (const fn of Object.values(feedback)) fn.mockReset()
  feedback.loading.mockReturnValue(feedback.hide)
  clicked = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    clicked.push(this)
  })
  savedFiles = []
  window.URL.createObjectURL = vi.fn((blob: Blob) => {
    savedFiles.push(blob)
    return `blob:report-${savedFiles.length}`
  })
  window.URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AgentOverviewReport', () => {
  test('keeps the guard and runs the four queries with the legacy documents, variables and options', async () => {
    renderPage(allMocks(INITIAL))

    assert.deepEqual(guard.calls[0], {
      required: [{ domain: 'reporting.agent-overview', actions: ['view'] }],
      bypassForAgents: true,
    })
    await loaded()

    const merged = { filter: { ...store.filters, ...INITIAL } }
    const [kpis] = queriesNamed('AgentKPIs')
    assert.equal(kpis.document, AGENT_KPIS_QUERY)
    assert.deepEqual(kpis.options, {
      variables: merged,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
      skip: false,
    })

    const [trends] = queriesNamed('AgentTrends')
    assert.equal(trends.document, AGENT_TRENDS_QUERY)
    assert.deepEqual(trends.options, {
      variables: merged,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
      skip: false,
    })

    const [performance] = queriesNamed('AgentPerformance')
    assert.equal(performance.document, AGENT_PERFORMANCE_QUERY)
    assert.deepEqual(performance.options, {
      variables: { ...merged, limit: 50 },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
      skip: false,
    })

    const [players] = queriesNamed('AgentPlayerBreakdown')
    assert.equal(players.document, AGENT_PLAYER_BREAKDOWN_QUERY)
    const { onError, ...playerOptions } = players.options
    assert.equal(typeof onError, 'function')
    assert.deepEqual(playerOptions, {
      variables: { filter: INITIAL },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
      skip: false,
    })
    assert.deepEqual(Object.keys(players.options.variables as { filter: object }), ['filter'])
    assert.deepEqual(Object.keys((players.options.variables as { filter: object }).filter), ['dateFrom', 'dateTo'])

    // recorded once per render: the one mutation hook is useExport's
    assert.deepEqual([...new Set(apollo.mutations.map((call) => call.name))], ['CreateExportJobFromHook'])
    assert.deepEqual(counts, { kpis: 1, trends: 1, performance: 1, players: 1 })
  })

  test('a denied caller sees the guard and starts no query', () => {
    guard.allowed = false
    renderPage([])
    assert.ok(screen.getByRole('alert'))
    assert.equal(screen.getByText('Access denied').textContent, 'Access denied')
    assert.equal(apollo.queries.length, 0)
    assert.equal(apollo.mutations.length, 0)
  })

  test('renders the header, the period control and the four totals with the legacy copy', async () => {
    renderPage(allMocks(INITIAL))
    await loaded()

    const headings = screen.getAllByRole('heading', { level: 1 })
    assert.equal(headings.length, 1)
    assert.equal(headings[0].textContent, 'Agent Overview Report')
    assert.ok(screen.queryByText('View comprehensive reports and analytics for your agent performance') === null)
    assert.ok(screen.queryByText('Reporting') === null)

    assert.equal(screen.getByTestId('period-state').textContent, 'last30days|2026-09-07|2026-10-07|custom')
    assert.equal(
      screen.getByTestId('period-presets').textContent,
      'today:Today,yesterday:Yesterday,last7days:Last 7 Days,last30days:Last 30 Days,thisMonth:This Month,lastMonth:Last Month,custom:Custom Range',
    )
    assert.ok(screen.getByRole('group', { name: 'Date Range' }))

    const totals = screen.getByRole('group', { name: 'Agent overview totals' })
    for (const [label, value, note] of [
      // F-REP-09: the note is the applied period, not "All time"
      ['Total Turnover', '₹25,00,000.00', 'Last 30 Days'],
      ['Total GGR', '₹1,64,001.00', 'Gross gaming revenue'],
      ['Commission Earned', '₹8,200.00', 'All commissions'],
      ['Share Earned', '₹1,800.00', 'All shares'],
    ]) {
      assert.ok(within(totals).getByText(label), label)
      assert.ok(within(totals).getByText(value), value)
      assert.ok(within(totals).getByText(note), note)
    }
  })

  test('shows agent performance ten to a page with the legacy cells', async () => {
    renderPage(allMocks(INITIAL))
    await loaded()

    assert.equal(screen.getByRole('heading', { level: 2, name: 'Agent Performance' }).tagName, 'H2')
    const table = screen.getByRole('table', { name: 'Agent performance' })
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent)
    assert.deepEqual(headers, ['Agent', 'Turnover', 'GGR', 'Commission', 'Players'])

    let rows = bodyRows(table)
    assert.equal(rows.length, 10)
    const first = within(rows[0]).getAllByRole('cell').map((cell) => cell.textContent)
    assert.deepEqual(first, [
      'N/Aa1b2c3d4...',
      '₹2,000.00',
      '₹200.00',
      '₹20.00',
      (1200).toLocaleString(),
    ])
    assert.equal(within(rows[1]).getAllByRole('cell')[0].textContent, 'Agent 1a1b2c3d4...')
    const pager = screen.getByRole('navigation', { name: 'Pagination' })
    assert.ok(pager.textContent?.includes('of 12 agents'), pager.textContent ?? '')

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    rows = bodyRows(screen.getByRole('table', { name: 'Agent performance' }))
    assert.equal(rows.length, 2)
    assert.equal(within(rows[1]).getAllByRole('cell')[0].textContent, 'Agent 11a1b2c3d4...')
  })

  test('switches views with the tab strip and its arrow keys', async () => {
    renderPage(allMocks(INITIAL))
    await loaded()

    const tablist = screen.getByRole('tablist', { name: 'Agent Overview Report tabs selector' })
    const tabs = within(tablist).getAllByRole('tab')
    // F-REP-08: the Top Events/Games placeholder (no query behind it) is gone
    assert.deepEqual(tabs.map((tab) => tab.textContent), [
      'GGR by Domain',
      'Player Activity',
      'Top Players',
    ])
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true')
    assert.equal(screen.getByRole('tabpanel').getAttribute('aria-labelledby'), tabs[0].id)

    tabs[0].focus()
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    const activityTab = screen.getByRole('tab', { name: 'Player Activity' })
    assert.equal(activityTab.getAttribute('aria-selected'), 'true')
    assert.equal(document.activeElement, activityTab)
    assert.equal(screen.getByRole('tabpanel').getAttribute('aria-labelledby'), activityTab.id)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Activity Trends' }))
    const trends = screen.getByRole('table', { name: 'Activity trends' })
    assert.deepEqual(within(trends).getAllByRole('columnheader').map((cell) => cell.textContent), [
      'Date',
      'Turnover',
      'GGR',
      'Commission',
      'Players',
    ])
    assert.deepEqual(
      within(bodyRows(trends)[1]).getAllByRole('cell').map((cell) => cell.textContent),
      ['2026-10-07', '₹1,200.00', '₹120.00', '₹12.00', '1234'],
    )
    assert.equal(screen.queryByRole('group', { name: 'Agent overview totals' }), null)

    fireEvent.click(screen.getByRole('tab', { name: 'Top Players' }))
    const players = screen.getByRole('table', { name: 'Top players' })
    assert.deepEqual(within(players).getAllByRole('columnheader').map((cell) => cell.textContent), [
      'Player',
      'Total Stakes',
      'GGR',
      'Bets',
      'Avg Stake',
    ])
    const playerRows = bodyRows(players)
    assert.equal(playerRows.length, 20)
    assert.deepEqual(within(playerRows[0]).getAllByRole('cell').map((cell) => cell.textContent), [
      'N/AID: p-0',
      '₹200.00',
      '₹20.00',
      (1000).toLocaleString(),
      '₹10.00',
    ])
    // the first fifty of fifty-five
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    const lastPage = bodyRows(screen.getByRole('table', { name: 'Top players' }))
    assert.equal(lastPage.length, 10)
    assert.equal(within(lastPage[9]).getAllByRole('cell')[0].textContent, 'player49ID: p-49')
    assert.equal(screen.queryByRole('button', { name: 'Page 4' }), null)

    fireEvent.keyDown(screen.getByRole('tab', { name: 'GGR by Domain' }), { key: 'End' })
    assert.equal(screen.getByRole('tab', { name: 'Top Players' }).getAttribute('aria-selected'), 'true')
    assert.equal(screen.queryByText('Top events and games will be displayed here'), null)
  })

  test('filters by domain through a native radio group and re-queries with the domain', async () => {
    const sports = { ...INITIAL, domain: 'sports' }
    renderPage([...allMocks(INITIAL), ...allMocks(sports)])
    await loaded()

    const group = screen.getByRole('group', { name: 'Domain' })
    const radios = within(group).getAllByRole('radio')
    assert.deepEqual(radios.map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent), [
      'All Domains',
      'Sports',
      'Casino',
      'Matka',
    ])
    assert.equal((radios[0] as HTMLInputElement).checked, true)
    assert.equal(new Set(radios.map((radio) => (radio as HTMLInputElement).name)).size, 1)

    fireEvent.click(within(group).getByRole('radio', { name: 'Sports' }))
    await waitFor(() => assert.equal(counts.players, 2))
    assert.deepEqual(lastVariables('AgentKPIs'), { filter: { ...store.filters, ...sports } })
    assert.deepEqual(lastVariables('AgentTrends'), { filter: { ...store.filters, ...sports } })
    assert.deepEqual(lastVariables('AgentPerformance'), { filter: { ...store.filters, ...sports }, limit: 50 })
    assert.deepEqual(lastVariables('AgentPlayerBreakdown'), { filter: sports })
    assert.equal((within(group).getByRole('radio', { name: 'Sports' }) as HTMLInputElement).checked, true)
  })

  test('goes back to page 1 when the domain, the period or the view changes, as the legacy tables did', async () => {
    const sports = { ...INITIAL, domain: 'sports' }
    const sportsToday = { ...TODAY, domain: 'sports' }
    renderPage([...allMocks(INITIAL), ...allMocks(sports), ...allMocks(sportsToday), ...allMocks(sports)])
    await loaded()

    const firstCell = (name: string) =>
      within(bodyRows(screen.getByRole('table', { name }))[0]).getAllByRole('cell')[0].textContent

    fireEvent.click(screen.getByRole('tab', { name: 'Top Players' }))
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    assert.equal(firstCell('Top players'), 'player40ID: p-40')

    // a new domain
    fireEvent.click(within(screen.getByRole('group', { name: 'Domain' })).getByRole('radio', { name: 'Sports' }))
    await waitFor(() => assert.equal(counts.players, 2))
    await waitFor(() => assert.equal(firstCell('Top players'), 'N/AID: p-0'))

    // a new period
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    assert.equal(firstCell('Top players'), 'player40ID: p-40')
    fireEvent.click(screen.getByRole('button', { name: 'Apply Today' }))
    await waitFor(() => assert.equal(counts.players, 3))
    await waitFor(() => assert.equal(firstCell('Top players'), 'N/AID: p-0'))

    // the same variables again start no query and keep the page
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply Today' }))
    assert.equal(firstCell('Top players'), 'player40ID: p-40')

    // leaving the view and coming back; the active tab clicked again keeps it
    fireEvent.click(screen.getByRole('tab', { name: 'Top Players' }))
    assert.equal(firstCell('Top players'), 'player40ID: p-40')
    fireEvent.click(screen.getByRole('tab', { name: 'Player Activity' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Top Players' }))
    assert.equal(firstCell('Top players'), 'N/AID: p-0')

    // the performance table, through Reset
    fireEvent.click(screen.getByRole('tab', { name: 'GGR by Domain' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    assert.equal(firstCell('Agent performance'), 'Agent 10a1b2c3d4...')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Period' }))
    await waitFor(() => assert.equal(counts.performance, 4))
    await waitFor(() => assert.equal(firstCell('Agent performance'), 'N/Aa1b2c3d4...'))
    assert.equal(bodyRows(screen.getByRole('table', { name: 'Agent performance' })).length, 10)

    assert.deepEqual(counts, { kpis: 4, trends: 4, performance: 4, players: 4 })
    assert.ok(screen.queryByText('Error Loading Data') === null)
  })

  test('an agent sees only the domains it is allowed', async () => {
    auth.isAgent = true
    auth.agent = { allowedDomains: ['casino'] }
    renderPage(allMocks(INITIAL))
    await loaded()

    const group = screen.getByRole('group', { name: 'Domain' })
    assert.deepEqual(
      within(group).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent),
      ['All Domains', 'Casino'],
    )
    assert.deepEqual(guard.calls[0], {
      required: [{ domain: 'reporting.agent-overview', actions: ['view'] }],
      bypassForAgents: true,
    })
  })

  test('applies a preset, a custom range and Reset to the queries and to the export range', async () => {
    const custom = { dateFrom: '2026-01-02', dateTo: '2026-01-04' }
    renderPage([
      ...allMocks(INITIAL),
      ...allMocks(TODAY),
      ...allMocks(custom),
      ...allMocks(INITIAL),
    ])
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Apply Today' }))
    await waitFor(() => assert.equal(counts.players, 2))
    assert.equal(screen.getByTestId('period-state').textContent, 'today|2026-10-07|2026-10-07|custom')
    assert.deepEqual(lastVariables('AgentKPIs'), { filter: { ...store.filters, ...TODAY } })
    assert.deepEqual(lastVariables('AgentPlayerBreakdown'), { filter: TODAY })

    fireEvent.click(screen.getByRole('button', { name: 'Export Report' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export as CSV' }))
    await waitFor(() => assert.deepEqual(feedback.success.mock.calls, [['Export ready! Downloading...']]))
    assert.deepEqual(exportRequests, [
      exportInput('csv', { from: '2026-10-06T18:30:00.000Z', to: '2026-10-07T18:29:59.999Z' }),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Apply Custom' }))
    await waitFor(() => assert.equal(counts.players, 3))
    assert.equal(screen.getByTestId('period-state').textContent, 'custom|2026-01-02|2026-01-04|custom')
    assert.deepEqual(lastVariables('AgentTrends'), { filter: { ...store.filters, ...custom } })

    fireEvent.click(screen.getByRole('button', { name: 'Reset Period' }))
    await waitFor(() => assert.equal(counts.players, 4))
    assert.equal(screen.getByTestId('period-state').textContent, 'last30days|2026-09-07|2026-10-07|custom')

    fireEvent.click(screen.getByRole('button', { name: 'Export Report' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export as Excel' }))
    await waitFor(() => assert.equal(feedback.success.mock.calls.length, 2))
    assert.deepEqual(exportRequests[1], exportInput('xlsx', {
      from: '2026-09-06T18:30:00.000Z',
      to: '2026-10-07T18:29:59.999Z',
    }))
    assert.equal(feedback.error.mock.calls.length, 0)
  })

  test('exports the opening period through the menu with the legacy job input and texts', async () => {
    renderPage(allMocks(INITIAL))
    await loaded()

    const trigger = screen.getByRole('button', { name: 'Export Report' })
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu')
    fireEvent.click(trigger)
    const menu = await screen.findByRole('menu')
    assert.deepEqual(within(menu).getAllByRole('menuitem').map((item) => item.textContent), [
      'Export as CSV',
      'Export as Excel',
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Export as CSV' }))

    await waitFor(() => assert.equal(clicked.length, 1))
    assert.deepEqual(exportRequests, [
      exportInput('csv', { from: '2026-09-07T06:00:00.000Z', to: '2026-10-07T06:00:00.000Z' }),
    ])
    assert.deepEqual(feedback.loading.mock.calls, [['Preparing export...', 0]])
    assert.equal(feedback.hide.mock.calls.length, 1)
    assert.deepEqual(feedback.success.mock.calls, [['Export ready! Downloading...']])
    // The file arrives as a data URI and is saved as a Blob of its type.
    assert.equal(clicked[0].getAttribute('href'), 'blob:report-1')
    assert.equal(savedFiles[0]?.type, 'text/csv')
    assert.match(clicked[0].download, /^export-\d+\.csv$/)
    assert.equal(feedback.error.mock.calls.length, 0)
  })

  test('Refresh refetches the totals only', async () => {
    renderPage([
      ...allMocks(INITIAL),
      kpisMock(INITIAL, { ...KPIS, totalTurnover: 2000000 }),
    ])
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    assert.equal(refresh.getAttribute('aria-busy'), 'true')
    await loaded()
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy'), null))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('₹40,00,000.00')
    assert.deepEqual(counts, { kpis: 2, trends: 1, performance: 1, players: 1 })
  })

  test('shows loading, then each view’s legacy empty copy', async () => {
    renderPage([
      kpisMock(INITIAL, null),
      trendsMock(INITIAL, []),
      performanceMock(INITIAL, []),
      playersMock(INITIAL, []),
    ])
    const pendingTotals = screen.getByRole('group', { name: 'Agent overview totals' })
    assert.equal(pendingTotals.getAttribute('aria-busy'), 'true')
    assert.equal(within(pendingTotals).getAllByText('Loading').length, 4)

    await screen.findByText('No data available for the selected date range')
    assert.equal(screen.queryByRole('group', { name: 'Agent overview totals' }), null)

    fireEvent.click(screen.getByRole('tab', { name: 'Player Activity' }))
    await screen.findByText('No activity data available for the selected date range')
    fireEvent.click(screen.getByRole('tab', { name: 'Top Players' }))
    await screen.findByText('No player data available for the selected date range')
    assert.ok(screen.queryByText('Error Loading Data') === null)
  })

  test('totals without performance rows leave the performance card out', async () => {
    renderPage([kpisMock(INITIAL), trendsMock(INITIAL), performanceMock(INITIAL, []), playersMock(INITIAL)])
    await loaded()
    await waitFor(() => assert.equal(counts.performance, 1))
    assert.equal(screen.queryByRole('heading', { name: 'Agent Performance' }), null)
  })

  test('lists every failed query in one error notice', async () => {
    renderPage([
      { request: kpisMock(INITIAL).request, result: { errors: [new GraphQLError('KPI boom')] } },
      trendsMock(INITIAL),
      performanceMock(INITIAL),
      { request: playersMock(INITIAL).request, result: { errors: [new GraphQLError('Players boom')] } },
    ])

    const alert = await screen.findByRole('alert')
    await waitFor(() => assert.ok(within(alert).getByText('Players: Players boom')))
    assert.ok(within(alert).getByText('Error Loading Data'))
    assert.ok(within(alert).getByText('KPIs: KPI boom'))
    assert.equal(within(alert).queryByText(/^Trends:/), null)
    assert.ok(screen.getByText('No data available for the selected date range'))
    await waitFor(() => assert.deepEqual(feedback.notifyError.mock.calls, [['Players boom', 'Failed to load player breakdown']]))
  })
})
