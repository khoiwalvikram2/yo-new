/**
 * /bets against a mocked GraphQL server: MockedProvider with a link that answers by operation name and
 * records every variable set it is sent (the documents themselves stay in the page's files, untouched).
 * Covers the exact list, totals, agent, sub-agent and player queries and their variables; the RBAC guard
 * with requireAny and bypassForAgents (and that a denied caller starts no query); the agent and admin
 * filter branches; server paging and its resets; Clear all; the date presets; Refresh; the paged export;
 * and the loading, empty and error states.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { todayISTString } from '@/shared/utils/date'
import BetListPage from './BetListPage'
import { getBetRangeForPreset } from './betListModel'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  requireAny?: boolean
  bypassForAgents?: boolean
}

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
}

type Handler = (operation: Operation) => FetchResult | Promise<FetchResult>

const auth = vi.hoisted(() => ({ agent: undefined as { id: string } | undefined }))
const guard = vi.hoisted(() => ({ allowed: true, calls: [] as GuardCall[] }))
const feedback = vi.hoisted(() => ({ toast: vi.fn(), exportBets: vi.fn() }))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: { id: string } }) => unknown) => selector({ agent: auth.agent }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, requireAny, bypassForAgents, children }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required, requireAny, bypassForAgents })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/core/useFormatDate', async () => {
  const { formatInTimeZone } = await import('@/shared/utils/date')
  return {
    useFormatDate: () => ({
      formatDate: (value: string, pattern = 'dd MMM yyyy') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
      formatTime: (value: string, pattern = 'HH:mm') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
    }),
  }
})

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('./utils/exportBetList', () => ({ exportBetListToExcel: feedback.exportBets }))

/* ---------- the mocked server ---------- */

const CAMPAIGN = {
  __typename: 'BonusCampaign',
  id: 'cmp-1',
  name: 'Weekend Boost',
  type: 'deposit',
  distributionType: 'roll_over',
  wageringReq: 5,
  validTo: null,
  validFrom: null,
  domain: 'sports',
  status: 'active',
  startDate: null,
  endDate: null,
  amount: 500,
  percentage: null,
  amountType: 'fixed',
}

function sportsBet(id: string, overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'SportsBet',
    id,
    userId: `u-${id}`,
    userName: 'rk_sharma88',
    userPhone: '9876543210',
    sportName: 'Cricket',
    leagueName: 'ICC',
    eventName: 'Ind vs Aus',
    sportsMarketName: 'Match Odds',
    selectionName: 'India',
    side: 'back',
    stake: 25000,
    price: 1.86,
    oddsSize: null,
    liability: 21500,
    pl: 120,
    result: null,
    eventResult: null,
    sportsStatus: 'matched',
    currency: 'INR',
    createdAt: '2026-10-07T05:00:00.000Z',
    walletType: 'cash',
    ipAddress: '10.1.2.3',
    deviceInfo: 'Android 14',
    location: 'Mumbai',
    country: 'IN',
    campaign: CAMPAIGN,
    ...overrides,
  }
}

function casinoBet(id: string, overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'CasinoBet',
    id,
    userId: null,
    userName: 'meena.p',
    userPhone: null,
    gameName: 'Lightning Roulette',
    vendorName: 'Evolution',
    tableId: 'LR-01',
    stake: 500,
    payout: 17500,
    winAmount: 17500,
    netAmount: -500,
    casinoStatus: 'lost',
    currency: 'INR',
    createdAt: '2026-10-07T04:00:00.000Z',
    walletType: 'bonus',
    sessionId: null,
    gameRoundId: null,
    transactionId: 'TX-9',
    settledAt: null,
    providerCode: null,
    campaign: null,
    ...overrides,
  }
}

function matkaBet(id: string, overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'MatkaBet',
    id,
    userId: `u-${id}`,
    userName: 'neha_21',
    userPhone: '9000000001',
    marketName: 'Kalyan',
    matkaType: 'single',
    marketSession: 'open',
    bidType: 'jodi',
    betNumbers: '47',
    betAmount: 100,
    payoutMultiplier: 9,
    potentialWin: 900,
    actualWin: null,
    result: null,
    matkaStatus: 'void',
    currency: 'INR',
    createdAt: '2026-10-07T03:00:00.000Z',
    walletType: null,
    campaign: null,
    ...overrides,
  }
}

const TOTALS = {
  __typename: 'BetsPageTotals',
  totalAll: 1234,
  totalSports: 600,
  totalCasino: 400,
  totalMatka: 234,
  totalStake: 4823791.5,
  totalStakeSports: 3000000,
  totalStakeCasino: 1500000,
  totalStakeMatka: 323791.5,
}

interface ServerState {
  calls: ServerCall[]
  items: Array<Record<string, unknown>>
  total: number
  /** Items per domain variable, when a test changes the domain. */
  byDomain: Record<string, Array<Record<string, unknown>>>
  listError: Error | null
}

let server: ServerState

function calls(operationName: string) {
  return server.calls.filter((call) => call.operationName === operationName)
}

/** Variables as they travel: undefined keys dropped. */
function sent(call: ServerCall | undefined) {
  return JSON.parse(JSON.stringify(call?.variables ?? null)) as Record<string, unknown>
}

function lastSent(operationName: string) {
  const list = calls(operationName)
  return sent(list[list.length - 1])
}

const defaultHandler: Handler = (operation) => {
  const variables = operation.variables as Record<string, unknown>
  switch (operation.operationName) {
    case 'BetsPage': {
      if (server.listError) throw server.listError
      const domainItems = server.byDomain[String(variables.domain)] ?? server.items
      const offset = Number(variables.offset ?? 0)
      const limit = Number(variables.limit ?? 50)
      return {
        data: {
          betsPage: {
            __typename: 'BetsPage',
            items: domainItems.slice(offset, offset + limit),
            total: server.total,
          },
        },
      }
    }
    case 'BetsPageTotals':
      return { data: { betsPageTotals: TOTALS } }
    case 'AgentsForBetFilter':
      return {
        data: {
          agents: {
            __typename: 'AgentQueries',
            agentsPage: {
              __typename: 'AgentsPage',
              items: [
                { __typename: 'Agent', id: 'a1', username: 'ravi' },
                { __typename: 'Agent', id: 'a2', username: 'rajan' },
              ],
              total: 2,
            },
          },
        },
      }
    case 'SubAgentsForBetFilter':
      return {
        data: {
          agents: {
            __typename: 'AgentQueries',
            agentsPage: {
              __typename: 'AgentsPage',
              items: [
                { __typename: 'Agent', id: 's1', username: 'sub_one' },
                { __typename: 'Agent', id: 's2', username: 'sub_two' },
              ],
              total: 2,
            },
          },
        },
      }
    case 'PlayersForBetFilter':
      return {
        data: {
          usersPage: {
            __typename: 'UsersPage',
            items: [
              { __typename: 'User', id: 7, username: 'rk_sharma88', name: 'Rahul', phone: '9876543210' },
              { __typename: 'User', id: 8, username: 'rk_kumar', name: null, phone: null },
            ],
            total: 2,
          },
        },
      }
    default:
      throw new Error(`unexpected operation ${operation.operationName}`)
  }
}

function serverLink(handler: Handler) {
  return new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
    server.calls.push({ operationName: operation.operationName, variables: { ...operation.variables } })
    Promise.resolve()
      .then(() => handler(operation))
      .then(
        (result) => {
          observer.next(result)
          observer.complete()
        },
        (error: unknown) => observer.error(error),
      )
  }))
}

function renderPage(handler: Handler = defaultHandler) {
  return render(
    <MockedProvider link={serverLink(handler)}>
      <MemoryRouter initialEntries={['/bets']}>
        <PageEyebrowProvider value="Trading">
          <Routes>
            <Route path="/bets" element={<BetListPage />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded(handler?: Handler) {
  const view = renderPage(handler)
  await screen.findByRole('table', { name: 'Bets' })
  await waitFor(() => assert.ok(screen.queryByText('Loading Bets') === null))
  await screen.findByText('Total Bets')
  await waitFor(() => assert.equal(screen.getByRole('group', { name: 'Bet statistics' }).getAttribute('aria-busy'), null))
  return view
}

function headers() {
  return within(screen.getByRole('table', { name: 'Bets' }))
    .getAllByRole('columnheader')
    .map((header) => header.textContent)
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table', { name: 'Bets' })).getAllByRole('row')
  return rows
}

const today = () => todayISTString()

beforeEach(() => {
  auth.agent = undefined
  guard.allowed = true
  guard.calls.length = 0
  feedback.toast.mockReset()
  feedback.exportBets.mockReset()
  feedback.exportBets.mockResolvedValue(undefined)
  server = {
    calls: [],
    items: [sportsBet('1'), casinoBet('2'), matkaBet('3')],
    total: 3,
    byDomain: {},
    listError: null,
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BetListPage', () => {
  test('asks for the first 50 bets of today (IST) and the totals with the same filters', async () => {
    await renderLoaded()

    assert.deepEqual(lastSent('BetsPage'), {
      domain: 'ALL',
      filters: { dateFrom: today(), dateTo: today() },
      offset: 0,
      limit: 50,
    })
    assert.deepEqual(lastSent('BetsPageTotals'), { filters: { dateFrom: today(), dateTo: today() } })
    assert.equal(calls('AgentsForBetFilter').length, 0, 'an admin searches agents only after two characters')
    assert.equal(calls('SubAgentsForBetFilter').length, 0, 'only an agent loads sub-agents')
    assert.equal(calls('PlayersForBetFilter').length, 0)
  })

  test('renders one h1, the statistics and the mixed list with every legacy column', async () => {
    await renderLoaded()

    assert.deepEqual(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent), ['Bet List'])
    assert.ok(screen.queryByText('Trading') === null)
    assert.ok(screen.queryByText('View and filter all bets across Sports, Casino, Matka') === null)

    const stats = screen.getByRole('group', { name: 'Bet statistics' })
    for (const [label, value] of [
      ['Total Bets', (1234).toLocaleString()],
      ['Sports', (600).toLocaleString()],
      ['Casino', (400).toLocaleString()],
      ['Matka', (234).toLocaleString()],
      ['Total Stake', 'INR 4823791.50'],
    ]) {
      assert.ok(within(stats).getByText(label))
      assert.ok(within(stats).getByText(value), `${label} shows ${value}`)
    }

    const card = screen.getByRole('region', { name: 'Bet List' })
    assert.ok(within(card).getByText('3 bets'))
    assert.deepEqual(headers(), [
      'Time', 'Domain', 'Name', 'Phone', 'Wallet', 'Campaign', 'Event / Game', 'Market / Vendor', 'Type',
      'Stake', 'Odds', 'Liability', 'P/L', 'Result', 'Details', 'Status',
    ])

    const [sports, casino, matka] = bodyRows()
    const sportsCells = within(sports).getAllByRole('cell').map((cell) => cell.textContent)
    assert.equal(sportsCells[1], 'Sports')
    assert.equal(within(sports).getByRole('link', { name: 'rk_sharma88' }).getAttribute('href'), '/players/profile/u-1')
    assert.equal(sportsCells[3], '9876543210')
    assert.equal(sportsCells[4], 'Cash')
    assert.equal(sportsCells[6], 'Cricket › Ind vs Aus')
    assert.equal(sportsCells[7], 'Match Odds')
    assert.equal(sportsCells[8], 'back')
    assert.deepEqual(sportsCells.slice(9, 13), ['INR 25000.00', '1.86', 'INR 21500.00', '+INR 120.00'])
    assert.equal(sportsCells[15], 'Open')

    const casinoCells = within(casino).getAllByRole('cell').map((cell) => cell.textContent)
    assert.equal(within(casino).queryByRole('link'), null, 'no profile link without a user id')
    assert.deepEqual([casinoCells[2], casinoCells[3], casinoCells[4]], ['meena.p', '—', 'Bonus'])
    assert.deepEqual(casinoCells.slice(6, 14), [
      'Lightning Roulette', 'Evolution', '—', 'INR 500.00', '—', 'INR 17500.00', 'INR -500.00', 'Lost',
    ])
    assert.equal(casinoCells[15], 'Lost')

    const matkaCells = within(matka).getAllByRole('cell').map((cell) => cell.textContent)
    assert.deepEqual(matkaCells.slice(6, 15), [
      'Kalyansingle', 'jodi', '47', 'INR 100.00', '9.0x', 'INR 900.00', 'INR 0.00', 'Void', '—',
    ])
    assert.equal(matkaCells[15], 'Void')
  })

  test('wraps the page in the bet guard (any of three, agents bypass) and queries nothing when denied', async () => {
    guard.allowed = false
    renderPage()

    assert.ok(screen.getByRole('alert'))
    assert.deepEqual(guard.calls[0], {
      required: [
        { domain: 'sports.bets', actions: ['view'] },
        { domain: 'casino.bets', actions: ['view'] },
        { domain: 'matka.bets', actions: ['view'] },
      ],
      requireAny: true,
      bypassForAgents: true,
    })
    await act(async () => {
      await Promise.resolve()
    })
    assert.equal(server.calls.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })

  test('changing the domain refetches from offset 0, swaps the column set and the headline labels', async () => {
    server.items = Array.from({ length: 60 }, (_, index) => sportsBet(String(index + 1)))
    server.total = 60
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(lastSent('BetsPage').offset, 50))

    server.byDomain.SPORTS = [sportsBet('s9', { oddsSize: 120.4, price: 1.9, sportsStatus: 'won', eventResult: 'India won' })]
    server.total = 1
    fireEvent.change(screen.getByRole('combobox', { name: 'Domain' }), { target: { value: 'SPORTS' } })

    await waitFor(() => assert.deepEqual(lastSent('BetsPage'), {
      domain: 'SPORTS',
      filters: { dateFrom: today(), dateTo: today() },
      offset: 0,
      limit: 50,
    }))
    await waitFor(() => assert.equal(bodyRows().length, 1))
    assert.deepEqual(headers(), [
      'Time', 'Domain', 'Name', 'Phone', 'Wallet', 'Campaign', 'Event', 'Market', 'Selection', 'Type',
      'Stake', 'Odds', 'Liability', 'P/L', 'Result', 'Status', 'Details',
    ])
    const cells = within(bodyRows()[0]).getAllByRole('cell').map((cell) => cell.textContent)
    assert.equal(cells[11], '120 / 1.90')
    assert.equal(cells[14], 'India wonWon')
    assert.equal(cells[15], 'Won')
    await screen.findByText('Bets in list')
    assert.ok(screen.getByText('Stake in list'))
    assert.equal(screen.queryByRole('combobox', { name: 'Wallet' }), null, 'no wallet filter for sports')
  })

  test('pages on the server and goes back to the first page when the page size or a filter changes', async () => {
    server.items = Array.from({ length: 120 }, (_, index) => casinoBet(String(index + 1)))
    server.total = 120
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => assert.equal(lastSent('BetsPage').offset, 50))

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page:' }), { target: { value: '20' } })
    await waitFor(() => assert.deepEqual([lastSent('BetsPage').offset, lastSent('BetsPage').limit], [0, 20]))

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    await waitFor(() => assert.equal(lastSent('BetsPage').offset, 40))

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search bets' }), { target: { value: 'LR-01' } })
    await waitFor(() => assert.deepEqual(lastSent('BetsPage'), {
      domain: 'ALL',
      filters: { dateFrom: today(), dateTo: today(), search: 'LR-01' },
      offset: 0,
      limit: 20,
    }))
    assert.deepEqual(lastSent('BetsPageTotals'), { filters: { dateFrom: today(), dateTo: today(), search: 'LR-01' } })
  })

  test('filters by status and wallet, counts each choice, and Clear all returns to Today', async () => {
    await renderLoaded()
    assert.equal(screen.getByText(/filters? applied/).textContent, '0 filters applied')

    const status = screen.getByRole('combobox', { name: 'Status' })
    fireEvent.keyDown(status, { key: 'ArrowDown' })
    const statusList = screen.getByRole('listbox', { name: 'Status' })
    assert.deepEqual(within(statusList).getAllByRole('option').map((option) => option.textContent), [
      'Open', 'won', 'lost', 'void', 'cancelled', 'settled',
    ])
    fireEvent.click(within(statusList).getByRole('option', { name: 'won' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Status' })).getByRole('option', { name: 'Open' }))
    fireEvent.keyDown(status, { key: 'Escape' })
    await waitFor(() => assert.deepEqual((lastSent('BetsPage').filters as { status?: string[] }).status, ['won', 'matched']))

    const wallet = screen.getByRole('combobox', { name: 'Wallet' })
    fireEvent.keyDown(wallet, { key: 'ArrowDown' })
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Wallet' })).getByRole('option', { name: 'Bonus' }))
    await waitFor(() => assert.equal((lastSent('BetsPage').filters as { walletType?: string }).walletType, 'bonus'))
    assert.equal(screen.getByText(/filters? applied/).textContent, '3 filters applied')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.deepEqual(lastSent('BetsPage'), {
      domain: 'ALL',
      filters: { dateFrom: today(), dateTo: today() },
      offset: 0,
      limit: 50,
    }))
    assert.equal(screen.getByText(/filters? applied/).textContent, '0 filters applied')
  })

  test('applies a staged date preset and a custom range; a non-Today date counts as a filter', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 Days' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const week = getBetRangeForPreset('last7days')
    await waitFor(() => assert.deepEqual(lastSent('BetsPage').filters, { dateFrom: week.from, dateTo: week.to }))
    assert.equal(screen.getByText(/filters? applied/).textContent, '1 filter applied')

    fireEvent.click(screen.getByRole('button', { name: 'Date range: Last 7 Days' }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.deepEqual(lastSent('BetsPage').filters, { dateFrom: '2026-09-01', dateTo: '2026-09-15' }))
    assert.ok(screen.getByRole('button', { name: 'Date range: 2026-09-01 – 2026-09-15' }))
  })

  test('an admin searches agents from two characters and filters by the chosen username', async () => {
    await renderLoaded()

    const agent = screen.getByRole('combobox', { name: 'Agent' })
    assert.equal(agent.getAttribute('placeholder'), 'Agent (search)')
    assert.equal(screen.getByRole('combobox', { name: 'Player' }).getAttribute('placeholder'), 'Player (search)')

    fireEvent.change(agent, { target: { value: 'r' } })
    assert.ok(screen.getAllByText('Type 2+ chars').length > 0)
    fireEvent.change(agent, { target: { value: 'ra' } })
    await waitFor(() => assert.deepEqual(lastSent('AgentsForBetFilter'), { query: 'ra', limit: 50 }))
    const option = await screen.findByRole('option', { name: 'rajan' })
    fireEvent.click(option)

    await waitFor(() => assert.deepEqual(lastSent('BetsPage').filters, {
      dateFrom: today(),
      dateTo: today(),
      agentUsername: 'rajan',
    }))
    assert.equal((screen.getByRole('combobox', { name: 'Agent' }) as HTMLInputElement).value, 'rajan')
    assert.equal(calls('SubAgentsForBetFilter').length, 0)

    // Agents that arrive after the typing leave no option active; Enter still picks the first, as antd did.
    fireEvent.change(agent, { target: { value: 'ra' } })
    await screen.findByRole('option', { name: 'ravi' })
    assert.equal(agent.getAttribute('aria-activedescendant'), null)
    fireEvent.keyDown(agent, { key: 'Enter' })
    await waitFor(() => assert.equal((lastSent('BetsPage').filters as { agentUsername?: string }).agentUsername, 'ravi'))
    assert.equal(screen.queryByRole('listbox', { name: 'Agent' }), null)
    assert.equal((screen.getByRole('combobox', { name: 'Agent' }) as HTMLInputElement).value, 'ravi')
  })

  test('an agent filters by its own sub-agents, "All my players" first, and never searches all agents', async () => {
    auth.agent = { id: '77' }
    await renderLoaded()

    await waitFor(() => assert.deepEqual(lastSent('SubAgentsForBetFilter'), { parentAgentId: '77', limit: 500 }))
    const agent = screen.getByRole('combobox', { name: 'Agent' }) as HTMLInputElement
    assert.equal(agent.getAttribute('placeholder'), 'Agent')
    assert.equal(agent.value, 'All my players')
    assert.equal(screen.getByRole('combobox', { name: 'Player' }).getAttribute('placeholder'), 'Player')

    fireEvent.keyDown(agent, { key: 'ArrowDown' })
    const list = await screen.findByRole('listbox', { name: 'Agent' })
    await waitFor(() => assert.deepEqual(within(list).getAllByRole('option').map((option) => option.textContent), [
      'All my players', 'sub_one', 'sub_two',
    ]))
    fireEvent.click(within(list).getByRole('option', { name: 'sub_two' }))
    await waitFor(() => assert.equal((lastSent('BetsPage').filters as { agentUsername?: string }).agentUsername, 'sub_two'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear Agent' }))
    await waitFor(() => assert.equal((lastSent('BetsPage').filters as { agentUsername?: string }).agentUsername, undefined))
    assert.equal((screen.getByRole('combobox', { name: 'Agent' }) as HTMLInputElement).value, 'All my players')
    assert.equal(calls('AgentsForBetFilter').length, 0)
  })

  test('typed player text filters at once and searches players; a picked player filters by username', async () => {
    await renderLoaded()
    const player = screen.getByRole('combobox', { name: 'Player' }) as HTMLInputElement

    fireEvent.change(player, { target: { value: 'rk' } })
    await waitFor(() => assert.equal((lastSent('BetsPage').filters as { playerSearch?: string }).playerSearch, 'rk'))
    await waitFor(() => assert.deepEqual(lastSent('PlayersForBetFilter'), { query: 'rk', limit: 50 }))

    fireEvent.click(await screen.findByRole('option', { name: 'rk_sharma88 (9876543210)' }))
    await waitFor(() => assert.equal(
      (lastSent('BetsPage').filters as { playerSearch?: string }).playerSearch,
      'rk_sharma88',
    ))
    assert.equal(player.value, 'rk_sharma88 (9876543210)')
    assert.equal(screen.getByText(/filters? applied/).textContent, '1 filter applied')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.equal(player.value, ''))
    await waitFor(() => assert.equal(
      (lastSent('BetsPage').filters as { playerSearch?: string }).playerSearch,
      undefined,
    ))
  })

  test('typed player text and its filter go when the list closes without a pick, as antd emptied its search', async () => {
    await renderLoaded()
    const player = screen.getByRole('combobox', { name: 'Player' }) as HTMLInputElement
    const playerSearch = () => (lastSent('BetsPage').filters as { playerSearch?: string }).playerSearch

    fireEvent.change(player, { target: { value: 'rk' } })
    await waitFor(() => assert.equal(playerSearch(), 'rk'))
    fireEvent.blur(player)
    await waitFor(() => assert.equal(playerSearch(), undefined))
    assert.equal(player.value, '')

    fireEvent.change(player, { target: { value: 'me' } })
    await waitFor(() => assert.equal(playerSearch(), 'me'))
    fireEvent.keyDown(player, { key: 'Escape' })
    await waitFor(() => assert.equal(playerSearch(), undefined))
    assert.equal(player.value, '')

    fireEvent.change(player, { target: { value: 'ab' } })
    await waitFor(() => assert.equal(playerSearch(), 'ab'))
    fireEvent.keyDown(player, { key: 'ArrowUp', altKey: true })
    await waitFor(() => assert.equal(playerSearch(), undefined))
    assert.equal(player.value, '')

    // One character lists no players, so Enter has nothing to pick: it closes the list and drops the text.
    fireEvent.change(player, { target: { value: 'r' } })
    await waitFor(() => assert.equal(playerSearch(), 'r'))
    fireEvent.keyDown(player, { key: 'Enter' })
    await waitFor(() => assert.equal(playerSearch(), undefined))
    assert.equal(player.value, '')
    assert.equal(screen.getByText(/filters? applied/).textContent, '0 filters applied')
  })

  test('Enter or Tab picks the first player that arrived; an edit of a pick restarts from the typed text', async () => {
    await renderLoaded()
    const player = screen.getByRole('combobox', { name: 'Player' }) as HTMLInputElement
    const playerSearch = () => (lastSent('BetsPage').filters as { playerSearch?: string }).playerSearch
    const label = 'rk_sharma88 (9876543210)'

    fireEvent.change(player, { target: { value: 'rk' } })
    await screen.findByRole('option', { name: label })
    // The players arrived after the typing, so no option is active; antd made the first one active then.
    assert.equal(player.getAttribute('aria-activedescendant'), null)
    fireEvent.keyDown(player, { key: 'Enter' })
    await waitFor(() => assert.equal(playerSearch(), 'rk_sharma88'))
    assert.equal(player.value, label)
    assert.equal(screen.queryByRole('listbox', { name: 'Player' }), null)

    // Opening the list and leaving it again keeps the pick.
    const lists = calls('BetsPage').length
    fireEvent.click(player)
    fireEvent.keyDown(player, { key: 'Escape' })
    fireEvent.blur(player)
    assert.equal(player.value, label)
    assert.equal(calls('BetsPage').length, lists)

    // A character typed after the pick starts a fresh search from that character, not from the label.
    fireEvent.change(player, { target: { value: `${label}m` } })
    await waitFor(() => assert.equal(playerSearch(), 'm'))
    assert.equal(player.value, 'm')

    fireEvent.change(player, { target: { value: 'rk' } })
    await screen.findByRole('option', { name: 'rk_kumar' })
    fireEvent.keyDown(player, { key: 'Tab' })
    await waitFor(() => assert.equal(playerSearch(), 'rk_sharma88'))
    fireEvent.blur(player)
    assert.equal(player.value, label)

    // Deleting from the picked label leaves an empty search: the field empties and the filter goes.
    fireEvent.change(player, { target: { value: label.slice(0, -1) } })
    await waitFor(() => assert.equal(playerSearch(), undefined))
    assert.equal(player.value, '')
  })

  test('Refresh refetches the list and the totals', async () => {
    await renderLoaded()
    const lists = calls('BetsPage').length
    const totals = calls('BetsPageTotals').length

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(calls('BetsPage').length, lists + 1))
    await waitFor(() => assert.equal(calls('BetsPageTotals').length, totals + 1))
  })

  test('exports every page of the current filters in 500-row batches and reports the count', async () => {
    server.items = Array.from({ length: 501 }, (_, index) => matkaBet(String(index + 1)))
    server.total = 501
    await renderLoaded()
    const before = calls('BetsPage').length

    fireEvent.click(within(screen.getByRole('region', { name: 'Bet List' })).getByRole('button', { name: 'Export Excel' }))
    await waitFor(() => assert.equal(feedback.exportBets.mock.calls.length, 1))

    const exportCalls = calls('BetsPage').slice(before).map(sent)
    assert.deepEqual(exportCalls, [
      { domain: 'ALL', filters: { dateFrom: today(), dateTo: today() }, offset: 0, limit: 500 },
      { domain: 'ALL', filters: { dateFrom: today(), dateTo: today() }, offset: 500, limit: 500 },
    ])
    const [items, reportedTotal] = feedback.exportBets.mock.calls[0] as [Array<{ status: string }>, number]
    assert.equal(items.length, 501)
    assert.equal(items[0].status, 'void', 'the aliased status is normalised for the writer')
    assert.equal(reportedTotal, 501)
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls.at(-1)?.[0], {
      title: 'Export Complete',
      message: `Exported ${(501).toLocaleString()} bet(s) matching the current filters.`,
      tone: 'ok',
      duration: 4500,
    }))
  })

  test('a failed export says why, and an empty list cannot be exported', async () => {
    feedback.exportBets.mockRejectedValue(new Error('Workbook failed'))
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls.at(-1)?.[0], {
      title: 'Export Failed',
      message: 'Workbook failed',
      tone: 'error',
      duration: 4500,
    }))
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Export Excel' }).getAttribute('aria-busy'), null))

    server.items = []
    server.total = 0
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('No bets found')
    assert.equal((screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement).disabled, true)
    assert.ok(screen.getByText('0 bets'))
  })

  test('shows the loading state first, then an empty list with the mixed columns', async () => {
    server.items = []
    server.total = 0
    renderPage()

    assert.ok(screen.getByText('Loading Bets'))
    assert.equal(screen.getByRole('group', { name: 'Bet statistics' }).getAttribute('aria-busy'), 'true')
    assert.equal((screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement).disabled, true)
    await screen.findByText('No bets found')
    assert.equal(headers()[6], 'Event / Game')
  })

  test('a failed list raises the legacy error toast and an error row with Retry', async () => {
    server.listError = new Error('Bets service unavailable')
    renderPage()

    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0]?.[0], {
      title: 'Bet List Error',
      message: 'Bets service unavailable',
      tone: 'error',
      duration: 4500,
    }))
    const table = screen.getByRole('table', { name: 'Bets' })
    assert.ok(within(table).getByText('Bets service unavailable'))

    server.listError = null
    const before = calls('BetsPage').length
    fireEvent.click(within(table).getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.ok(calls('BetsPage').length > before))
    await waitFor(() => assert.equal(bodyRows().length, 3))
  })
})
