import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { PlayerAnalyticsWidget } from './PlayerAnalyticsWidget'

type QueryDocument = { definitions: Array<{ name?: { value?: string } }> }
type BetsQuery = { status?: string; statuses?: string[] }

const hooks = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@apollo/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@apollo/client')>()), useQuery: hooks.useQuery }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))

// A placed matka bet is 'active' until it settles (the live site had 12 open bets, all active, and none pending).
const BETS = [
  { userId: 746, userName: 'rakesh001', betAmount: 100, actualWin: null, potentialWin: 950, status: 'active', createdAt: '2026-11-03T08:00:00.000Z' },
  { userId: 746, userName: 'rakesh001', betAmount: 200, actualWin: null, potentialWin: 1900, status: 'active', createdAt: '2026-11-03T08:01:00.000Z' },
  { userId: 12, userName: 'asha', betAmount: 50, actualWin: null, potentialWin: 475, status: 'pending', createdAt: '2026-11-03T08:02:00.000Z' },
  { userId: 31, userName: 'meena', betAmount: 900, actualWin: 0, potentialWin: 8550, status: 'lost', createdAt: '2026-11-02T08:00:00.000Z' },
]
const USERS = [
  { id: '746', vipTierName: 'Silver', createdAt: '2026-10-01T00:00:00.000Z' },
  { id: '12', vipTierName: null, createdAt: '2026-11-01T00:00:00.000Z' },
  { id: '31', vipTierName: 'Gold', createdAt: '2026-09-01T00:00:00.000Z' },
]
const operation = (document: QueryDocument) => document.definitions[0]?.name?.value

// The server's filter (matkaBetsRepo): `statuses` wins over `status`.
const serverBets = ({ status, statuses }: BetsQuery = {}) =>
  BETS.filter((bet) => (statuses?.length ? statuses.includes(bet.status) : !status || bet.status === status))

beforeEach(() => {
  useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] })
  hooks.useQuery.mockReset()
  hooks.useQuery.mockImplementation((document: QueryDocument, options?: { variables?: { query?: BetsQuery } }) =>
    operation(document) === 'MatkaBets' ? { data: { matkaBets: serverBets(options?.variables?.query) } } : { data: { users: USERS } })
})

const section = (heading: string) => within(screen.getByRole('heading', { name: heading }).closest('section')!)

test('asks matkaBets for the open statuses the Players tab asks for', () => {
  render(<PlayerAnalyticsWidget />)
  const betsCall = hooks.useQuery.mock.calls.find(([document]) => operation(document as QueryDocument) === 'MatkaBets')
  assert.deepEqual(betsCall?.[1]?.variables, { query: { statuses: ['pending', 'active'], limit: 5000 } })
})

test('lists the players and VIP tiers of active and pending bets, not settled ones', () => {
  render(<PlayerAnalyticsWidget />)
  assert.equal(screen.queryByText('No player data'), null)
  assert.equal(screen.queryByText('No tier data'), null)

  const players = section('Top Players by Wagered').getAllByRole('listitem')
  assert.deepEqual(players.map((item) => item.querySelector('strong')?.textContent), ['rakesh001', 'asha'])
  within(players[0]).getByText('INR 300.00')
  within(players[1]).getByText('INR 50.00')

  // one tier row per open player's tier; Gold's only bet is settled
  const tiers = section('VIP Tier Distribution').getAllByRole('listitem')
  assert.deepEqual(tiers.map((item) => item.textContent), ['Silver1', 'No Tier1'])
  assert.equal(screen.getByRole('meter', { name: 'Player share for tier Silver' }).getAttribute('aria-valuenow'), '50')
})

// G503: the Players tab masks wagered amounts for a role without settlements.center view (TopPlayersTable,
// PlayerProfitability); Player Analytics showed them. The same rule now applies here.
test('a role without settlements.center view sees the top players and their shares but not the wagered amounts', () => {
  useAuthStore.setState({ permissions: [{ domain: 'matka', actions: ['read'] }] })
  render(<PlayerAnalyticsWidget />)
  const players = section('Top Players by Wagered').getAllByRole('listitem')
  assert.deepEqual(players.map((item) => item.querySelector('strong')?.textContent), ['rakesh001', 'asha'])
  assert.deepEqual(players.map((item) => within(item).getByText('••••').textContent), ['••••', '••••'])
  assert.equal(screen.queryByText(/INR/), null, 'no wagered amount shown')
  // The ranking and the relative bars stay: they are shares, not amounts.
  assert.equal(screen.getByRole('meter', { name: 'Wagered intensity for rakesh001' }).getAttribute('aria-valuenow'), '100')
})

test('a role with settlements.center view (directly or through finance read) sees the amounts', () => {
  for (const permissions of [[{ domain: 'settlements.center', actions: ['view'] }], [{ domain: 'finance', actions: ['read'] }]]) {
    useAuthStore.setState({ permissions })
    const page = render(<PlayerAnalyticsWidget />)
    const players = section('Top Players by Wagered').getAllByRole('listitem')
    within(players[0]).getByText('INR 300.00'); within(players[1]).getByText('INR 50.00')
    assert.equal(screen.queryByText('••••'), null, JSON.stringify(permissions))
    page.unmount()
  }
})
