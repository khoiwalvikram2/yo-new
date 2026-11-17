/**
 * /sports/events against a mocked GraphQL server: MockedProvider with a link that answers RunningEvents and
 * records every variable set it is sent (the document itself stays in lib/graphql/sports.ts, untouched).
 * Covers the query's variables, its 5-second poll and network-only policy; the RBAC guard with
 * bypassForAgents (and that a denied caller starts no query); search, the quick filters and the staged
 * Advanced Filters with their presets, Reset and Clear All; the header figures; the table and cards views
 * and the saved view; Refresh and auto-refresh; and the loading, empty and error states.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useSportsEventsStore } from '@/state/sportsEventsStore'
import type { SportsEvent } from './eventsPageModel'
import EventsPage from './EventsPage'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  requireAny?: boolean
  bypassForAgents?: boolean
}

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
}

const guard = vi.hoisted(() => ({ allowed: true, calls: [] as GuardCall[] }))
const hookOptions = vi.hoisted(() => ({ calls: [] as Array<{ pollInterval?: number; fetchPolicy?: string }> }))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, requireAny, bypassForAgents, children }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required, requireAny, bypassForAgents })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `₹${amount.toFixed(2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount,
    getCurrencySymbol: () => '₹',
  }),
}))

vi.mock('@/shared/core/useFormatDate', async () => {
  const { formatInTimeZone } = await import('@/shared/utils/date')
  return {
    useFormatDate: () => ({
      formatDate: (value: string, pattern = 'dd MMM yyyy') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
      formatDateTime: (value: string, pattern = 'dd MMM yyyy HH:mm') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
    }),
  }
})

// The page's own hook call is the real one; this records the options it passes (poll and fetch policy).
vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const useQuery = ((query: Parameters<typeof actual.useQuery>[0], options?: Parameters<typeof actual.useQuery>[1]) => {
    hookOptions.calls.push({ pollInterval: options?.pollInterval, fetchPolicy: options?.fetchPolicy })
    return actual.useQuery(query, options)
  }) as typeof actual.useQuery
  return { ...actual, useQuery }
})

/* ---------- the mocked server ---------- */

// 2026-10-07 17:30 IST
const NOW = Date.parse('2026-10-07T12:00:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const at = (ms: number) => new Date(NOW + ms).toISOString()

function sportsEvent(id: string, overrides: Partial<SportsEvent> = {}): SportsEvent {
  return {
    id,
    sport: 'Cricket',
    competition: 'IPL',
    name: `Event ${id}`,
    startTime: at(2 * HOUR),
    status: 'active',
    marketCount: 10,
    totalLiquidity: 500,
    matchedVolume: 0,
    betsCount: 1,
    inPlay: false,
    updatedAt: at(-HOUR),
    lastBetAt: null,
    ...overrides,
  }
}

const FOUR: SportsEvent[] = [
  sportsEvent('e1', {
    name: 'India vs Australia',
    inPlay: true,
    startTime: at(-2 * HOUR),
    marketCount: 64,
    totalLiquidity: 1_240_000,
    matchedVolume: 900_000,
    betsCount: 1234,
    lastBetAt: at(-5 * MINUTE),
  }),
  sportsEvent('e2', {
    name: 'Man City vs Arsenal',
    sport: 'Football',
    competition: 'EPL',
    startTime: at(30 * MINUTE),
    marketCount: 21,
    totalLiquidity: 150_000,
    betsCount: 0,
  }),
  sportsEvent('e3', {
    name: 'Alcaraz vs Sinner',
    sport: 'Tennis',
    competition: 'Wimbledon',
    status: 'suspended',
    startTime: at(26 * HOUR),
    marketCount: 5,
    totalLiquidity: 800,
    betsCount: 3,
    lastBetAt: at(-3 * HOUR),
  }),
  sportsEvent('e4', {
    name: 'Lakers vs Celtics',
    sport: 'Basketball',
    competition: 'NBA',
    status: 'finished',
    startTime: at(-5 * HOUR),
    marketCount: 30,
    totalLiquidity: 50_000,
    betsCount: 12,
    lastBetAt: at(-9 * 24 * HOUR),
  }),
]

interface ServerState {
  calls: ServerCall[]
  events: SportsEvent[]
  error: Error | null
}

let server: ServerState

function calls() {
  return server.calls.filter((call) => call.operationName === 'RunningEvents')
}

/** Variables as they travel: undefined keys dropped. */
function lastSent() {
  const list = calls()
  return JSON.parse(JSON.stringify(list[list.length - 1]?.variables ?? null)) as Record<string, unknown>
}

function serverLink() {
  return new ApolloLink((operation: Operation) => new Observable<FetchResult>((observer) => {
    server.calls.push({ operationName: operation.operationName, variables: { ...operation.variables } })
    Promise.resolve().then(() => {
      if (operation.operationName !== 'RunningEvents') {
        observer.error(new Error(`unexpected operation ${operation.operationName}`))
        return
      }
      if (server.error) {
        observer.error(server.error)
        return
      }
      observer.next({
        data: { runningEvents: server.events.map((event) => ({ __typename: 'RunningEvent', ...event })) },
      })
      observer.complete()
    })
  }))
}

function renderPage(path = '/sports/events') {
  return render(
    <MockedProvider link={serverLink()}>
      <MemoryRouter initialEntries={[path]}>
        <PageEyebrowProvider value="Trading">
          <Routes>
            <Route path="/sports/events" element={<EventsPage />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function table() {
  return screen.getByRole('table', { name: 'Events' })
}

function bodyRows() {
  const [, ...rows] = within(table()).getAllByRole('row')
  return rows
}

function rowNames() {
  return bodyRows().map((row) => within(row).getAllByRole('link')[0].textContent)
}

async function renderLoaded() {
  const view = renderPage()
  await waitFor(() => assert.equal(rowNames().length, server.events.length))
  return view
}

function stat(label: string) {
  const group = screen.getByRole('group', { name: 'Event statistics' })
  return within(group).getByText(label).nextElementSibling?.textContent
}

function quick(name: string) {
  return within(screen.getByRole('group', { name: 'Quick filters' })).getByRole('button', { name })
}

function combobox(name: string) {
  return screen.getByRole('combobox', { name }) as HTMLInputElement
}

function choose(fieldName: string, optionName: string) {
  fireEvent.keyDown(combobox(fieldName), { key: 'ArrowDown' })
  fireEvent.click(within(screen.getByRole('listbox', { name: fieldName })).getByRole('option', { name: optionName }))
}

function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  return screen.getByRole('region', { name: 'Advanced Filters' })
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  guard.allowed = true
  guard.calls.length = 0
  hookOptions.calls.length = 0
  server = { calls: [], events: [...FOUR], error: null }
  useSportsEventsStore.setState({ favoriteEvents: new Set<string>(), viewMode: 'table' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EventsPage', () => {
  test('asks RunningEvents with no filter, polling every 5 seconds, network-only', async () => {
    await renderLoaded()
    assert.equal(calls().length, 1)
    assert.deepEqual(lastSent(), {})
    assert.deepEqual(hookOptions.calls[0], { pollInterval: 5000, fetchPolicy: 'network-only' })
  })

  test('renders one h1, the five figures and the events table', async () => {
    await renderLoaded()
    assert.deepEqual(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent), ['Sports Events'])
    assert.ok(screen.queryByText('Trading') === null)
    assert.ok(screen.queryByText('Monitor and manage live and upcoming sporting events') === null)
    assert.deepEqual(
      ['Live', 'Markets', 'Bets', 'Liability', 'Active'].map(stat),
      ['1', '120', (1249).toLocaleString(), '₹1.4M', '1'],
    )
    const card = screen.getByRole('region', { name: 'Events Management' })
    assert.ok(within(card).getByText('4 events'))
    assert.deepEqual(rowNames(), ['India vs Australia', 'Man City vs Arsenal', 'Alcaraz vs Sinner', 'Lakers vs Celtics'])
    assert.equal(screen.getByRole('link', { name: 'View Lakers vs Celtics' }).getAttribute('href'), '/sports/event/e4')
  })

  test('the guard requires sports.events view and lets agents through; a denied caller starts no query', async () => {
    const first = await renderLoaded()
    assert.deepEqual(guard.calls[0], {
      required: [{ domain: 'sports.events', actions: ['view'] }],
      requireAny: undefined,
      bypassForAgents: true,
    })
    first.unmount()

    guard.allowed = false
    server.calls.length = 0
    hookOptions.calls.length = 0
    renderPage()
    assert.ok(screen.getAllByRole('alert').some((node) => node.textContent === 'Access denied'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(server.calls.length, 0)
    assert.equal(hookOptions.calls.length, 0)
  })

  test('search matches names and competitions here, without a new query', async () => {
    await renderLoaded()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search events' }), { target: { value: 'epl' } })
    assert.deepEqual(rowNames(), ['Man City vs Arsenal'])
    assert.ok(screen.getByText('1 event'))
    assert.equal(stat('Markets'), '21', 'the figures follow the filtered list')
    assert.equal(calls().length, 1)
    assert.equal(screen.getByRole('button', { name: 'Filters, 1 applied' }).getAttribute('aria-expanded'), 'false')
  })

  test('a link with ?search= (the global search "See all Sports") opens the list already searched', async () => {
    renderPage('/sports/events?search=epl')
    await waitFor(() => assert.deepEqual(rowNames(), ['Man City vs Arsenal']))
    assert.equal((screen.getByRole('searchbox', { name: 'Search events' }) as HTMLInputElement).value, 'epl')
    assert.equal(calls().length, 1, 'the search runs here, over the one RunningEvents answer')
  })

  test('the quick filters apply one at a time and a second press clears them', async () => {
    await renderLoaded()
    fireEvent.click(quick('Live'))
    assert.equal(quick('Live').getAttribute('aria-pressed'), 'true')
    assert.deepEqual(rowNames(), ['India vs Australia'])
    fireEvent.click(quick('Live'))
    assert.equal(quick('Live').getAttribute('aria-pressed'), 'false')
    assert.equal(rowNames().length, 4)

    fireEvent.click(quick('High Liquidity'))
    assert.deepEqual(rowNames(), ['India vs Australia', 'Man City vs Arsenal'])
    fireEvent.click(quick('Starting Soon'))
    assert.equal(quick('High Liquidity').getAttribute('aria-pressed'), 'false')
    assert.deepEqual(rowNames(), ['Man City vs Arsenal'])

    fireEvent.click(quick('Starting Soon'))
    fireEvent.click(screen.getByRole('button', { name: 'Add Alcaraz vs Sinner to favorites' }))
    fireEvent.click(quick('Favorite'))
    assert.deepEqual(rowNames(), ['Alcaraz vs Sinner'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alcaraz vs Sinner from favorites' }))
    assert.ok(screen.getByText('No events found'), 'un-starring leaves the Favorite list at once')
    assert.equal(calls().length, 1, 'quick filters never query')
  })

  test('Advanced Filters: Apply sends the sport and the IST range; status and competition filter here; Reset sends none', async () => {
    await renderLoaded()
    const toggle = screen.getByRole('button', { name: 'Filters' })
    const panel = openFilters()
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')
    assert.equal(toggle.getAttribute('aria-controls'), panel.id)
    assert.ok(within(panel).getByText('Refine your search with detailed filter criteria'))
    assert.equal((within(panel).getByRole('button', { name: 'Clear All' }) as HTMLButtonElement).disabled, true)

    choose('Sport Type', 'Football')
    assert.equal(calls().length, 1, 'nothing applies before Apply')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.deepEqual(lastSent(), { sport: 'Football' }))
    await waitFor(() => assert.equal(rowNames().length, 4))

    // Finished is a status the server reports (Closed and Suspended were offered and matched nothing).
    choose('Event Status', 'Finished')
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-07T17:30' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-08T17:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      assert.deepEqual(lastSent(), {
        sport: 'Football',
        from: '2026-10-07T12:00:00.000Z',
        to: '2026-10-08T12:00:00.000Z',
      }),
    )
    await waitFor(() => assert.deepEqual(rowNames(), ['Lakers vs Celtics']))
    assert.ok(screen.getByRole('button', { name: 'Filters, 3 applied' }))
    assert.ok(within(panel).getByText('3 applied'))

    choose('Competition', 'Wimbledon')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.ok(screen.getByText('No events found')))

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => assert.deepEqual(lastSent(), {}))
    await waitFor(() => assert.equal(rowNames().length, 4))
    assert.ok(screen.getByRole('button', { name: 'Filters' }))
  })

  test('a preset applies its one filter and drops every other', async () => {
    await renderLoaded()
    openFilters()
    choose('Sport Type', 'Tennis')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.deepEqual(lastSent(), { sport: 'Tennis' }))

    fireEvent.click(screen.getByRole('button', { name: 'Live Now' }))
    await waitFor(() => assert.deepEqual(lastSent(), {}))
    await waitFor(() => assert.deepEqual(rowNames(), ['India vs Australia']))
    assert.equal(combobox('Sport Type').value, '')
    assert.equal(combobox('Event Status').value, 'In-Play')

    fireEvent.click(screen.getByRole('button', { name: 'Cricket Only' }))
    await waitFor(() => assert.deepEqual(lastSent(), { sport: 'Cricket' }))
    await waitFor(() => assert.equal(rowNames().length, 4, 'the status filter went with the preset'))

    fireEvent.click(screen.getByRole('button', { name: 'Next 24h' }))
    await waitFor(() =>
      assert.deepEqual(lastSent(), { from: '2026-10-07T12:00:00.000Z', to: '2026-10-08T12:00:00.000Z' }),
    )
  })

  test('an incomplete range is refused with a message and no query', async () => {
    await renderLoaded()
    openFilters()
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-07T17:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.ok(screen.getAllByRole('alert').some((node) => node.textContent === 'Choose an end date'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(calls().length, 1)
  })

  test('Clear All clears the filters, the search, the quick filter and the open form', async () => {
    await renderLoaded()
    const panel = openFilters()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search events' }), { target: { value: 'a' } })
    fireEvent.click(quick('Live'))
    choose('Sport Type', 'Cricket')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.deepEqual(lastSent(), { sport: 'Cricket' }))
    assert.ok(screen.getByRole('button', { name: 'Filters, 3 applied' }))

    fireEvent.click(within(panel).getByRole('button', { name: 'Clear All' }))
    await waitFor(() => assert.deepEqual(lastSent(), {}))
    assert.equal((screen.getByRole('searchbox', { name: 'Search events' }) as HTMLInputElement).value, '')
    assert.equal(quick('Live').getAttribute('aria-pressed'), 'false')
    assert.equal(combobox('Sport Type').value, '', 'the open form is emptied too')
    assert.equal((within(panel).getByRole('button', { name: 'Clear All' }) as HTMLButtonElement).disabled, true)
    await waitFor(() => assert.equal(rowNames().length, 4))
  })

  test('the panel reopens on the filters in force', async () => {
    await renderLoaded()
    openFilters()
    // The competitions offered are those of the loaded events.
    fireEvent.keyDown(combobox('Competition'), { key: 'ArrowDown' })
    assert.deepEqual(
      within(screen.getByRole('listbox', { name: 'Competition' })).getAllByRole('option').map((option) => option.textContent),
      ['EPL', 'IPL', 'NBA', 'Wimbledon'],
    )
    fireEvent.keyDown(combobox('Competition'), { key: 'Escape' })
    choose('Competition', 'Wimbledon')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.deepEqual(rowNames(), ['Alcaraz vs Sinner'])
    fireEvent.click(screen.getByRole('button', { name: 'Filters, 1 applied' }))
    assert.equal(screen.queryByRole('region', { name: 'Advanced Filters' }), null)
    fireEvent.click(screen.getByRole('button', { name: 'Filters, 1 applied' }))
    assert.equal(combobox('Competition').value, 'Wimbledon')
  })

  test('switches to the cards and back, keeping the choice in the saved view', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('tab', { name: 'Cards' }))
    assert.equal(useSportsEventsStore.getState().viewMode, 'cards')
    assert.equal(screen.queryByRole('table', { name: 'Events' }), null)
    const panel = screen.getByRole('tabpanel', { name: 'Cards' })
    const tiles = within(within(panel).getByRole('list', { name: 'Events' })).getAllByRole('listitem')
    assert.equal(tiles.length, 4)

    const [live, soon] = tiles
    assert.equal(within(live).getByRole('heading', { level: 3 }).textContent, 'India vs Australia')
    assert.ok(within(live).getByText('Live Now'))
    assert.ok(within(live).getByText('IN PLAY'))
    assert.ok(within(live).getByText('ACTIVE'))
    assert.ok(within(live).getByText('5m ago'))
    assert.ok(within(live).getByText('₹1.2M'))
    assert.ok(within(live).getByText((1234).toLocaleString()))
    assert.equal(within(live).getByRole('meter', { name: 'Liquidity health' }).getAttribute('aria-valuenow'), '100')
    assert.equal(
      within(live).getByRole('link', { name: 'View details for India vs Australia' }).getAttribute('href'),
      '/sports/event/e1',
    )
    assert.ok(within(soon).getByText('30m'))
    assert.ok(within(soon).getByText('Oct 7, 18:00'))
    assert.equal(within(soon).queryByText('Last Bet'), null, 'no Last Bet row without a bet')

    fireEvent.click(screen.getByRole('tab', { name: 'Table' }))
    assert.equal(useSportsEventsStore.getState().viewMode, 'table')
    assert.equal(rowNames().length, 4)
  })

  test('any saved view other than the table shows the cards, as before', async () => {
    useSportsEventsStore.setState({ viewMode: 'grid' as unknown as 'cards' })
    renderPage()
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 4))
    assert.equal(screen.getByRole('tab', { name: 'Cards' }).getAttribute('aria-selected'), 'true')
  })

  test('Refresh asks again; the auto-refresh switch turns the 5-second poll off and on', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(calls().length, 2))

    const toggle = screen.getByRole('switch', { name: 'Auto-refresh' })
    assert.equal(toggle.getAttribute('aria-checked'), 'true')
    fireEvent.click(toggle)
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    assert.equal(hookOptions.calls[hookOptions.calls.length - 1]?.pollInterval, 0)
    fireEvent.click(toggle)
    assert.equal(hookOptions.calls[hookOptions.calls.length - 1]?.pollInterval, 5000)
  })

  test('loading first, then the empty state', async () => {
    server.events = []
    renderPage()
    assert.ok(screen.getByText('Loading Events'))
    await waitFor(() => assert.ok(screen.getByText('No events found')))
    assert.ok(screen.getByText('Try adjusting your filters or search query'))
    assert.ok(screen.getByText('0 events'))
  })

  test('a failed request says so in the table and Retry asks again', async () => {
    server.error = new Error('Network down')
    renderPage()
    await waitFor(() => assert.ok(screen.getByText('Network down')))
    server.error = null
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.equal(rowNames().length, 4))
  })

  test('the cards view: loading, the error with Retry, and the empty state', async () => {
    useSportsEventsStore.setState({ viewMode: 'cards' })
    server.error = new Error('Network down')
    renderPage()
    assert.ok(screen.getByText('Loading Events'))
    await waitFor(() => assert.ok(screen.getByText('Network down')))
    server.error = null
    server.events = []
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.ok(screen.getByText('No events found')))
  })
})
