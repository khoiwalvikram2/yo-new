import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { PlayerOverview } from './PlayerOverview'

type QueryDocument = { definitions: Array<{ name?: { value?: string } }> }

const hooks = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@apollo/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@apollo/client')>()), useQuery: hooks.useQuery }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))

// Far from the 7-day line either way, so the real clock never matters.
const LONG_AGO = '2020-01-01T00:00:00.000Z'
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

const bet = (userId: number, betAmount: number) => ({ userId, betAmount, potentialWin: betAmount * 9.5, createdAt: '2026-11-03T08:00:00.000Z' })
// Players 1 and 2 registered long ago, player 3 yesterday; players 4-10 have no open bet.
const BETS = [bet(1, 100), bet(1, 100), bet(2, 50), bet(3, 20)]
const USERS = [
  { id: '1', createdAt: LONG_AGO },
  { id: '2', createdAt: LONG_AGO },
  { id: '3', createdAt: YESTERDAY },
  ...Array.from({ length: 7 }, (_, index) => ({ id: String(index + 4), createdAt: LONG_AGO })),
]
const operation = (document: QueryDocument) => document.definitions[0]?.name?.value
const answer = (matkaBets: unknown[], users: unknown[]) => hooks.useQuery.mockImplementation((document: QueryDocument) =>
  operation(document) === 'MatkaBets' ? { data: { matkaBets } } : { data: { users } })

const stat = (label: string) => within(screen.getByText(label).parentElement!)

beforeEach(() => {
  useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] })
  hooks.useQuery.mockReset()
  answer(BETS, USERS)
})

test('Retention Rate is the share of the players with open bets who registered over 7 days ago', () => {
  render(<PlayerOverview />)
  // 2 of the 3 players with open bets are returning; the 7 players without one do not count (it read 2 of 10, 20.0%)
  stat('Returning Players').getByText('2')
  stat('Retention Rate').getByText('66.7%')
  stat('Retention Rate').getByText('Share of players with open bets who registered over 7 days ago')
  assert.equal(screen.queryByText('20.0%'), null)
})

test('Retention Rate is 0.0% with no open bets, and 100.0% when every player with an open bet is returning', () => {
  answer([], USERS)
  const page = render(<PlayerOverview />)
  stat('Retention Rate').getByText('0.0%')
  page.unmount()

  answer([bet(1, 100), bet(2, 50), bet(2, 10)], USERS)
  render(<PlayerOverview />)
  stat('Retention Rate').getByText('100.0%')
  stat('Returning Players').getByText('2')
})

// H403 (owner, 2026-11-04): Avg Wagered/Player was shown to every role, beside the amounts TopPlayersTable and
// PlayerProfitability mask. A role without settlements.center view sees the counts and rates, not the average.
test('Avg Wagered/Player is masked without settlements.center view; the counts and rates stay', () => {
  useAuthStore.setState({ permissions: [{ domain: 'matka', actions: ['read'] }] })
  render(<PlayerOverview />)
  stat('Avg Wagered/Player').getByText('••••')
  assert.equal(screen.queryByText(/INR/), null, 'no amount shown')
  stat('Retention Rate').getByText('66.7%')
  stat('Avg Bets/Player').getByText('1.3')
  stat('Returning Players').getByText('2')
})

test('Avg Wagered/Player shows with settlements.center view, directly or through finance read', () => {
  for (const permissions of [[{ domain: 'settlements.center', actions: ['view'] }], [{ domain: 'finance', actions: ['read'] }]]) {
    useAuthStore.setState({ permissions })
    const page = render(<PlayerOverview />)
    // 270 staked on open bets by 3 players.
    stat('Avg Wagered/Player').getByText('INR 90.00')
    assert.equal(screen.queryByText('••••'), null, JSON.stringify(permissions))
    page.unmount()
  }
})
