/**
 * /reporting/players/nth-dw mounted against MockedProvider (real documents, exact variables: an unmatched
 * request fails the query) and a MemoryRouter. It pins the three documents with their legacy variables,
 * skip and policies; the RBAC requirement with its agent bypass; the per-player rows and the KPI figures;
 * the server paging, the debounced search and the period variables; the page-local sort; Refresh; and the
 * loading, empty and error states. Currency and the RBAC guard are stubbed; the clock is fixed at 12:00
 * IST on 7 Oct 2026.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { DocumentNode } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import NthDepositWithdrawalReportPage from './NthDepositWithdrawalReportPage'
import styles from './NthDepositWithdrawalReportPage.module.css'
import {
  OVERVIEW_KPIS_QUERY,
  PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY,
  USERS_PAGE_QUERY,
} from './nthDepositWithdrawalQueries'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  bypassForAgents?: boolean
}

const apollo = vi.hoisted(() => ({
  queries: [] as Array<{ name: string; options: Record<string, unknown> }>,
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

interface User {
  __typename: 'User'
  id: string
  name: string
  phone: string | null
  username: string
  parentAgent: { __typename: 'Agent'; id: string; username: string } | null
}

/* 45 players. Player 2 has no name (the legacy row reads it as a dash), player 3 has no figures, player
   4 has no agent. */
function user(n: number): User {
  return {
    __typename: 'User',
    id: String(n),
    name: n === 2 ? '' : `Player ${n}`,
    phone: n === 1 ? '9800000001' : null,
    username: `user_${n}`,
    parentAgent: n === 4 ? null : { __typename: 'Agent', id: `a${n % 3}`, username: `desk_${n % 3}` },
  }
}
const USERS = Array.from({ length: 45 }, (_, index) => user(index + 1))
const ASHA: User = { ...user(99), name: 'Asha Rao' }

function stats(ids: string[]) {
  return ids
    .filter((id) => id !== '3')
    .map((id) => ({
      __typename: 'PlayerDepositWithdrawalStats',
      playerId: id,
      totalDepositAmount: Number(id) * 1000,
      totalDepositCount: 1,
      totalWithdrawalAmount: Number(id) * 500,
      totalWithdrawalCount: 1,
      rangeDepositAmount: Number(id) * 100,
      rangeDepositCount: 1,
      rangeWithdrawalAmount: Number(id) * 50,
      rangeWithdrawalCount: 1,
    }))
}

type Counters = Record<string, number>

function counted(name: string, counters: Counters, payload: () => Record<string, unknown>) {
  return () => {
    counters[name] = (counters[name] ?? 0) + 1
    return payload() as never
  }
}

interface Options {
  users?: User[]
  usersError?: string
  overviewError?: string
}

function usersMock(
  variables: Record<string, unknown>,
  items: User[],
  total: number,
  counters: Counters,
  error?: string,
): MockedResponse {
  return {
    request: { query: USERS_PAGE_QUERY, variables },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: counted('users', counters, () => (error
      ? { errors: [{ message: error }] }
      : { data: { usersPage: { __typename: 'UsersPage', items, total } } })),
  }
}

function statsMock(items: User[], range: Range, counters: Counters): MockedResponse {
  const ids = items.map((entry) => entry.id)
  return {
    request: { query: PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY, variables: { ids, ...range } },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: counted('stats', counters, () => ({ data: { playerActivityDepositWithdrawalStats: stats(ids) } })),
  }
}

function overviewMock(range: Range, counters: Counters, error?: string): MockedResponse {
  return {
    request: { query: OVERVIEW_KPIS_QUERY, variables: { dateRange: range } },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: counted('overview', counters, () => (error
      ? { errors: [{ message: error }] }
      : { data: { overviewKPIs: { __typename: 'OverviewKPIs', totalDeposits: 250000, totalWithdrawals: 100000 } } })),
  }
}

function renderPage(options: Options = {}, counters: Counters = {}) {
  const users = options.users ?? USERS
  const pages = [
    { offset: 0, limit: 20 },
    { offset: 20, limit: 20 },
    { offset: 40, limit: 20 },
    { offset: 0, limit: 10 },
  ]
  const mocks: MockedResponse[] = []
  for (const { offset, limit } of pages) {
    const items = users.slice(offset, offset + limit)
    mocks.push(usersMock({ offset, limit }, items, users.length, counters, options.usersError))
    if (items.length > 0) {
      mocks.push(statsMock(items, ALL_TIME, counters), statsMock(items, TODAY, counters))
    }
  }
  mocks.push(
    usersMock({ query: 'asha', offset: 0, limit: 20 }, [ASHA], 1, counters),
    statsMock([ASHA], ALL_TIME, counters),
    overviewMock(ALL_TIME, counters, options.overviewError),
    overviewMock(TODAY, counters, options.overviewError),
  )
  return render(
    <MemoryRouter>
      <MockedProvider mocks={mocks}>
        <PageEyebrowProvider value="Reporting">
          <NthDepositWithdrawalReportPage />
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

/* Every document has answered once the table stops being busy and the stats figures are in. */
async function loaded(firstLink = 'Player 1') {
  await screen.findByRole('link', { name: firstLink })
  await waitFor(() => assert.equal(screen.getByRole('table').getAttribute('aria-busy'), 'false'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  apollo.queries.length = 0
  guard.allowed = true
  guard.calls.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NthDepositWithdrawalReportPage — documents and access', () => {
  test('keeps the three documents, their legacy variables, skip and policies, the guard and the page frame', async () => {
    renderPage()
    assert.deepEqual(lastOptions('PlayerActivityDepositWithdrawalStats'), {
      variables: { ids: [], ...ALL_TIME },
      skip: true,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    }, 'the stats wait for the page of players')
    await loaded()

    assert.equal(
      body(USERS_PAGE_QUERY),
      'query NthDwUsersPage($query: String, $offset: Int, $limit: Int) { usersPage( query: $query offset: $offset limit: $limit ) { items { id name phone username parentAgent { id username } } total } }',
    )
    assert.equal(
      body(OVERVIEW_KPIS_QUERY),
      'query OverviewKPIsNthDW($dateRange: DashboardDateRange) { overviewKPIs(dateRange: $dateRange) { totalDeposits totalWithdrawals } }',
    )
    assert.equal(
      body(PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY),
      'query PlayerActivityDepositWithdrawalStats($ids: [ID!]!, $dateFrom: String, $dateTo: String) { playerActivityDepositWithdrawalStats(ids: $ids, dateFrom: $dateFrom, dateTo: $dateTo) { playerId totalDepositAmount totalDepositCount totalWithdrawalAmount totalWithdrawalCount rangeDepositAmount rangeDepositCount rangeWithdrawalAmount rangeWithdrawalCount } }',
    )

    assert.deepEqual(lastOptions('NthDwUsersPage'), {
      variables: { query: undefined, offset: 0, limit: 20 },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })
    assert.deepEqual(lastOptions('PlayerActivityDepositWithdrawalStats'), {
      variables: { ids: USERS.slice(0, 20).map((entry) => entry.id), ...ALL_TIME },
      skip: false,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })
    assert.deepEqual(lastOptions('OverviewKPIsNthDW'), {
      variables: { dateRange: ALL_TIME },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })

    assert.deepEqual(guard.calls.at(-1), {
      required: [{ domain: 'reporting.players-activity', actions: ['view'] }],
      bypassForAgents: true,
    })
    assert.ok(screen.queryByText('Reporting') === null)
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Nth D/W')
    assert.ok(screen.queryByText('Player deposit and withdrawal totals — all-time and date range. Times in IST.') === null)
    assert.equal(screen.getByRole('heading', { level: 2 }).textContent, 'Deposit & Withdrawal Summary')
    assert.ok(screen.getByRole('button', { name: 'Period: All time' }))
  })

  test('a denied caller starts no query and sees the guard', () => {
    guard.allowed = false
    renderPage()

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(apollo.queries.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })
})

describe('NthDepositWithdrawalReportPage — rows and figures', () => {
  test('joins each player to its figures with the legacy fallbacks, and prints the KPI row', async () => {
    renderPage()
    await loaded()

    const first = screen.getByRole('link', { name: 'Player 1' })
    assert.equal(first.getAttribute('href'), '/players/profile/1')
    const row = first.closest('tr')
    assert.ok(row)
    assert.deepEqual(within(row).getAllByRole('cell').map((cell) => cell.textContent), [
      'Player 19800000001',
      'desk_1',
      'INR 2000.00',
      'INR 200.00',
      'INR 1000.00',
      'INR 100.00',
    ])
    const deposit = within(row).getByText('INR 2000.00')
    assert.ok(deposit.classList.contains(styles.deposit) && deposit.classList.contains(styles.lifetime))
    const rangeWithdraw = within(row).getByText('INR 100.00')
    assert.ok(rangeWithdraw.classList.contains(styles.withdrawal) && !rangeWithdraw.classList.contains(styles.lifetime))

    // a nameless player's link reads as a dash, as the legacy row built it
    const nameless = bodyRows()[1]
    assert.ok(nameless)
    assert.equal(within(nameless).getByRole('link').textContent, '—')
    assert.equal(within(nameless).getByRole('link').getAttribute('href'), '/players/profile/2')
    // no figures come back for player 3: zeros
    const third = screen.getByRole('link', { name: 'Player 3' }).closest('tr')
    assert.ok(third)
    assert.equal(within(third).getAllByText('INR 0.00').length, 4)
    // no agent for player 4: a dash
    const fourth = screen.getByRole('link', { name: 'Player 4' }).closest('tr')
    assert.ok(fourth)
    assert.ok(within(fourth).getByText('—'))

    assert.equal(screen.getAllByText('45').length, 2, 'the Players figure and the pager summary')
    assert.ok(screen.getByText('20 on this page'))
    assert.ok(screen.getByText('INR 500000.00'))
    assert.ok(screen.getByText('INR 200000.00'))
    assert.ok(screen.getByText('INR 300000.00'))
    assert.ok(screen.getByText('45 players • All amounts in whitelabel currency'))
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /Showing 1–20 of 45 items/)
  })
})

describe('NthDepositWithdrawalReportPage — paging, search, period and sort', () => {
  test('pages on the server: the offset follows the page, a new size returns to page one', async () => {
    renderPage()
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await loaded('Player 21')
    assert.deepEqual(lastOptions('NthDwUsersPage').variables, { query: undefined, offset: 20, limit: 20 })
    assert.deepEqual(
      (lastOptions('PlayerActivityDepositWithdrawalStats').variables as { ids: string[] }).ids,
      USERS.slice(20, 40).map((entry) => entry.id),
    )

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '10' } })
    await waitFor(() => assert.equal(currentPage(), '1'))
    await waitFor(() => assert.equal(bodyRows().length, 10))
    assert.deepEqual(lastOptions('NthDwUsersPage').variables, { query: undefined, offset: 0, limit: 10 })
    assert.deepEqual(
      Array.from((screen.getByLabelText('Rows per page:') as HTMLSelectElement).options).map((option) => option.value),
      ['10', '25', '50', '100'],
    )
  })

  test('search is debounced to the server and resets the page; Clear all empties it and keeps focus in the bar', async () => {
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await loaded('Player 21')

    const bar = screen.getByRole('search', { name: 'Filters' })
    const search = within(bar).getByRole('searchbox', { name: 'Search players' })
    assert.equal(search.getAttribute('placeholder'), 'Search by username, name, phone, ID...')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
    fireEvent.change(search, { target: { value: '   ' } })
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null, 'spaces alone are not a filter')
    fireEvent.change(search, { target: { value: 'asha' } })
    assert.equal(currentPage(), '1')
    assert.ok(within(bar).getByText('1 filter applied'))
    await loaded('Asha Rao')
    assert.deepEqual(lastOptions('NthDwUsersPage').variables, { query: 'asha', offset: 0, limit: 20 })
    assert.ok(screen.getByText('1 player • All amounts in whitelabel currency'))

    const clear = screen.getByRole('button', { name: 'Clear all' })
    clear.focus()
    fireEvent.click(clear)
    assert.equal((search as HTMLInputElement).value, '')
    await waitFor(() => assert.ok(bar.contains(document.activeElement), 'focus stays in the filter bar'))
    await loaded()
    assert.deepEqual(lastOptions('NthDwUsersPage').variables, { query: undefined, offset: 0, limit: 20 })
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
  })

  test('a period preset re-asks the stats and the totals for its range and returns to page one', async () => {
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await loaded('Player 21')

    fireEvent.click(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: 'Today' }))
    await waitFor(() => {
      assert.deepEqual(lastOptions('OverviewKPIsNthDW').variables, { dateRange: TODAY })
      assert.deepEqual(lastOptions('PlayerActivityDepositWithdrawalStats').variables, {
        ids: USERS.slice(0, 20).map((entry) => entry.id),
        ...TODAY,
      })
    })
    assert.equal(currentPage(), '1')
    assert.deepEqual(lastOptions('NthDwUsersPage').variables, { query: undefined, offset: 0, limit: 20 })
    assert.ok(await screen.findByRole('button', { name: 'Period: 07 Oct 2026 – 07 Oct 2026' }))
    assert.ok(screen.getByRole('button', { name: 'Clear all' }))
  })

  test('a sort orders the page on screen only: no new request, same page', async () => {
    const counters: Counters = {}
    renderPage({}, counters)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await loaded('Player 21')
    const before = { ...counters }

    const header = screen.getByRole('columnheader', { name: /Total Deposit/ })
    const sortButton = within(header).getByRole('button', { name: 'Total Deposit' })
    fireEvent.click(sortButton)
    fireEvent.click(sortButton)
    assert.equal(header.getAttribute('aria-sort'), 'descending')
    assert.equal(within(bodyRows()[0] as HTMLElement).getByRole('link').textContent, 'Player 40')
    assert.equal(currentPage(), '2')
    assert.deepEqual(lastOptions('NthDwUsersPage').variables, { query: undefined, offset: 20, limit: 20 })
    assert.deepEqual(counters, before)

    const playerHeader = screen.getByRole('columnheader', { name: /Player/ })
    fireEvent.click(within(playerHeader).getByRole('button', { name: 'Player' }))
    assert.equal(within(bodyRows()[0] as HTMLElement).getByRole('link').textContent, 'Player 21')
  })

  test('Refresh re-asks all three documents and is busy until they answer', async () => {
    const counters: Counters = {}
    renderPage({}, counters)
    await loaded()
    const before = { ...counters }

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    assert.equal(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy'), 'true')
    await waitFor(() => {
      assert.equal(counters.users, (before.users ?? 0) + 1)
      assert.equal(counters.stats, (before.stats ?? 0) + 1)
      assert.equal(counters.overview, (before.overview ?? 0) + 1)
    })
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy'), null))
  })
})

describe('NthDepositWithdrawalReportPage — loading, empty and error states', () => {
  test('shows the table loading state first, then the legacy empty copy with the stats skipped', async () => {
    renderPage({ users: [] })

    assert.ok(screen.getByText('Loading Deposit and withdrawal summary'))
    assert.ok(screen.getByRole('columnheader', { name: /Range Withdraw/ }))
    assert.ok(await screen.findByText('No players found'))
    assert.ok(screen.getByText('Try adjusting your search or date range.'))
    assert.equal(lastOptions('PlayerActivityDepositWithdrawalStats').skip, true)
    assert.ok(screen.getByText('0 players • All amounts in whitelabel currency'))
  })

  test('a failed player list shows its error with Retry; failed totals say so', async () => {
    const counters: Counters = {}
    renderPage({ usersError: 'Players unavailable', overviewError: 'Totals unavailable' }, counters)

    assert.ok(await screen.findByText('Players unavailable'))
    assert.ok(await screen.findByText('Some totals could not be loaded'))
    const before = counters.users ?? 0
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.equal(counters.users, before + 1))
  })

  test('a permission refusal stays silent: the legacy empty copy, with no error, Retry or totals notice', async () => {
    renderPage({
      usersError: 'Forbidden: insufficient permissions for players.list:view',
      overviewError: 'Forbidden: insufficient permissions to view dashboard',
    })

    assert.ok(await screen.findByText('No players found'))
    await waitFor(() => assert.equal(screen.getByRole('table').getAttribute('aria-busy'), 'false'))
    assert.ok(screen.queryByText(/Forbidden/) === null)
    assert.equal(screen.queryByRole('button', { name: 'Retry' }), null)
    assert.ok(screen.queryByText('Some totals could not be loaded') === null)
    assert.equal(lastOptions('PlayerActivityDepositWithdrawalStats').skip, true)
  })
})
