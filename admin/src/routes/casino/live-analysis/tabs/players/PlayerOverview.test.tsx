import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PlayerOverview } from './PlayerOverview'

type QueryDocument = { definitions: Array<{ name?: { value?: string } }> }

const hooks = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@apollo/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@apollo/client')>()), useQuery: hooks.useQuery }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))

// Far before the 60-minute window, and a registration inside it, so the real clock never matters.
const LONG_AGO = '2020-01-01T00:00:00.000Z'
const JUST_NOW = new Date(Date.now() - 60 * 1000).toISOString()

const bet = (userId: number, stake: number) => ({ userId, stake, payout: 0, createdAt: new Date().toISOString() })
// Players 1 and 2 registered long ago, player 3 inside the window; players 4-10 did not bet.
const BETS = [bet(1, 100), bet(1, 100), bet(2, 50), bet(3, 20)]
const USERS = [
  { id: '1', createdAt: LONG_AGO },
  { id: '2', createdAt: LONG_AGO },
  { id: '3', createdAt: JUST_NOW },
  ...Array.from({ length: 7 }, (_, index) => ({ id: String(index + 4), createdAt: LONG_AGO })),
]
const operation = (document: QueryDocument) => document.definitions[0]?.name?.value
const answer = (casinoBets: unknown[], users: unknown[]) => hooks.useQuery.mockImplementation((document: QueryDocument) =>
  operation(document) === 'CasinoBets' ? { data: { casinoBets } } : { data: { users } })

const stat = (label: string) => within(screen.getByText(label).parentElement!)

beforeEach(() => {
  hooks.useQuery.mockReset()
  answer(BETS, USERS)
})

test('Retention Rate is the share of the players who bet in the window and registered before it', () => {
  render(<PlayerOverview />)
  // 2 of the 3 players who bet are returning; the 7 who did not bet do not count (it read 2 of 10, 20.0%)
  stat('Returning Players').getByText('2')
  stat('Retention Rate').getByText('66.7%')
  stat('Retention Rate').getByText('Share of players who bet in this window and registered before it')
  assert.equal(screen.queryByText('20.0%'), null)
})

test('Retention Rate is 0.0% with no bets in the window', () => {
  answer([], USERS)
  render(<PlayerOverview />)
  stat('Retention Rate').getByText('0.0%')
})
