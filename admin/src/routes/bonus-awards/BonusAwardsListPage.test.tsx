/**
 * /bonus-awards against a mocked GraphQL server (MockedProvider + MemoryRouter): the exact list, stats, KPI
 * and campaign queries and their variables, the guard and the status-change permission, the table cells,
 * paging, filters reaching the query, Refresh, the loading, empty and error states, and every remark
 * dialog flow (activate, the switch it can turn into, cancel, expire, forfeit) with its mutation payload.
 *
 * The campaign query is private to the page module, so its mock is built with graphql's parse() from the
 * same text; a changed page document stops matching and fails these tests.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError, parse } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  ACTIVATE_BONUS_AWARD_ADMIN_MUTATION,
  BONUS_AWARDS_PAGE_QUERY,
  BONUS_AWARDS_PAGE_STATS_QUERY,
  BONUS_KPIS_QUERY,
  FORFEIT_BONUS_AWARD_ADMIN_MUTATION,
  SET_BONUS_AWARD_STATUS_MUTATION,
  SWITCH_BONUS_AWARD_ADMIN_MUTATION,
} from '@/lib/graphql/bonusAwardsPage'
import BonusAwardsListPage from './BonusAwardsListPage'
import { bonusAwardsToday, getBonusAwardsRangeForPreset, type BonusAwardRow } from './bonusAwardsModel'

const CAMPAIGNS_DOCUMENT = parse(`
  query BonusCampaignsForAwardsFilter {
    bonusCampaigns {
      id
      name
    }
  }
`)

type Permission = { domain: string; actions: string[] }
type Payload = { success: boolean; message?: string | null; code?: string | null }

const auth = vi.hoisted(() => ({
  agent: null as null | { allowedDomains: string[] },
  permissions: [] as Array<{ domain: string; actions: string[] }>,
}))
const feedback = vi.hoisted(() => ({ toast: vi.fn() }))
const rbac = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency?: string) => `${currency ?? 'INR'} ${amount.toFixed(2)}`,
    getWhitelabelBaseCurrencyCode: () => 'INR',
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: Array<{ domain: string; actions: string[] }>; children: ReactNode }) => {
    rbac.calls.push(required)
    return rbac.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

const CHANGE_STATUS: Permission[] = [{ domain: 'bonuses.detail', actions: ['update'] }]

const PENDING: BonusAwardRow = {
  id: '91',
  campaignId: 12,
  campaignName: 'Diwali Reload',
  userId: 4410,
  userName: null,
  userPhone: null,
  domain: 'sports',
  type: 'deposit',
  amount: 500,
  currency: 'INR',
  wageringReq: 5000,
  currentWagering: 1250,
  status: 'pending',
  awardedAt: '2026-10-06T10:00:00.000Z',
  expiresAt: '2026-10-13T10:00:00.000Z',
  completedAt: null,
  triggerAmount: 1000,
  firstDepositRequired: true,
  firstDepositUnlocked: false,
  distributionType: 'instant',
  statusUpdatedAt: null,
  statusUpdatedByName: null,
  statusUpdatedByPhone: null,
  statusUpdatedByRemark: null,
}

const ACTIVE: BonusAwardRow = {
  ...PENDING,
  id: '92',
  campaignId: 14,
  campaignName: 'Weekend Boost',
  userId: 4411,
  userName: 'rk_sharma',
  userPhone: '9876500001',
  domain: 'casino',
  type: 'cashback',
  amount: 250,
  wageringReq: 0,
  currentWagering: 0,
  status: 'active',
  expiresAt: null,
  triggerAmount: null,
  firstDepositRequired: false,
  distributionType: null,
  statusUpdatedAt: '2026-10-06T12:00:00.000Z',
  statusUpdatedByName: 'Ops Admin',
  statusUpdatedByPhone: '9000000001',
  statusUpdatedByRemark: 'Manual activation after KYC',
}

const COMPLETED: BonusAwardRow = {
  ...PENDING,
  id: '93',
  campaignName: 'Loyalty Card',
  userName: 'meena.p',
  status: 'completed',
  wageringReq: 5000,
  currentWagering: 6000,
  completedAt: '2026-10-05T08:00:00.000Z',
  triggerAmount: null,
  firstDepositRequired: true,
  firstDepositUnlocked: true,
  distributionType: null,
}

const PAGE_TWO: BonusAwardRow = { ...COMPLETED, id: '151', campaignName: 'Page Two Card' }

interface Server {
  rows: BonusAwardRow[]
  total: number
  pageError: string | null
  pageCalls: Array<Record<string, unknown>>
  statsCalls: Array<Record<string, unknown>>
  kpiCalls: Array<Record<string, unknown>>
  campaignCalls: number
  mutations: Array<{ name: string; variables: Record<string, unknown> }>
  replies: Partial<Record<string, Array<Payload | Error>>>
}

let server: Server

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>

function awardItem(row: BonusAwardRow) {
  return { __typename: 'BonusAwardRow', ...row, expiresAt: row.expiresAt ?? null }
}

function pageMock(): MockedResponse {
  return {
    request: { query: BONUS_AWARDS_PAGE_QUERY },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.pageCalls.push(plain(variables))
      if (server.pageError) return { errors: [new GraphQLError(server.pageError)] }
      const rows = variables.offset === 50 ? [PAGE_TWO] : server.rows
      return {
        data: {
          bonusAwardsPage: { __typename: 'BonusAwardsPage', total: server.total, items: rows.map(awardItem) },
        },
      }
    },
  }
}

function statsMock(): MockedResponse {
  return {
    request: { query: BONUS_AWARDS_PAGE_STATS_QUERY },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.statsCalls.push(plain(variables))
      return {
        data: {
          bonusAwardsPageStats: {
            __typename: 'BonusAwardsPageStats',
            total: 1240,
            pending: 40,
            active: 300,
            completed: 800,
            expired: 60,
            cancelled: 40,
            totalBonusPaid: 120000,
            bonusWalletTotal: 45000,
            wageringRemaining: 300000,
            bonusUses: 1100,
            bonusToCashTransferred: 25000,
          },
        },
      }
    },
  }
}

function kpiMock(): MockedResponse {
  return {
    request: { query: BONUS_KPIS_QUERY },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.kpiCalls.push(plain(variables))
      return {
        data: {
          bonusKPIs: {
            __typename: 'BonusKPIs',
            totalIssued: 9000,
            totalRedeemed: 3000,
            totalExpired: 100,
            totalCancelled: 50,
            outstandingLiability: 4000,
            totalWagering: 20000,
            totalRevenue: 1500,
            awardCount: 1200,
            redemptionCount: 300,
            playerCount: 950,
            roi: 0.1667,
          },
        },
      }
    },
  }
}

function campaignsMock(): MockedResponse {
  return {
    request: { query: CAMPAIGNS_DOCUMENT },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.campaignCalls += 1
      return {
        data: {
          bonusCampaigns: [
            { __typename: 'BonusCampaign', id: '12', name: 'Diwali Reload' },
            { __typename: 'BonusCampaign', id: '14', name: 'Weekend Boost' },
          ],
        },
      }
    },
  }
}

function mutationMock(name: string, query: MockedResponse['request']['query'], field: string): MockedResponse {
  return {
    request: { query },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.mutations.push({ name, variables: plain(variables) })
      const reply = server.replies[name]?.shift() ?? { success: true, message: null }
      if (reply instanceof Error) return { errors: [new GraphQLError(reply.message)] }
      return {
        data: {
          [field]: {
            __typename: 'BonusAwardActionPayload',
            success: reply.success,
            message: reply.message ?? null,
            ...(name === 'setStatus' ? { newStatus: 'cancelled' } : { code: reply.code ?? null }),
          },
        },
      }
    },
  }
}

function mocks(): MockedResponse[] {
  return [
    pageMock(),
    statsMock(),
    kpiMock(),
    campaignsMock(),
    mutationMock('setStatus', SET_BONUS_AWARD_STATUS_MUTATION, 'setBonusAwardStatus'),
    mutationMock('activate', ACTIVATE_BONUS_AWARD_ADMIN_MUTATION, 'activateBonusAwardAdmin'),
    mutationMock('switch', SWITCH_BONUS_AWARD_ADMIN_MUTATION, 'switchBonusAwardAdmin'),
    mutationMock('forfeit', FORFEIT_BONUS_AWARD_ADMIN_MUTATION, 'forfeitBonusAwardAdmin'),
  ]
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderPage() {
  return render(
    <MockedProvider mocks={mocks()}>
      <MemoryRouter initialEntries={['/bonus-awards']}>
        <PageEyebrowProvider value="Trading">
          <Routes>
            <Route path="/bonus-awards" element={<BonusAwardsListPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded() {
  const view = renderPage()
  await screen.findByRole('table', { name: 'Bonus cards' })
  await waitFor(() => assert.ok(screen.queryByText('Loading Bonus cards') === null, 'the table loaded'))
  await screen.findByText('Total bonus paid')
  const cardFigures = screen.getByRole('region', { name: 'Bonus cards (filtered list scope)' })
  await waitFor(() => assert.equal(cardFigures.querySelector('[aria-busy="true"]'), null, 'the card figures loaded'))
  const ledgerFigures = screen.getByRole('region', { name: 'Period metrics (whitelabel-wide, awarded in range)' })
  await waitFor(() => assert.equal(ledgerFigures.querySelector('[aria-busy="true"]'), null, 'the ledger figures loaded'))
  return view
}

function rowOf(text: string): HTMLElement {
  const cell = screen.getAllByText(text).find((element) => element.closest('tbody tr'))
  const row = cell?.closest('tr')
  assert.ok(row, `Expected a row for ${text}`)
  return row as HTMLElement
}

function lastPageFilters(): Record<string, unknown> {
  return (server.pageCalls.at(-1)?.filters ?? {}) as Record<string, unknown>
}

function toastCalls() {
  return feedback.toast.mock.calls.map(([options]) => options as Record<string, unknown>)
}

async function openDialogFrom(buttonName: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: buttonName }))
  return screen.findByRole('alertdialog')
}

beforeEach(() => {
  server = {
    rows: [PENDING, ACTIVE, COMPLETED],
    total: 3,
    pageError: null,
    pageCalls: [],
    statsCalls: [],
    kpiCalls: [],
    campaignCalls: 0,
    mutations: [],
    replies: {},
  }
  auth.agent = null
  auth.permissions = CHANGE_STATUS
  rbac.allowed = true
  rbac.calls.length = 0
  feedback.toast.mockReset()
})

describe('BonusAwardsListPage queries, guard and table', () => {
  test('starts every query with the legacy variables and shows the header, stats and rows', async () => {
    await renderLoaded()
    const today = bonusAwardsToday()

    assert.deepStrictEqual(rbac.calls.at(-1), [{ domain: 'bonuses.list', actions: ['view'] }])
    assert.ok(screen.queryByText('Trading') === null)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Bonus cards' }))
    assert.ok(screen.queryByText('Player bonus awards — filter by date, status, domain, campaign, agent, or player. Times in IST.') === null)

    assert.deepStrictEqual(server.pageCalls[0], { filters: { dateFrom: today, dateTo: today }, offset: 0, limit: 50 })
    assert.deepStrictEqual(server.statsCalls[0], { filters: { dateFrom: today, dateTo: today } })
    assert.deepStrictEqual(server.kpiCalls[0], { filter: { dateFrom: today, dateTo: today, currency: 'INR' } })
    assert.equal(server.campaignCalls, 1)

    const ledger = screen.getByRole('region', { name: 'Period metrics (whitelabel-wide, awarded in range)' })
    for (const text of ['Bonus revenue (GGR)', 'INR 1500.00', 'Bonus ROI', '16.67%', 'Award / redemption events', '1,200 / 300']) {
      assert.ok(within(ledger).getByText(text), text)
    }
    const cards = screen.getByRole('region', { name: 'Bonus cards (filtered list scope)' })
    for (const text of ['Total bonus paid', 'INR 120000.00', 'Bonus dues', 'Total cards', '1,240', 'Bonus uses', '1,100']) {
      assert.ok(within(cards).getByText(text), text)
    }

    const tableCard = screen.getByRole('region', { name: 'Bonus cards' })
    assert.ok(within(tableCard).getByRole('heading', { level: 2, name: 'Bonus cards' }))
    assert.ok(within(tableCard).getByText('3 bonus cards'))
    const table = screen.getByRole('table', { name: 'Bonus cards' })
    assert.deepStrictEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      [
        'ID', 'Campaign', 'Player', 'Domain', 'Type', 'Amount', 'Wagering', 'Wagering progress', 'Status',
        'Changed by', 'Actor phone', 'Remark', 'Status at', 'Awarded', 'Expires', 'Details', 'Actions',
      ],
    )

    const pending = rowOf('Diwali Reload')
    assert.equal(within(pending).getByRole('link', { name: 'Diwali Reload' }).getAttribute('href'), '/bonuses/12')
    assert.ok(within(pending).getByText('#12'))
    assert.equal(within(pending).getByRole('link', { name: 'User 4410' }).getAttribute('href'), '/players/profile/4410')
    assert.ok(within(pending).getByText('ID 4410'))
    assert.ok(within(pending).getByText('sports'))
    assert.ok(within(pending).getByText('INR 500.00'))
    assert.ok(within(pending).getByText('1,250.00 / 5,000.00'))
    assert.ok(within(pending).getByText('25%'))
    assert.ok(within(pending).getByText('Pending'))
    assert.ok(within(pending).getByText('06 Oct 26'))
    assert.equal(within(pending).getAllByText('15:30:00').length, 2, 'awarded and expiry times')
    assert.ok(within(pending).getByText('13 Oct 26'))
    assert.ok(within(pending).getByText('Distribution:'))
    assert.ok(within(pending).getByText('instant'))
    assert.ok(within(pending).getByText('INR 1000.00'))
    assert.ok(within(pending).getByText('First deposit (locked)'))
    assert.ok(within(pending).getByRole('button', { name: 'Activate bonus card 91' }))
    assert.ok(within(pending).getByRole('button', { name: 'Set status for bonus card 91' }))

    const active = rowOf('Weekend Boost')
    assert.ok(within(active).getByRole('link', { name: 'rk_sharma' }))
    assert.ok(within(active).getByText('9876500001'))
    assert.ok(within(active).getByText('Ops Admin'))
    assert.ok(within(active).getByText('9000000001'))
    assert.ok(within(active).getByText('Manual activation after KYC'))
    assert.ok(within(active).getByText('17:30:00'))
    assert.ok(within(active).getByRole('button', { name: 'Forfeit bonus card 92' }))
    assert.ok(within(active).getAllByText('—').length >= 2, 'no requirement and no expiry read as a dash')

    const completed = rowOf('Loyalty Card')
    assert.ok(within(completed).getByText('100%'))
    assert.ok(within(completed).getByText('Completed'))
    assert.ok(within(completed).getByText('First deposit (unlocked)'))
    assert.ok(within(completed).getByText('Done 05 Oct 26'))
    assert.ok(within(completed).queryByRole('button') === null, 'a completed card has no action')

    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /Showing 1–3 of 3 cards/)
  })

  test('starts no query when the guard denies access', async () => {
    rbac.allowed = false
    renderPage()
    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.ok(screen.queryByRole('heading', { name: 'Bonus cards' }) === null, 'no page behind the denial')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    assert.equal(server.pageCalls.length + server.statsCalls.length + server.kpiCalls.length + server.campaignCalls, 0)
  })

  test('without a status-change permission there is no Actions column', async () => {
    auth.permissions = [{ domain: 'bonuses.list', actions: ['view'] }]
    await renderLoaded()
    const table = screen.getByRole('table', { name: 'Bonus cards' })
    assert.equal(within(table).getAllByRole('columnheader').length, 16)
    assert.ok(screen.queryByRole('button', { name: /Activate bonus card/ }) === null, 'no Activate')
    assert.ok(screen.queryByRole('button', { name: /Forfeit bonus card/ }) === null, 'no Forfeit')
  })

  test('players.bonuses:delete also grants the actions', async () => {
    auth.permissions = [{ domain: 'players.bonuses', actions: ['delete'] }]
    await renderLoaded()
    assert.ok(screen.getByRole('button', { name: 'Activate bonus card 91' }))
  })

  test('an agent login skips the campaign query, hides the ledger KPIs and links no campaign', async () => {
    auth.agent = { allowedDomains: ['sports'] }
    auth.permissions = []
    await renderLoaded()
    assert.equal(server.campaignCalls, 0)
    assert.equal(server.kpiCalls.length, 0)
    assert.ok(screen.getByText('Whitelabel ledger KPIs are hidden for agent login'))
    assert.ok(
      screen.getByText(
        'These metrics aggregate all bonus awards for the whole whitelabel. The section below reflects your downline bonus cards only.',
      ),
    )
    assert.ok(screen.queryByRole('link', { name: 'Diwali Reload' }) === null, 'no campaign link')
    assert.ok(screen.getByText('Diwali Reload'))
    assert.ok(screen.queryByRole('combobox', { name: 'Campaign' }) === null, 'no campaign filter')
    assert.ok(screen.queryByRole('combobox', { name: 'Agent' }) === null, 'no agent filter')
  })
})

describe('BonusAwardsListPage states, paging, filters and refresh', () => {
  test('loading, then the empty state with a zero count', async () => {
    server.rows = []
    server.total = 0
    renderPage()
    const cardFigures = screen.getByRole('region', { name: 'Bonus cards (filtered list scope)' })
    assert.ok(cardFigures.querySelector('[aria-busy="true"]'), 'the card tiles hold their place while the stats load')
    assert.ok(await screen.findByText('No bonus cards for these filters'))
    assert.ok(screen.getByText('0 bonus cards'))
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /Showing 0 of 0 cards/)
  })

  test('a failed list query raises the legacy toast and offers Retry in the table', async () => {
    server.pageError = 'Bonus awards unavailable'
    renderPage()
    const table = await screen.findByRole('table', { name: 'Bonus cards' })
    await within(table).findByText('Bonus awards unavailable')
    assert.ok(screen.queryByText('No bonus cards for these filters') === null, 'not the empty copy')
    assert.ok(screen.queryByRole('navigation', { name: 'Pagination' }) === null, 'no pager without data')
    await waitFor(() =>
      assert.ok(
        toastCalls().some(
          (call) => call.title === 'Bonus cards' && call.message === 'Bonus awards unavailable' && call.tone === 'error',
        ),
      ),
    )

    server.pageError = null
    const before = server.pageCalls.length
    fireEvent.click(within(table).getByRole('button', { name: 'Retry' }))
    await screen.findByText('Diwali Reload')
    assert.ok(server.pageCalls.length > before)
  })

  test('a page change stays on that page while it loads, and a new page size starts again at 0', async () => {
    server.total = 120
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Page Two Card')
    assert.deepStrictEqual(
      server.pageCalls.map((call) => call.offset),
      [0, 50],
      'no snap back to the first page',
    )
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /Showing 51–100 of 120 cards/)

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '20' } })
    await waitFor(() => assert.deepStrictEqual(server.pageCalls.at(-1), {
      filters: lastPageFilters(),
      offset: 0,
      limit: 20,
    }))
  })

  test('the pager and the count stay mounted, keeping focus, while another page or page size loads', async () => {
    server.total = 120
    await renderLoaded()
    const tableCard = screen.getByRole('region', { name: 'Bonus cards' })
    const next = screen.getByRole('button', { name: 'Next page' })
    next.focus()
    fireEvent.click(next)

    assert.ok(screen.queryByText('Page Two Card') === null, 'the second page has not resolved yet')
    assert.ok(next.isConnected, 'Next page was not unmounted')
    assert.ok(document.activeElement === next, 'focus stays on Next page while it loads')
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /of 120 cards/)
    assert.ok(within(tableCard).getByText('120 bonus cards'), 'the count keeps the last total')

    await screen.findByText('Page Two Card')
    assert.ok(next.isConnected, 'the same pager after the load')
    assert.ok(document.activeElement === next, 'focus survives the load')
    assert.deepStrictEqual(server.pageCalls.map((call) => call.offset), [0, 50])

    const rowsPerPage = screen.getByLabelText('Rows per page:')
    rowsPerPage.focus()
    fireEvent.change(rowsPerPage, { target: { value: '20' } })
    assert.ok(rowsPerPage.isConnected, 'Rows per page was not unmounted')
    assert.ok(document.activeElement === rowsPerPage, 'focus stays on Rows per page while it loads')
    await waitFor(() => assert.deepStrictEqual(server.pageCalls.at(-1), {
      filters: lastPageFilters(),
      offset: 0,
      limit: 20,
    }))
    await screen.findByText('Diwali Reload')
    assert.ok(document.activeElement === rowsPerPage, 'focus survives the page-size load')
  })

  test('filters reach the list, stats and KPI queries and reset the page', async () => {
    server.total = 120
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Page Two Card')

    fireEvent.change(screen.getByRole('combobox', { name: 'Domain' }), { target: { value: 'casino' } })
    await waitFor(() => {
      assert.equal(lastPageFilters().domain, 'casino')
      assert.equal(server.pageCalls.at(-1)?.offset, 0, 'a filter change returns to the first page')
    })
    await waitFor(() => assert.equal((server.kpiCalls.at(-1)?.filter as Record<string, unknown>).domain, 'casino'))
    assert.equal((server.statsCalls.at(-1)?.filters as Record<string, unknown>).domain, 'casino')

    const campaign = screen.getByRole('combobox', { name: 'Campaign' })
    fireEvent.change(campaign, { target: { value: 'Week' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Weekend Boost (#14)' }))
    await waitFor(() => assert.equal(lastPageFilters().campaignId, 14))
    await waitFor(() => assert.equal((server.kpiCalls.at(-1)?.filter as Record<string, unknown>).campaignId, '14'))

    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Yesterday' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const yesterday = getBonusAwardsRangeForPreset('yesterday')
    await waitFor(() => assert.equal(lastPageFilters().dateFrom, yesterday?.from))
    assert.equal(lastPageFilters().dateTo, yesterday?.to)
    assert.ok(screen.getByRole('button', { name: 'Date range: Yesterday' }))
    assert.ok(screen.getByText('3 filters applied'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    const today = bonusAwardsToday()
    await waitFor(() => assert.deepStrictEqual(lastPageFilters(), { dateFrom: today, dateTo: today }))
  })

  test('Refresh refetches the list, the stats, the KPIs and the campaigns', async () => {
    await renderLoaded()
    const before = [server.pageCalls.length, server.statsCalls.length, server.kpiCalls.length, server.campaignCalls]
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      assert.ok(server.pageCalls.length > before[0], 'list')
      assert.ok(server.statsCalls.length > before[1], 'stats')
      assert.ok(server.kpiCalls.length > before[2], 'kpis')
      assert.ok(server.campaignCalls > before[3], 'campaigns')
    })
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy'), null))
  })
})

describe('BonusAwardsListPage remark dialog', () => {
  test('Activate asks for a remark and sends it trimmed; success closes, toasts and refetches', async () => {
    server.replies.activate = [{ success: true, message: 'Bonus card activated' }]
    await renderLoaded()
    const dialog = await openDialogFrom('Activate bonus card 91')

    assert.ok(within(dialog).getByRole('heading', { name: 'Activate this bonus card?' }))
    assert.ok(
      within(dialog).getByText(
        'This runs the same activation rules as the user app (first deposit, expiry, wallet credit).',
      ),
    )
    const remark = within(dialog).getByRole('textbox', { name: 'Remark (required)' })
    assert.equal(remark.getAttribute('placeholder'), 'Internal note — appears in the Remark column on Bonus cards')
    assert.equal(remark.getAttribute('maxlength'), '500')
    await waitFor(() => assert.ok(document.activeElement === remark, 'focus starts in the remark'))
    assert.ok(within(dialog).getByText('0 / 500'))

    const confirm = within(dialog).getByRole('button', { name: 'Activate' })
    assert.equal(confirm.getAttribute('aria-disabled'), 'true')
    const reasonId = confirm.getAttribute('aria-describedby') ?? ''
    assert.equal(document.getElementById(reasonId)?.textContent, 'Please enter a remark before confirming this action.')
    fireEvent.click(confirm)
    assert.equal(server.mutations.length, 0, 'a blank remark sends nothing')

    fireEvent.change(remark, { target: { value: '  KYC verified by phone  ' } })
    assert.equal(confirm.getAttribute('aria-disabled'), null)
    const listCalls = server.pageCalls.length
    fireEvent.click(confirm)

    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null, 'the dialog closed'))
    assert.deepStrictEqual(server.mutations, [
      { name: 'activate', variables: { awardId: '91', remark: 'KYC verified by phone' } },
    ])
    assert.ok(
      toastCalls().some((call) => call.message === 'Bonus card activated' && call.tone === 'ok' && call.duration === 4500),
    )
    await waitFor(() => assert.ok(server.pageCalls.length > listCalls, 'the list is refetched'))
  })

  test('an activation refused with ALREADY_ACTIVE_BONUS turns into the switch dialog, keeping the remark', async () => {
    server.replies.activate = [{ success: false, code: 'ALREADY_ACTIVE_BONUS', message: 'Player has an active bonus' }]
    server.replies.switch = [{ success: true, message: null }]
    await renderLoaded()
    const dialog = await openDialogFrom('Activate bonus card 91')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Remark (required)' }), { target: { value: 'Swap' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Activate' }))

    await screen.findByRole('heading', { name: 'Switch to this bonus?' })
    const switchDialog = screen.getByRole('alertdialog')
    assert.ok(
      within(switchDialog).getByText(
        'Another bonus is already active for this player. This cancels it and activates this card.',
      ),
    )
    assert.equal(
      (within(switchDialog).getByRole('textbox', { name: 'Remark (required)' }) as HTMLTextAreaElement).value,
      'Swap',
    )
    assert.equal(toastCalls().length, 0, 'no error toast for the switch')

    fireEvent.click(within(switchDialog).getByRole('button', { name: 'Switch bonus' }))
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null, 'the dialog closed'))
    assert.deepStrictEqual(server.mutations.map((m) => [m.name, m.variables]), [
      ['activate', { awardId: '91', remark: 'Swap' }],
      ['switch', { awardId: '91', remark: 'Swap' }],
    ])
    assert.ok(toastCalls().some((call) => call.message === 'Bonus switched' && call.tone === 'ok'))
  })

  test('Set status → Cancel (revoke): a refusal raises the legacy error and keeps the dialog open', async () => {
    server.replies.setStatus = [{ success: false, message: 'Card already used' }]
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Set status for bonus card 91' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Cancel (revoke)' }))
    const dialog = await screen.findByRole('alertdialog')

    assert.ok(within(dialog).getByRole('heading', { name: 'Cancel (revoke) this bonus card?' }))
    assert.ok(
      within(dialog).getByText(
        'The pending bonus will be cancelled. No wallet amount is removed (card was not active yet).',
      ),
    )
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Remark (required)' }), { target: { value: 'Duplicate' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      assert.ok(toastCalls().some((call) => call.title === 'Bonus card' && call.message === 'Card already used' && call.tone === 'error')),
    )
    assert.deepStrictEqual(server.mutations, [
      { name: 'setStatus', variables: { awardId: '91', status: 'cancelled', remark: 'Duplicate' } },
    ])
    assert.ok(screen.getByRole('alertdialog'), 'the dialog stays open for another try')
  })

  test('Set status → Mark expired: a thrown error is reported and Back closes without sending', async () => {
    server.replies.setStatus = [new Error('Network down')]
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Set status for bonus card 91' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mark expired' }))
    const dialog = await screen.findByRole('alertdialog')
    assert.ok(within(dialog).getByRole('heading', { name: 'Mark this bonus expired?' }))
    assert.ok(within(dialog).getByText('The pending bonus will be marked as expired.'))

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Remark (required)' }), { target: { value: 'Late' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      assert.ok(toastCalls().some((call) => call.title === 'Bonus card' && call.message === 'Network down')),
    )
    assert.deepStrictEqual(server.mutations[0], {
      name: 'setStatus',
      variables: { awardId: '91', status: 'expired', remark: 'Late' },
    })

    await waitFor(() => assert.equal(within(dialog).getByRole('button', { name: 'Back' }).hasAttribute('disabled'), false))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }))
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null, 'the dialog closed'))
    assert.equal(server.mutations.length, 1)
  })

  /* jsdom does not enforce `inert`, so the menu's own return-focus microtask can reach the trigger behind the
     open modal, which a browser refuses. Each case lets that settle and then puts focus in the remark, where a
     browser keeps it, so only the dialog's own restore can bring focus back to the trigger. */
  async function focusRemarkIn(dialog: HTMLElement) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const remark = within(dialog).getByRole('textbox', { name: 'Remark (required)' })
    remark.focus()
    assert.ok(document.activeElement === remark, 'focus is inside the dialog')
  }

  test('a dialog opened from the Set status menu returns focus to that menu button when closed', async () => {
    await renderLoaded()
    const trigger = screen.getByRole('button', { name: 'Set status for bonus card 91' })

    trigger.focus()
    fireEvent.click(trigger)
    let item = await screen.findByRole('menuitem', { name: 'Cancel (revoke)' })
    item.focus()
    fireEvent.click(item)
    let dialog = await screen.findByRole('alertdialog')
    assert.ok(!item.isConnected, 'the menu item that opened the dialog is gone')
    await focusRemarkIn(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }))
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null, 'the dialog closed'))
    await waitFor(() => assert.ok(document.activeElement === trigger, 'Back returns focus to Set status'))

    fireEvent.click(trigger)
    item = await screen.findByRole('menuitem', { name: 'Mark expired' })
    item.focus()
    fireEvent.click(item)
    dialog = await screen.findByRole('alertdialog')
    await focusRemarkIn(dialog)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null, 'Escape closed the dialog'))
    await waitFor(() => assert.ok(document.activeElement === trigger, 'Escape returns focus to Set status'))
    assert.equal(server.mutations.length, 0, 'closing sends nothing')
  })

  test('Forfeit sends the forfeit mutation; a reopened dialog starts with an empty remark', async () => {
    server.replies.forfeit = [{ success: false, message: 'Wallet locked' }, { success: true, message: null }]
    await renderLoaded()
    let dialog = await openDialogFrom('Forfeit bonus card 92')
    assert.ok(within(dialog).getByRole('heading', { name: 'Forfeit this active bonus?' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Remark (required)' }), { target: { value: 'Abuse' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forfeit bonus' }))
    await waitFor(() =>
      assert.ok(toastCalls().some((call) => call.title === 'Forfeit bonus' && call.message === 'Wallet locked')),
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }))
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null, 'the dialog closed'))
    await waitFor(() =>
      assert.ok(
        document.activeElement === screen.getByRole('button', { name: 'Forfeit bonus card 92' }),
        'Back returns focus to Forfeit',
      ),
    )
    dialog = await openDialogFrom('Forfeit bonus card 92')
    const remark = within(dialog).getByRole('textbox', { name: 'Remark (required)' }) as HTMLTextAreaElement
    assert.equal(remark.value, '')
    fireEvent.change(remark, { target: { value: 'Abuse confirmed' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forfeit bonus' }))
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null, 'the dialog closed'))
    assert.deepStrictEqual(server.mutations.map((m) => m.variables), [
      { awardId: '92', remark: 'Abuse' },
      { awardId: '92', remark: 'Abuse confirmed' },
    ])
    assert.ok(toastCalls().some((call) => call.message === 'Bonus forfeited' && call.tone === 'ok'))
  })
})
