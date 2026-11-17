import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloProvider } from '@apollo/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import {
  agentSession,
  chipAccountFixture,
  chipRowFixture,
  chipServer,
  chipTotalsFixture,
  type ChipHandler,
  type ChipServer,
} from '@/modules/chips/chipTestKit'
import AgentCreditManagementPage from './CreditManagementPage'

vi.mock('@/ui/components/toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${Number(amount).toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))
vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDateTime: (value: string) => `shown:${value}` }),
}))

const ME = chipAccountFixture({ id: 'agent-1', username: 'agent1', creditReference: 100000, balance: 95000, available: 95000, downlineBalance: 9700, refPnl: 4700, downlineCount: 2 })
const CHILD = chipAccountFixture({ id: 'agent-2', username: 'agent2', parentAgentId: 'agent-1', creditReference: 10000, balance: 9000, available: 9000, refPnl: -1000 })
const PLAYER = chipAccountFixture({ accountType: 'PLAYER', id: 'player-1', username: 'player1', parentAgentId: 'agent-1', playerType: 'AGENT_CREDIT', creditReference: 1000, balance: 700, exposure: 200, available: 500, refPnl: -300 })

const servers: ChipServer[] = []

function handlers(overrides: Record<string, ChipHandler> = {}): Record<string, ChipHandler> {
  return {
    MyChipAccount: () => ({ myChipAccount: ME }),
    ChipDownline: () => ({
      chipDownline: {
        __typename: 'ChipDownline',
        parent: ME,
        pool: null,
        items: [CHILD, PLAYER],
        total: 2,
        totals: chipTotalsFixture({ creditReference: 11000, balance: 9700, exposure: 200, available: 9500, refPnl: -1300 }),
      },
    }),
    ChipStatement: () => ({
      chipStatement: {
        __typename: 'ChipStatementPage',
        rows: [chipRowFixture({ id: 'row-1', kind: 'DEPOSIT', amount: 5000, balanceBefore: 90000, balanceAfter: 95000, counterpartyType: 'whitelabel', counterpartyId: 'tenant-1', counterpartyName: null, remark: 'Opening top-up' })],
        total: 1,
      },
    }),
    ...overrides,
  }
}

function renderPage(overrides: Record<string, ChipHandler> = {}, initialEntries = ['/agent/credit']) {
  const server = chipServer(handlers(overrides))
  servers.push(server)
  render(
    <ApolloProvider client={server.client}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
        <PageEyebrowProvider value="Finance">
          <Routes>
            <Route path="/agent/credit" element={<AgentCreditManagementPage />} />
            <Route path="/agent" element={<p>Agent overview</p>} />
            <Route path="/previous" element={<p>Previous page</p>} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </ApolloProvider>,
  )
  return server
}

beforeEach(() => useAuthStore.setState({ agent: agentSession(), user: undefined, permissions: [], agentPermissions: [], isReadOnly: false }))
afterEach(() => {
  servers.splice(0).forEach((server) => server.client.stop())
})

describe('/agent/credit (the agent Chips page)', () => {
  test('shows the unauthenticated state beneath a stable page header and asks for nothing', async () => {
    useAuthStore.setState({ agent: undefined })
    const server = renderPage()
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Chips' }))
    assert.ok(screen.getByText('Not Authenticated'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.deepEqual(server.calls, [])
  })

  test('keeps the CREDIT-only gate and the overview destination', async () => {
    useAuthStore.setState({ agent: agentSession({ schemeType: 'SHARING' }) })
    const server = renderPage()
    assert.ok(screen.getByText('Access Denied'))
    assert.ok(screen.getByText(/only available for CREDIT scheme agents/))
    fireEvent.click(screen.getByRole('button', { name: 'Go to Overview' }))
    assert.ok(await screen.findByText('Agent overview'))
    assert.deepEqual(server.calls, [])
  })

  test('my figures come from myChipAccount and my direct downline opens with D / W / CR', async () => {
    const server = renderPage()
    const figures = await screen.findByRole('group', { name: 'My chips' })
    // An agent's available is its balance, so the figure shows twice.
    assert.equal((await within(figures).findAllByText('INR 95000.00')).length, 2)
    for (const text of ['Credit Reference', 'INR 100000.00', 'Balance', 'Downline holds INR 9700.00', 'Ref P/L', '+INR 4700.00', 'Upline owes you']) {
      assert.ok(within(figures).getByText(text), text)
    }
    for (const gone of ['Credit Limit', 'Credit Used', 'Usage Status', 'Credit Utilization']) assert.equal(screen.queryByText(gone), null, gone)

    assert.equal(screen.getByRole('tab', { name: /Downline/ }).getAttribute('aria-selected'), 'true')
    const table = await screen.findByRole('table', { name: 'My downline' })
    await within(table).findByText('player1')
    assert.ok(within(table).getByRole('button', { name: 'Deposit chips to agent2' }))
    assert.ok(within(table).getByRole('button', { name: 'Withdraw chips from player1' }))
    assert.deepEqual(server.callsOf('ChipDownline').map((call) => call.variables.parentAgentId), [null])
    assert.equal(server.callsOf('MyChipAccount').length, 1)
    assert.ok(server.calls.every((call) => !/AgentCredit|Settlement|CreditAllocation/.test(call.operationName)), 'no credit-limit reads')
  })

  test('the statement tab reads my chip statement from the first page', async () => {
    const server = renderPage()
    await screen.findByRole('group', { name: 'My chips' })
    assert.equal(server.callsOf('ChipStatement').length, 0, 'the statement loads with its tab')
    fireEvent.click(screen.getByRole('tab', { name: /Statement/ }))
    const table = await screen.findByRole('table', { name: 'My chip statement' })
    await within(table).findByText('Opening top-up')
    assert.ok(within(table).getByText('+INR 5000.00'))
    assert.ok(within(table).getByText('Whitelabel pool'))
    assert.deepEqual(server.callsOf('ChipStatement').map((call) => call.variables), [
      { accountType: 'AGENT', accountId: 'agent-1', from: null, to: null, offset: 0, limit: 20 },
    ])
  })

  test('a failed read says so in the server’s words and can be retried', async () => {
    let fail = true
    const server = renderPage({ MyChipAccount: () => (fail ? new Error('Chips service unavailable') : { myChipAccount: ME }) })
    assert.ok(await screen.findByText('Your chips could not be loaded'))
    assert.ok(screen.getByText('Chips service unavailable'))
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    const figures = await screen.findByRole('group', { name: 'My chips' })
    await within(figures).findAllByText('INR 95000.00')
    assert.equal(server.callsOf('MyChipAccount').length, 2)
  })

  test('keeps the header back action', async () => {
    renderPage({}, ['/previous', '/agent/credit'])
    await screen.findByRole('group', { name: 'My chips' })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => assert.ok(screen.getByText('Previous page')))
  })
})
