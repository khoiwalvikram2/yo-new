/**
 * OperationsSections is the Overview's operations block, the owner's list (2026-10-29): a cash (B2C)
 * whitelabel sees deposits and withdrawals, pending actions and balances; a credit one sees chip
 * movements, its credit pool and players under agents; one with both sees both, the shared player
 * sections once. This mounts it against a stubbed DashboardOperations reply and reads the figures.
 */
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { ROUTES } from '@/shared/core/constants'
import { OperationsSections } from './OperationsSections'
import { DrilldownProvider } from './DrilldownDialog'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount,
    formatAmount: (amount: number) => `INR ${amount}`,
  }),
}))

afterEach(cleanup)

const OPERATIONS = {
  __typename: 'DashboardOperations',
  showB2C: true, showCredit: false,
  directDeposits: 4000, manualDeposits: 1000, directWithdrawals: 1500, manualWithdrawals: 500,
  pendingDepositRequests: 3, pendingDepositAmount: 900, pendingWithdrawalRequests: 0, pendingWithdrawalAmount: 0,
  pendingPayoutAccounts: 2,
  onlineNow: 7, onlineWindowMins: 10, loggedInPlayers: 40, playersWhoBet: 25, playersWithOpenBet: 6, betsPlaced: 321,
  registeredToday: 4, inactivePlayers: 12, suspendedPlayers: 1,
  walletBalance: 250000, bonusGiven: 300, sharingAgentsActive: 5, commissionAgentsActive: 8,
  chipsDepositedByWhitelabel: 10000, chipsDepositedByAgents: 2000, chipsWithdrawnByWhitelabel: 3000,
  chipsWithdrawnByAgents: 1000, chipsGivenToAgents: 6000,
  creditLimit: 100000, creditUsed: 25000, creditAvailable: 75000, settlementDue: 4000, settledAmount: 1200,
  chipsWithPlayers: 9000, directPlayers: 30, agentPlayers: 70, creditAgentsActive: 9,
  staleSportsBets: 7, staleSportsEvents: 4, staleSportsHours: 24, stuckCasinoRounds: 0, casinoStuckMinutes: 30,
  overdueMatkaBets: 3, overdueMatkaMarkets: 1,
}

const KPIS = { totalDeposits: 5000, totalWithdrawals: 2000, netDeposits: 3000, ftd: 800, ftdCount: 2, totalBets: 321, totalPlayers: 100 }

/** One page of a drill-down, as Query.dashboardDrilldown answers it. */
const DRILL = {
  __typename: 'DashboardDrilldown', kind: 'pending_deposits', title: 'Pending deposit requests', subtitle: 'Waiting for an admin now, oldest first',
  columns: [
    { __typename: 'DashboardDrillColumn', key: 'username', label: 'Player', kind: 'player' },
    { __typename: 'DashboardDrillColumn', key: 'amount', label: 'Amount', kind: 'money' },
    { __typename: 'DashboardDrillColumn', key: 'waiting', label: 'Waiting', kind: 'duration' },
  ],
  rows: [{ __typename: 'DashboardDrillRow', id: '1', cells: ['rakesh001', '1000', '95'], playerId: 746, agentId: null }],
  total: 1,
  page: '/payments/deposits',
}

let drillAsks: Array<Record<string, unknown>>

function mount(overrides: Partial<typeof OPERATIONS>) {
  drillAsks = []
  const link = new ApolloLink((operation) => new Observable((observer) => {
    if (operation.operationName === 'DashboardDrilldown') drillAsks.push(operation.variables)
    const data = operation.operationName === 'DashboardDrilldown' ? { dashboardDrilldown: DRILL } : { dashboardOperations: { ...OPERATIONS, ...overrides } }
    const timer = setTimeout(() => { observer.next({ data }); observer.complete() }, 1)
    return () => clearTimeout(timer)
  }))
  return render(
    <MemoryRouter>
      <ApolloProvider client={new ApolloClient({ link, cache: new InMemoryCache() })}>
        <DrilldownProvider>
          <OperationsSections kpis={KPIS} />
        </DrilldownProvider>
      </ApolloProvider>
    </MemoryRouter>,
  )
}

/** A figure's value: the dd that follows its label in the named section. */
function figure(section: string, label: string): HTMLElement {
  const cell = within(screen.getByRole('region', { name: section })).getByText(label).parentElement
  const value = cell?.querySelector('dd')
  assert.ok(value, `${section} › ${label} has a value`)
  return value as HTMLElement
}

describe('OperationsSections', () => {
  test('a B2C whitelabel sees its money split, pending queues that open their rows, and no credit sections', async () => {
    mount({})
    await screen.findByText('INR 4000')
    assert.equal(figure('Deposits & Withdrawals', 'Manual Deposit').textContent, 'INR 1000')
    assert.equal(figure('Deposits & Withdrawals', 'Direct Deposit').textContent, 'INR 4000')
    assert.equal(figure('Deposits & Withdrawals', 'Total Deposit').textContent, 'INR 5000')
    assert.equal(figure('Deposits & Withdrawals', 'Net Deposit').textContent, 'INR 3000')
    assert.equal(figure('Deposits & Withdrawals', 'First-Time Depositors').textContent, '2')

    // A figure opens the rows behind it: the pending requests, each player linked, the queue's page a click away.
    fireEvent.click(within(figure('Pending Actions', 'Pending Deposit Requests')).getByRole('button', { name: '3' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pending Deposit Requests' })
    assert.equal((await within(dialog).findByRole('link', { name: 'rakesh001' })).getAttribute('href'), '/players/profile/746')
    assert.ok(within(dialog).getByText('1 h 35 min'))
    assert.equal(screen.getByRole('link', { name: 'Open full page' }).getAttribute('href'), ROUTES.PAYMENTS_DEPOSITS)
    assert.equal(drillAsks[0].kind, 'pending_deposits')
    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    assert.equal(figure('Player Activity', 'Bets Placed').textContent, '321')
    assert.equal(figure('Registrations & Status', 'Total Registered').textContent, '100')
    assert.equal(figure('Balances & Agents', 'Commission Agents').textContent, '8')
    // Payment Speed was taken off the dashboard (the owner, 2026-10-29).
    assert.equal(screen.queryByRole('region', { name: 'Payment Speed' }), null)

    // Awaiting Settlement: what should have settled by now.
    assert.equal(figure('Awaiting Settlement', 'Sports Bets Open > 24h').textContent, '7')
    assert.ok(within(screen.getByRole('region', { name: 'Awaiting Settlement' })).getByText('4 events'))
    assert.equal(figure('Awaiting Settlement', 'Overdue Matka Bets').textContent, '3')
    assert.equal(screen.queryByRole('region', { name: 'Chip Movements' }), null)
    assert.equal(screen.queryByRole('region', { name: 'Players & Agents' }), null)
  })

  test('a credit whitelabel sees chips, its pool and players under agents instead of cash sections', async () => {
    mount({ showB2C: false, showCredit: true })
    await screen.findByRole('region', { name: 'Chip Movements' })
    assert.equal(figure('Chip Movements', 'Total Chips Deposited').textContent, 'INR 12000')
    assert.equal(figure('Chip Movements', 'Total Chips Withdrawn').textContent, 'INR 4000')
    assert.equal(figure('Chip Movements', 'Net Chips').textContent, 'INR 8000')
    assert.ok(within(screen.getByRole('region', { name: 'Credit Pool & Settlement' })).getByText('25.0% of the limit'))
    assert.equal(figure('Players & Agents', 'Agent Players').textContent, '70')
    assert.equal(screen.queryByRole('region', { name: 'Deposits & Withdrawals' }), null)
    assert.equal(screen.queryByRole('region', { name: 'Pending Actions' }), null)
    assert.equal(screen.queryByRole('region', { name: 'Balances & Agents' }), null)
    // Settlement applies to every kind of whitelabel.
    assert.ok(screen.getByRole('region', { name: 'Awaiting Settlement' }))
  })

  test('a whitelabel with both kinds of players sees both sets, the shared sections once', async () => {
    mount({ showB2C: true, showCredit: true })
    await screen.findByRole('region', { name: 'Chip Movements' })
    assert.ok(screen.getByRole('region', { name: 'Deposits & Withdrawals' }))
    assert.equal(screen.getAllByRole('region', { name: 'Player Activity' }).length, 1)
    assert.equal(screen.getAllByRole('region', { name: 'Registrations & Status' }).length, 1)
  })
})
