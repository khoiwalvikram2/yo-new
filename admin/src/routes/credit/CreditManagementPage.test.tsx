/**
 * /credit mounts three queries behind one tab strip, so a wrong variable, a query that runs on the wrong tab
 * or a guard that lets the wrong caller through would only show in the browser. This mounts the page against
 * MockedProvider (real documents, exact variables: an unmatched request fails the query) and checks what a
 * user reads on each tab and in each state. Currency and dates are stubbed to plain formatters; the role test
 * and the RBAC guard are stubbed so the guard's branch and its requirement are pinned.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import {
  MY_WHITELABEL_CREDIT_HISTORY_QUERY,
  MY_WHITELABEL_CREDIT_QUERY,
  MY_WHITELABEL_SETTLEMENTS_QUERY,
} from '@/lib/graphql/whitelabel'
import CreditManagementPage from './CreditManagementPage'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
}

const auth = vi.hoisted(() => ({ roles: ['Whitelabel Admin'] as string[] }))
const guard = vi.hoisted(() => ({ allowed: true, calls: [] as GuardCall[] }))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `INR ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string) => `shown:${value}`,
  }),
}))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { roles: string[] }) => unknown) => selector({ roles: auth.roles }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

const AT = '2026-10-01T10:00:00.000Z'

const CREDIT = {
  __typename: 'WhitelabelCreditInfo',
  creditLimit: 2500000,
  creditUsed: 942500,
  creditAvailable: 1557500,
  creditAlertThreshold: 80,
  usagePercentage: 37.7,
  isNearLimit: false,
}

function creditMock(overrides: Partial<typeof CREDIT> = {}) {
  const result = vi.fn(() => ({ data: { myWhitelabelCredit: { ...CREDIT, ...overrides } } }))
  const mock: MockedResponse = { request: { query: MY_WHITELABEL_CREDIT_QUERY }, result }
  return { mock, result }
}

function tx(id: string, overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'WhitelabelCreditTransaction',
    id,
    transactionType: 'ALLOCATION',
    amount: 1000,
    balanceBefore: 0,
    balanceAfter: 1000,
    reason: null,
    createdBy: null,
    createdByType: null,
    createdAt: AT,
    playerId: null,
    playerName: null,
    playerEmail: null,
    playerUsername: null,
    playerPhone: null,
    ...overrides,
  }
}

function historyMock(variables: { limit: number; offset: number }, rows: ReturnType<typeof tx>[]) {
  const result = vi.fn(() => ({ data: { myWhitelabelCreditHistory: rows } }))
  const mock: MockedResponse = { request: { query: MY_WHITELABEL_CREDIT_HISTORY_QUERY, variables: { ...variables, limit: variables.limit + 1 } }, result }
  return { mock, result }
}

function agentSettlement(id: string, overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'AgentSettlementTransaction',
    id,
    tenant: 'gb77',
    agentId: 'a1b2c3d4e5f6a7b8',
    agent: { __typename: 'AgentBasic', id: 'a1b2c3d4e5f6a7b8', username: 'north_desk', schemeType: 'CREDIT' },
    settlementType: 'P_L',
    amount: 1000,
    direction: 'TO_AGENT',
    previousBalance: 0,
    newBalance: 1000,
    notes: null,
    settledBy: null,
    createdAt: AT,
    ...overrides,
  }
}

function settlementsMock(
  variables: { limit: number; offset: number },
  summary: {
    agentSettlements: ReturnType<typeof agentSettlement>[]
    whitelabelSettlements: ReturnType<typeof tx>[]
    totalAgentSettled: number
    totalWhitelabelSettled: number
  },
) {
  const result = vi.fn(() => ({
    data: { myWhitelabelSettlements: { __typename: 'WhitelabelSettlementSummary', agentCount: summary.agentSettlements.length, whitelabelCount: summary.whitelabelSettlements.length, ...summary } },
  }))
  const mock: MockedResponse = { request: { query: MY_WHITELABEL_SETTLEMENTS_QUERY, variables: { limit: variables.limit, agentOffset: variables.offset, whitelabelOffset: variables.offset } }, result }
  return { mock, result }
}

function renderPage(mocks: MockedResponse[]) {
  return render(
    <MemoryRouter>
      <MockedProvider mocks={mocks}>
        <CreditManagementPage />
      </MockedProvider>
    </MemoryRouter>,
  )
}

function bodyRows(table: HTMLElement) {
  return within(table).getAllByRole('row').slice(1)
}

function cellTexts(row: HTMLElement) {
  return within(row).getAllByRole('cell').map((cell) => cell.textContent)
}

beforeEach(() => {
  auth.roles = ['Whitelabel Admin']
  guard.allowed = true
  guard.calls = []
})

describe('CreditManagementPage — access', () => {
  test('a whitelabel admin (by role name) skips the RBAC guard and the credit query runs', async () => {
    const credit = creditMock()
    renderPage([credit.mock])

    assert.ok(await screen.findByText('INR 2500000.00'))
    assert.equal(guard.calls.length, 0)
    assert.equal(credit.result.mock.calls.length, 1)
  })

  test('anyone else passes the credit.management view guard', async () => {
    auth.roles = ['Finance Manager']
    const credit = creditMock()
    renderPage([credit.mock])

    assert.ok(await screen.findByText('INR 2500000.00'))
    assert.ok(guard.calls.length > 0)
    assert.deepEqual(guard.calls[0].required, [{ domain: 'credit.management', actions: ['view'] }])
  })

  test('a denied caller sees the guard and starts no query', async () => {
    auth.roles = ['Support']
    guard.allowed = false
    const credit = creditMock()
    renderPage([credit.mock])

    assert.equal(screen.getByRole('alert').textContent, 'Access denied')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(credit.result.mock.calls.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })
})

describe('CreditManagementPage — overview', () => {
  test('renders the header, the tab strip and a loading state before the credit arrives', async () => {
    renderPage([creditMock().mock])

    const headings = screen.getAllByRole('heading', { level: 1 })
    assert.equal(headings.length, 1)
    assert.equal(headings[0].textContent, 'Credit Management')
    assert.ok(screen.queryByText('Manage your whitelabel credit and view history') === null)
    assert.ok(screen.getByRole('button', { name: 'Refresh' }))

    const tablist = screen.getByRole('tablist', { name: 'Credit Management tabs selector' })
    const tabs = within(tablist).getAllByRole('tab')
    assert.deepEqual(tabs.map((tab) => tab.textContent), ['Overview', 'Adjustments', 'Settlements'])
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true')
    const panel = screen.getByRole('tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), tabs[0].id)

    const figures = screen.getByLabelText('Credit figures')
    assert.equal(figures.getAttribute('aria-busy'), 'true')
    assert.equal(within(figures).getAllByText('Loading').length, 4)
    await screen.findByText('INR 2500000.00')
    assert.equal(screen.getByLabelText('Credit figures').hasAttribute('aria-busy'), false)
  })

  test('shows the four figures, a healthy status and the utilisation bar without a banner', async () => {
    renderPage([creditMock().mock])
    await screen.findByText('INR 2500000.00')

    const figures = screen.getByLabelText('Credit figures')
    assert.match(figures.textContent ?? '', /Credit Limit/)
    assert.ok(within(figures).getByText('Total allocated credit'))
    assert.ok(within(figures).getByText('INR 942500.00'))
    assert.ok(within(figures).getByText('37.7% of limit'))
    assert.ok(within(figures).getByText('INR 1557500.00'))
    assert.ok(within(figures).getByText('62.3% remaining'))
    assert.ok(within(figures).getByText('37.7%'))
    assert.ok(within(figures).getByText('Healthy'))
    assert.match(figures.textContent ?? '', /Threshold: 80%/)

    const card = screen.getByRole('region', { name: 'Credit Utilization' })
    assert.equal(within(card).getByRole('heading', { level: 2 }).textContent, 'Credit Utilization')
    assert.ok(within(card).getByText('62.3% available'))
    assert.ok(within(card).getByText('37.7% used'))
    assert.ok(within(card).getByText('Alert Threshold: 80%'))
    assert.equal(screen.queryByRole('meter'), null)
    const fill = card.querySelector<HTMLElement>('[aria-hidden="true"] span')
    assert.equal(fill?.style.width, '37.7%')

    assert.ok(screen.queryByText('Credit Limit Warning') === null)
  })

  test('raises the near-limit banner with the critical status', async () => {
    renderPage([creditMock({ usagePercentage: 92.5, isNearLimit: true }).mock])

    assert.ok(await screen.findByText('Credit Limit Warning'))
    assert.ok(screen.getByText('You are using 92.5% of your credit limit.'))
    assert.ok(screen.getByText('Critical'))
    assert.ok(screen.getByText('7.5% remaining'))
  })

  test('says so when the credit cannot be loaded', async () => {
    renderPage([{ request: { query: MY_WHITELABEL_CREDIT_QUERY }, error: new Error('Tenant not found') }])
    assert.ok(await screen.findByText('Unable to load credit information'))
  })

  test('Refresh fetches the credit again', async () => {
    const first = creditMock()
    const second = creditMock({ creditUsed: 1000000, creditAvailable: 1500000, usagePercentage: 40 })
    renderPage([first.mock, second.mock])
    await screen.findByText('INR 942500.00')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    assert.ok(await screen.findByText('INR 1000000.00'))
    assert.equal(first.result.mock.calls.length, 1)
    assert.equal(second.result.mock.calls.length, 1)
  })
})

describe('CreditManagementPage — adjustments', () => {
  const fullPage = Array.from({ length: 20 }, (_, index) => tx(`h${index + 1}`))

  test('queries only once the tab opens, with the first page variables, and draws each row rule', async () => {
    const history = historyMock({ limit: 20, offset: 0 }, [
      tx('h1', { transactionType: 'RELEASE', amount: -500, playerId: 22, playerPhone: ' 9876543210 ', createdBy: 'ops_lead', reason: 'Withdrawal Request #5' }),
      tx('h2', { transactionType: 'DEPOSIT', amount: 250, balanceBefore: 1000, balanceAfter: 750, playerId: 23 }),
      tx('h3', { transactionType: 'ADJUSTMENT', amount: 75, balanceBefore: 100, balanceAfter: 175 }),
    ])
    renderPage([creditMock().mock, history.mock])
    await screen.findByText('INR 2500000.00')
    assert.equal(history.result.mock.calls.length, 0)

    fireEvent.click(screen.getByRole('tab', { name: 'Adjustments' }))
    assert.equal(screen.getByRole('tab', { name: 'Adjustments' }).getAttribute('aria-selected'), 'true')
    assert.ok(screen.getByText('Loading Credit adjustment history'))

    const card = await screen.findByRole('region', { name: 'Credit Adjustment History' })
    await within(card).findByText('3 transactions')
    assert.equal(history.result.mock.calls.length, 1)

    const table = within(card).getByRole('table', { name: 'Credit adjustment history' })
    assert.deepEqual(
      within(table).getAllByRole('columnheader').map((th) => th.textContent),
      ['Date', 'Type', 'Amount', 'Before', 'After', 'Phone', 'By', 'Reason'],
    )
    const rows = bodyRows(table)
    assert.deepEqual(cellTexts(rows[0]), [
      `shown:${AT}`, 'WITHDRAW', '+INR 500.00', 'INR 0.00', 'INR 1000.00', '9876543210', 'ops_lead', 'Withdrawal Request #5',
    ])
    assert.deepEqual(cellTexts(rows[1]), [
      `shown:${AT}`, 'DEPOSIT', '-INR 250.00', 'INR 1000.00', 'INR 750.00', 'View profile', 'System', '—',
    ])
    assert.deepEqual(cellTexts(rows[2]), [
      `shown:${AT}`, 'ADJUSTMENT', '+INR 75.00', 'INR 100.00', 'INR 175.00', '—', 'System', '—',
    ])
    assert.equal(within(rows[0]).getByRole('link', { name: '9876543210' }).getAttribute('href'), '/players/profile/22')
    assert.equal(within(rows[1]).getByRole('link', { name: 'View profile' }).getAttribute('href'), '/players/profile/23')
    assert.equal(within(rows[2]).queryByRole('link'), null)

    const pager = within(card).getByRole('navigation', { name: 'Pagination' })
    assert.equal(pager.querySelector('p')?.textContent, 'Showing 1–3')
    assert.ok(within(pager).getByText('Page 1'))
    assert.equal(within(pager).getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true)
    assert.equal(within(pager).getByRole('button', { name: 'Next' }).hasAttribute('disabled'), true)
  })

  test('a full page offers Next, which asks the server for the next offset', async () => {
    const first = historyMock({ limit: 20, offset: 0 }, [...fullPage, tx('lookahead')])
    const second = historyMock({ limit: 20, offset: 20 }, [tx('h21'), tx('h22'), tx('h23')])
    renderPage([creditMock().mock, first.mock, second.mock])
    await screen.findByText('INR 2500000.00')
    fireEvent.click(screen.getByRole('tab', { name: 'Adjustments' }))

    const card = await screen.findByRole('region', { name: 'Credit Adjustment History' })
    await within(card).findByText('Page 1 • 20 rows')
    const pager = within(card).getByRole('navigation', { name: 'Pagination' })
    assert.equal(pager.querySelector('p')?.textContent, 'Showing 1–20 (more available)')

    fireEvent.click(within(pager).getByRole('button', { name: 'Next' }))
    await within(card).findByText('Page 2 • 3 rows')
    assert.equal(second.result.mock.calls.length, 1)
    const nextPager = within(card).getByRole('navigation', { name: 'Pagination' })
    assert.equal(nextPager.querySelector('p')?.textContent, 'Showing 21–23')
    assert.ok(within(nextPager).getByText('Page 2'))
    assert.equal(within(nextPager).getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), false)
    assert.equal(within(nextPager).getByRole('button', { name: 'Next' }).hasAttribute('disabled'), true)
  })

  test('changing rows per page returns to page 1 with the new limit', async () => {
    const first = historyMock({ limit: 20, offset: 0 }, [...fullPage, tx('lookahead')])
    const second = historyMock({ limit: 20, offset: 20 }, Array.from({ length: 21 }, (_, index) => tx(`p2-${index}`)))
    const resized = historyMock({ limit: 10, offset: 0 }, [tx('r1'), tx('r2')])
    renderPage([creditMock().mock, first.mock, second.mock, resized.mock])
    await screen.findByText('INR 2500000.00')
    fireEvent.click(screen.getByRole('tab', { name: 'Adjustments' }))

    const card = await screen.findByRole('region', { name: 'Credit Adjustment History' })
    await within(card).findByText('Page 1 • 20 rows')
    fireEvent.click(within(card).getByRole('button', { name: 'Next' }))
    await within(card).findByText('Page 2 • 20 rows')

    const select = within(card).getByLabelText('Rows per page:') as HTMLSelectElement
    assert.deepEqual([...select.options].map((option) => option.value), ['10', '20', '50', '100'])
    fireEvent.change(select, { target: { value: '10' } })
    await within(card).findByText('2 transactions')
    assert.equal(resized.result.mock.calls.length, 1)
  })

  test('an emptied page after concurrent deletion returns to the first page', async () => {
    const first = historyMock({ limit: 20, offset: 0 }, [...fullPage, tx('lookahead')])
    const empty = historyMock({ limit: 20, offset: 20 }, [])
    const again = historyMock({ limit: 20, offset: 0 }, [...fullPage, tx('lookahead')])
    renderPage([creditMock().mock, first.mock, empty.mock, again.mock])
    await screen.findByText('INR 2500000.00')
    fireEvent.click(screen.getByRole('tab', { name: 'Adjustments' }))

    const card = await screen.findByRole('region', { name: 'Credit Adjustment History' })
    await within(card).findByText('Page 1 • 20 rows')
    fireEvent.click(within(card).getByRole('button', { name: 'Next' }))
    await within(card).findByText('Page 1 • 20 rows')
    await waitFor(() => assert.equal(again.result.mock.calls.length, 1))
    assert.equal(again.result.mock.calls.length, 1)
  })

  test('an empty ledger says so and offers no pager', async () => {
    renderPage([creditMock().mock, historyMock({ limit: 20, offset: 0 }, []).mock])
    await screen.findByText('INR 2500000.00')
    fireEvent.click(screen.getByRole('tab', { name: 'Adjustments' }))

    const card = await screen.findByRole('region', { name: 'Credit Adjustment History' })
    assert.ok(await within(card).findByText('No transaction history'))
    assert.ok(within(card).getByText('0 transactions'))
    assert.equal(within(card).queryByRole('navigation', { name: 'Pagination' }), null)
  })

  test('a failed ledger request says so instead of claiming an empty history', async () => {
    renderPage([
      creditMock().mock,
      { request: { query: MY_WHITELABEL_CREDIT_HISTORY_QUERY, variables: { limit: 21, offset: 0 } }, error: new Error('boom') },
    ])
    await screen.findByText('INR 2500000.00')
    fireEvent.click(screen.getByRole('tab', { name: 'Adjustments' }))

    const card = await screen.findByRole('region', { name: 'Credit Adjustment History' })
    assert.ok(await within(card).findByText('Unable to load credit history'))
    assert.equal(within(card).queryByText('No transaction history'), null)
  })
})

describe('CreditManagementPage — settlements', () => {
  const summary = {
    agentSettlements: [
      agentSettlement('s1', { notes: 'Weekly P/L', settledBy: 'b7c1' }),
      agentSettlement('s2', {
        agentId: 'f0e1d2c3b4a59687',
        agent: null,
        settlementType: 'CREDIT',
        direction: 'FROM_AGENT',
        amount: 400,
      }),
    ],
    whitelabelSettlements: [
      tx('w1', { transactionType: 'SETTLEMENT', amount: 300, balanceBefore: 1000, balanceAfter: 1300, createdBy: 'director' }),
      tx('w2', { transactionType: 'SETTLEMENT', amount: -50, balanceBefore: 1300, balanceAfter: 1250 }),
    ],
    totalAgentSettled: 1400,
    totalWhitelabelSettled: 250,
  }

  test('queries only once the tab opens and draws the totals and both lists', async () => {
    const settlements = settlementsMock({ limit: 20, offset: 0 }, summary)
    renderPage([creditMock().mock, settlements.mock])
    await screen.findByText('INR 2500000.00')
    assert.equal(settlements.result.mock.calls.length, 0)

    fireEvent.click(screen.getByRole('tab', { name: 'Settlements' }))
    const totals = screen.getByLabelText('Settlement totals')
    assert.equal(totals.getAttribute('aria-busy'), 'true')
    assert.ok(screen.getByText('Loading Agent settlements'))
    assert.ok(screen.getByText('Loading Whitelabel settlements'))

    assert.ok(await within(totals).findByText('INR 1400.00'))
    assert.ok(within(totals).getByText('INR 250.00'))
    assert.equal(within(totals).getAllByText('2 transactions').length, 2)
    assert.equal(settlements.result.mock.calls.length, 1)

    const agentCard = screen.getByRole('region', { name: 'Agent Settlements' })
    assert.ok(within(agentCard).getByText('2 records'))
    const agentTable = within(agentCard).getByRole('table', { name: 'Agent settlements' })
    assert.deepEqual(
      within(agentTable).getAllByRole('columnheader').map((th) => th.textContent),
      ['Date', 'Agent', 'Scheme', 'Type', 'Direction', 'Amount', 'Settled By', 'Notes'],
    )
    const agentRows = bodyRows(agentTable)
    assert.deepEqual(cellTexts(agentRows[0]), [
      `shown:${AT}`, 'north_desk', 'CREDIT', 'P_L', 'To Agent', '+INR 1000.00', 'b7c1', 'Weekly P/L',
    ])
    assert.deepEqual(cellTexts(agentRows[1]), [
      `shown:${AT}`, 'f0e1d2c3...', '', 'CREDIT', 'From Agent', '-INR 400.00', 'System', '—',
    ])

    const whitelabelCard = screen.getByRole('region', { name: 'Whitelabel Settlements' })
    assert.ok(within(whitelabelCard).getByText('2 records'))
    const whitelabelRows = bodyRows(within(whitelabelCard).getByRole('table', { name: 'Whitelabel settlements' }))
    assert.deepEqual(cellTexts(whitelabelRows[0]), [
      `shown:${AT}`, 'SETTLEMENT', '+INR 300.00', 'INR 1000.00', 'INR 1300.00', 'director', '—',
    ])
    assert.deepEqual(cellTexts(whitelabelRows[1]), [
      `shown:${AT}`, 'SETTLEMENT', 'INR -50.00', 'INR 1300.00', 'INR 1250.00', 'System', '—',
    ])

    const pagers = screen.getAllByRole('navigation', { name: 'Pagination' })
    assert.equal(pagers.length, 2)
    assert.equal(pagers[0].querySelector('p')?.textContent, 'Showing 1–2 of 2 records')
    assert.equal(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent).join('|'),
      'Agent Settlements|Whitelabel Settlements')
  })

  test('rows per page refetches with the new limit, back on page 1', async () => {
    const first = settlementsMock({ limit: 20, offset: 0 }, summary)
    const resized = settlementsMock({ limit: 50, offset: 0 }, {
      ...summary,
      agentSettlements: [summary.agentSettlements[0]],
      totalAgentSettled: 1000,
    })
    renderPage([creditMock().mock, first.mock, resized.mock])
    await screen.findByText('INR 2500000.00')
    fireEvent.click(screen.getByRole('tab', { name: 'Settlements' }))
    await screen.findByText('INR 1400.00')

    const [agentSize] = screen.getAllByLabelText('Rows per page:') as HTMLSelectElement[]
    fireEvent.change(agentSize, { target: { value: '50' } })
    await waitFor(() => assert.equal(resized.result.mock.calls.length, 1))
    const agentCard = await screen.findByRole('region', { name: 'Agent Settlements' })
    assert.ok(await within(agentCard).findByText('1 record'))
  })

  test('empty lists say so and offer no pager', async () => {
    renderPage([
      creditMock().mock,
      settlementsMock({ limit: 20, offset: 0 }, {
        agentSettlements: [],
        whitelabelSettlements: [],
        totalAgentSettled: 0,
        totalWhitelabelSettled: 0,
      }).mock,
    ])
    await screen.findByText('INR 2500000.00')
    fireEvent.click(screen.getByRole('tab', { name: 'Settlements' }))

    assert.ok(await screen.findByText('No agent settlements'))
    assert.ok(screen.getByText('No whitelabel settlements'))
    assert.equal(screen.getAllByText('0 records').length, 2)
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)
  })

  test('says so when the settlements cannot be loaded', async () => {
    renderPage([
      creditMock().mock,
      { request: { query: MY_WHITELABEL_SETTLEMENTS_QUERY, variables: { limit: 20, agentOffset: 0, whitelabelOffset: 0 } }, error: new Error('boom') },
    ])
    await screen.findByText('INR 2500000.00')
    fireEvent.click(screen.getByRole('tab', { name: 'Settlements' }))
    assert.ok(await screen.findByText('Unable to load settlement information'))
  })
})
