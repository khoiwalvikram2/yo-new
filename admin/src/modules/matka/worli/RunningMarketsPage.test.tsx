/**
 * /matka/worli mounted against MockedProvider and a MemoryRouter: the exact WorliInstances document,
 * variables and options (cache-and-network, the 5-second poll the Auto-refresh switch turns off), the
 * per-session WorliInstanceUpdated subscriptions and their merge, the matka.worli view guard and its
 * denial, the stats, the quick filters, the persisted filters with Clear all, the table (grouping, paging,
 * navigation), the view tabs and their keyboard model, the card view, and the loading, empty and
 * failed-load states in both views. The RBAC guard, the
 * currency/date formatters and the Apollo client's subscribe are stubs; the store and the kit are real.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useWorliFilters } from '@/state/matkaWorli'
import { todayISTString } from '@/shared/utils/date'
import { WORLI_INSTANCES, WORLI_INSTANCE_UPDATED } from './gql'
import RunningMarketsPage from './RunningMarketsPage'
import type { WorliInstance } from './runningMarketsModel'

interface SubscriptionCall {
  query: unknown
  variables: Record<string, unknown>
  observer?: { next: (value: unknown) => void }
  closed: boolean
}

const apollo = vi.hoisted(() => ({
  queries: [] as Array<{ query: unknown; options: Record<string, unknown> }>,
  subscriptions: [] as SubscriptionCall[],
}))

const rbac = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const client = {
    subscribe: ({ query, variables }: { query: unknown; variables: Record<string, unknown> }) => {
      const call: SubscriptionCall = { query, variables, closed: false }
      apollo.subscriptions.push(call)
      return {
        subscribe: (observer: { next: (value: unknown) => void }) => {
          call.observer = observer
          return {
            unsubscribe: () => {
              call.closed = true
            },
          }
        },
      }
    },
  }
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ query: args[0], options: args[1] as Record<string, unknown> })
      return actual.useQuery(...args)
    },
    useApolloClient: () => client,
  }
})

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    children: ReactNode
  }) => {
    rbac.calls.push(required)
    return rbac.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `₹${amount.toFixed(2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDate: (value: string, pattern = 'default') => `${pattern}|${value}`,
    formatTime: (value: string) => value.slice(11, 16),
  }),
}))

const DATE = '2026-10-07'
const counters = (betCount: number, totalStakeMinor: number, exposureTotalMinor: number) => ({
  betCount,
  totalStakeMinor,
  exposureTotalMinor,
  worstOutcomeKey: null,
  worstOutcomePlMinor: null,
})

function session(patch: Partial<WorliInstance> & { id: string }): WorliInstance {
  return {
    marketId: 'm1',
    marketName: 'Kalyan Worli',
    runDate: DATE,
    side: 'OPEN',
    status: 'OPEN',
    scheduledOpenAt: '2026-10-07T04:00:00.000Z',
    scheduledLockAt: '2026-10-07T05:30:00.000Z',
    scheduledCloseAt: '2026-10-07T06:00:00.000Z',
    operatorMessage: null,
    counters: counters(0, 0, 0),
    bidRulesVersionId: null,
    ...patch,
  }
}

const SESSIONS: WorliInstance[] = [
  session({ id: 'o1', counters: counters(3, 150000, 1200000) }),
  session({
    id: 'c1',
    side: 'CLOSE',
    status: 'SCHEDULED',
    scheduledOpenAt: '2026-10-07T08:00:00.000Z',
    counters: counters(1, 5000, 20000),
  }),
  session({ id: 'o2', marketId: 'm2', marketName: 'Milan Worli', status: 'PAUSED' }),
]

interface Filters {
  date: string
  marketId?: string
  status: string[]
  search?: string
  hasResult?: boolean
  sort?: string
}

const server = vi.hoisted(() => ({ requests: [] as Array<Record<string, unknown>> }))

function variablesFor(filters: Filters) {
  return {
    date: filters.date,
    marketId: filters.marketId,
    status: filters.status,
    search: filters.search,
    hasResult: filters.hasResult,
    page: 1,
    limit: 50,
    sort: filters.sort,
  }
}

const BASE: Filters = { date: DATE, status: [], search: '', sort: 'closeAt:asc' }

function listMock(filters: Partial<Filters> = {}, items: WorliInstance[] = SESSIONS): MockedResponse {
  const variables = variablesFor({ ...BASE, ...filters })
  return {
    request: { query: WORLI_INSTANCES, variables },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.requests.push(variables)
      return { data: { worliRunningInstances: { total: items.length, items } } }
    },
  }
}

function DetailProbe() {
  const { id } = useParams()
  return <p>{`Detail route ${id}`}</p>
}

function renderPage(mocks: MockedResponse[]) {
  return render(
    <MemoryRouter initialEntries={['/matka/worli']}>
      <MockedProvider mocks={mocks} addTypename={false}>
        <PageEyebrowProvider value="Trading">
          <Routes>
            <Route path="/matka/worli" element={<RunningMarketsPage />} />
            <Route path="/matka/worli/:id" element={<DetailProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MockedProvider>
    </MemoryRouter>,
  )
}

function lastListOptions() {
  const calls = apollo.queries.filter((call) => call.query === WORLI_INSTANCES)
  return calls[calls.length - 1]?.options
}

const stats = () => within(screen.getByRole('group', { name: 'Market statistics' }))
const statValue = (label: string) => {
  const labelNode = stats().getByText(label)
  return (labelNode.nextElementSibling as HTMLElement).textContent
}
const table = () => screen.getByRole('table')
const appliedStatus = () => screen.getByText(/^\d+ filters? applied$/)
const summary = () =>
  screen.getByText((_, element) => element?.tagName === 'P' && /^Showing /.test(element.textContent ?? ''))

/* Elements are compared by identity: a node:assert diff of a jsdom element can exhaust the worker. */
function assertAbsent(element: Element | null, what = 'element') {
  assert.ok(element === null, `${what} should be absent`)
}
beforeEach(() => {
  apollo.queries.length = 0
  apollo.subscriptions.length = 0
  rbac.allowed = true
  rbac.calls.length = 0
  server.requests.length = 0
  useWorliFilters.setState({
    date: DATE,
    marketId: undefined,
    status: [],
    search: '',
    hasResult: undefined,
    sort: 'closeAt:asc',
  })
})

describe('RunningMarketsPage', () => {
  test('loads the sessions with the legacy document, variables and options, and renders the page', async () => {
    renderPage([listMock()])
    await screen.findByRole('button', { name: 'Kalyan Worli' })

    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Worli Running Markets' }))
    assert.ok(screen.queryByText('Monitor and manage today’s Worli sessions (Open/Close)') === null)
    assert.ok(screen.queryByText('Trading') === null)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Worli Running Markets' }))
    assert.deepEqual(rbac.calls[0], [{ domain: 'matka.worli', actions: ['view'] }])

    assert.deepEqual(lastListOptions(), {
      variables: variablesFor(BASE),
      fetchPolicy: 'cache-and-network',
      pollInterval: 5000,
    })

    assert.equal(statValue('Open'), '1')
    assert.equal(statValue('Markets'), '3')
    assert.equal(statValue('Exposure'), '₹12200.00')
    assert.equal(statValue('Bets'), '4')

    // One row per market and day; the OPEN and CLOSE sessions of m1 merge.
    const body = within(table()).getAllByRole('row').slice(1)
    assert.equal(body.length, 2)
    const kalyan = within(body[0])
    assert.ok(kalyan.getByText('dd MMM yyyy|2026-10-07'))
    assert.ok(kalyan.getByText('O: OPEN'))
    assert.ok(kalyan.getByText('C: SCHEDULED'))
    assert.ok(kalyan.getByText('4 bets total'))
    assert.ok(kalyan.getByText('₹1550.00'))
    assert.ok(kalyan.getByText('Normal volume'))
    assert.ok(kalyan.getByText('₹12200.00'))
    assert.ok(kalyan.getByRole('img', { name: 'Live' }))
    assert.ok(kalyan.getByText('04:00'))
    assert.ok(kalyan.getByText('08:00'))
    const milan = within(body[1])
    assert.ok(milan.getByText('O: PAUSED'))
    assert.ok(milan.getByText('C: N/A'))
    assert.ok(milan.getByText('PAUSED'))
    assertAbsent(milan.queryByRole('img', { name: 'Live' }))
    assert.equal(summary().textContent, 'Showing 1–2 of 2 markets')

    // One WorliInstanceUpdated subscription per session, keyed by its id.
    assert.deepEqual(
      apollo.subscriptions.map((call) => [call.query === WORLI_INSTANCE_UPDATED, call.variables]),
      [
        [true, { id: 'o1' }],
        [true, { id: 'c1' }],
        [true, { id: 'o2' }],
      ],
    )
  })

  test('a denied caller sees the denial; nothing is queried or subscribed', () => {
    rbac.allowed = false
    renderPage([listMock()])
    assert.deepEqual(rbac.calls, [[{ domain: 'matka.worli', actions: ['view'] }]])
    assert.equal(screen.getByRole('alert').textContent, 'Access denied')
    assert.equal(apollo.queries.length, 0)
    assert.equal(apollo.subscriptions.length, 0)
  })

  test('a session update from the subscription merges into its row and the stats', async () => {
    renderPage([listMock()])
    await screen.findByRole('button', { name: 'Kalyan Worli' })
    const o1 = apollo.subscriptions.find((call) => call.variables.id === 'o1')
    assert.ok(o1?.observer)

    act(() => {
      o1.observer?.next({ data: { worliInstanceUpdated: { id: 'o1', status: 'LOCKED' } } })
    })

    await waitFor(() => assert.ok(within(table()).getByText('O: LOCKED')))
    assert.equal(statValue('Open'), '0')
    // An empty payload changes nothing.
    act(() => {
      o1.observer?.next({ data: { worliInstanceUpdated: null } })
    })
    assert.ok(within(table()).getByText('O: LOCKED'))
  })

  test('quick filters narrow the sessions and the stats, and picking the active one clears it', async () => {
    renderPage([listMock()])
    await screen.findByRole('button', { name: 'Kalyan Worli' })
    const quick = within(screen.getByRole('group', { name: 'Quick filters' }))

    fireEvent.click(quick.getByRole('button', { name: 'Live' }))
    assert.equal(quick.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed'), 'true')
    assert.equal(statValue('Markets'), '1')
    assert.equal(statValue('Exposure'), '₹12000.00')
    assert.equal(within(table()).getAllByRole('row').length, 2)
    assert.ok(within(table()).getByText('C: N/A'))
    assert.equal(appliedStatus().textContent, '1 filter applied')

    fireEvent.click(quick.getByRole('button', { name: 'Paused' }))
    assert.equal(quick.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed'), 'false')
    assert.ok(screen.getByRole('button', { name: 'Milan Worli' }))
    assertAbsent(screen.queryByRole('button', { name: 'Kalyan Worli' }))

    fireEvent.click(quick.getByRole('button', { name: 'Paused' }))
    assert.equal(statValue('Markets'), '3')
    // No query was sent for a quick filter: it works on the rows already loaded.
    assert.deepEqual(lastListOptions()?.variables, variablesFor(BASE))
  })

  test('search, statuses, Has result, date and sort reach the query; Clear all keeps the date and sort', async () => {
    renderPage([
      listMock(),
      listMock({ search: 'kal' }),
      listMock({ search: 'kal', sort: 'bets:desc' }),
      listMock({ search: 'kal', sort: 'bets:desc', hasResult: true }),
      listMock({ search: 'kal', sort: 'bets:desc', hasResult: true, date: '2026-10-05' }),
      listMock({ search: 'kal', sort: 'bets:desc', hasResult: true, date: '2026-10-05', status: ['OPEN'] }),
      listMock({ sort: 'bets:desc', date: '2026-10-05' }),
      listMock({ sort: 'bets:desc', date: todayISTString() }),
    ])
    await screen.findByRole('button', { name: 'Kalyan Worli' })

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search markets' }), { target: { value: 'kal' } })
    await waitFor(() => assert.deepEqual(lastListOptions()?.variables, variablesFor({ ...BASE, search: 'kal' })))

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'bets:desc' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Has result' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-05' } })
    act(() => useWorliFilters.getState().setStatus(['OPEN']))
    const filtered = { ...BASE, search: 'kal', sort: 'bets:desc', hasResult: true, date: '2026-10-05', status: ['OPEN'] }
    await waitFor(() => assert.deepEqual(lastListOptions()?.variables, variablesFor(filtered)))
    assert.equal(appliedStatus().textContent, '3 filters applied')

    fireEvent.click(within(screen.getByRole('group', { name: 'Quick filters' })).getByRole('button', { name: 'Live' }))
    assert.equal(appliedStatus().textContent, '4 filters applied')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    const cleared = { ...BASE, sort: 'bets:desc', date: '2026-10-05' }
    await waitFor(() => assert.deepEqual(lastListOptions()?.variables, variablesFor(cleared)))
    assert.equal(appliedStatus().textContent, '0 filters applied')
    assert.equal(
      within(screen.getByRole('group', { name: 'Quick filters' })).getByRole('button', { name: 'Live' }).getAttribute('aria-pressed'),
      'false',
    )

    // Clearing the date picks today in IST, as the legacy picker's clear did.
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } })
    await waitFor(() => assert.equal(useWorliFilters.getState().date, todayISTString()))
  })

  test('Auto-refresh turns the 5-second poll off and back on; Refresh data asks again', async () => {
    renderPage([listMock()])
    await screen.findByRole('button', { name: 'Kalyan Worli' })
    const toggle = screen.getByRole('switch', { name: 'Auto-refresh' })
    assert.equal(toggle.getAttribute('aria-checked'), 'true')

    fireEvent.click(toggle)
    assert.equal(lastListOptions()?.pollInterval, 0)
    fireEvent.click(toggle)
    assert.equal(lastListOptions()?.pollInterval, 5000)

    const before = server.requests.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }))
    })
    await waitFor(() => assert.ok(server.requests.length > before))
  })

  test('the market name and View Details open the OPEN session, else the CLOSE one', async () => {
    renderPage([
      listMock({}, [...SESSIONS, session({ id: 'c3', marketId: 'm3', marketName: 'Night Worli', side: 'CLOSE' })]),
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Night Worli' }))
    await screen.findByText('Detail route c3')
  })

  test('View Details on a row navigates to the session detail', async () => {
    renderPage([listMock()])
    await screen.findByRole('button', { name: 'Kalyan Worli' })
    fireEvent.click(screen.getAllByRole('button', { name: 'View Details' })[0])
    await screen.findByText('Detail route o1')
  })

  test('the table pages 25 markets at a time on the client', async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      session({ id: `s${index}`, marketId: `m${index}`, marketName: `Market ${index}` }),
    )
    renderPage([listMock({}, many)])
    await screen.findByRole('button', { name: 'Market 0' })
    assert.equal(summary().textContent, 'Showing 1–25 of 30 markets')
    assert.equal(within(table()).getAllByRole('row').length, 26)

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    assert.equal(summary().textContent, 'Showing 26–30 of 30 markets')
    assert.ok(screen.getByRole('button', { name: 'Market 29' }))

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '10' } })
    assert.equal(summary().textContent, 'Showing 1–10 of 30 markets')
  })

  test('the view switch is one tab stop whose arrow keys switch the card body, labelled as its tab panel', async () => {
    renderPage([listMock()])
    await screen.findByRole('button', { name: 'Kalyan Worli' })
    const views = within(screen.getByRole('tablist', { name: 'View' }))
    const tableTab = views.getByRole('tab', { name: 'Table View' })
    const cardTab = views.getByRole('tab', { name: 'Card View' })
    assert.equal(tableTab.getAttribute('aria-selected'), 'true')
    assert.equal(tableTab.getAttribute('tabindex'), '0')
    assert.equal(cardTab.getAttribute('tabindex'), '-1')
    const panel = screen.getByRole('tabpanel', { name: 'Table View' })
    assert.equal(tableTab.getAttribute('aria-controls'), panel.id)
    assert.ok(panel.contains(table()))

    tableTab.focus()
    fireEvent.keyDown(tableTab, { key: 'ArrowRight' })
    assert.equal(cardTab.getAttribute('aria-selected'), 'true')
    assert.ok(document.activeElement === cardTab, 'focus follows the selection')
    assert.ok(within(screen.getByRole('tabpanel', { name: 'Card View' })).getByRole('list', { name: 'Worli sessions' }))
    assertAbsent(screen.queryByRole('table'))

    fireEvent.keyDown(cardTab, { key: 'Home' })
    assert.equal(tableTab.getAttribute('aria-selected'), 'true')
    assert.ok(screen.getByRole('table'))
  })

  test('the card view shows one tile per session and opens its detail', async () => {
    renderPage([listMock()])
    await screen.findByRole('button', { name: 'Kalyan Worli' })
    fireEvent.click(screen.getByRole('tab', { name: 'Card View' }))

    const tiles = within(screen.getByRole('list', { name: 'Worli sessions' })).getAllByRole('listitem')
    assert.equal(tiles.length, 3)
    const first = within(tiles[0])
    assert.ok(first.getByRole('heading', { level: 3, name: 'Kalyan Worli' }))
    assert.ok(first.getByText('Date: default|2026-10-07 • OPEN'))
    assert.ok(first.getByText('Lock time 05:30'))
    assert.ok(first.getByText('Close time 06:00'))
    assert.ok(first.getByText('₹12000.00'))
    assertAbsent(screen.queryByRole('table'))

    fireEvent.click(within(tiles[1]).getByRole('button', { name: 'View Details' }))
    await screen.findByText('Detail route c1')
  })

  test('loading and empty say so, in both views', async () => {
    renderPage([listMock({}, [])])
    assert.ok(screen.getByText('Loading Worli markets'))
    await screen.findByText('No markets found')
    assert.equal(statValue('Markets'), '0')
    fireEvent.click(screen.getByRole('tab', { name: 'Card View' }))
    assert.ok(screen.getByText('Try changing filters or date'))
  })

  test('a failed load in the card view shows the reason with Retry, which asks again', async () => {
    renderPage([
      {
        request: { query: WORLI_INSTANCES, variables: variablesFor(BASE) },
        error: new Error('Response not successful: Received status code 502'),
      },
      listMock(),
    ])
    fireEvent.click(screen.getByRole('tab', { name: 'Card View' }))
    await screen.findByText('Failed to load Worli markets: Response not successful: Received status code 502')
    const panel = within(screen.getByRole('tabpanel', { name: 'Card View' }))
    assertAbsent(screen.queryByRole('table'))
    assertAbsent(panel.queryByText('No markets found'))
    await act(async () => {
      fireEvent.click(panel.getByRole('button', { name: 'Retry' }))
    })
    const tiles = await screen.findByRole('list', { name: 'Worli sessions' })
    assert.equal(within(tiles).getAllByRole('listitem').length, 3)
  })

  test('a failed load shows the reason with Retry, which asks again', async () => {
    renderPage([
      {
        request: { query: WORLI_INSTANCES, variables: variablesFor(BASE) },
        error: new Error('Response not successful: Received status code 502'),
      },
      listMock(),
    ])
    await screen.findByText('Failed to load Worli markets: Response not successful: Received status code 502')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    await screen.findByRole('button', { name: 'Kalyan Worli' })
  })
})
