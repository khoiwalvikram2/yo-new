import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { PlayerProfitability } from './PlayerProfitability'

const hooks = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@apollo/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@apollo/client')>()), useQuery: hooks.useQuery }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount * 2, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))

// Open bets: a matka bet pays potentialWin (the stake times the rate) when it wins, so potentialWin >= betAmount.
const BETS = [
  { userId: 1, userName: 'Asha', betAmount: 100, potentialWin: 950, createdAt: '2026-11-03T08:00:00.000Z' },
  { userId: 1, userName: 'Asha', betAmount: 50, potentialWin: 475, createdAt: '2026-11-03T08:01:00.000Z' },
  { userId: 2, userName: 'Ravi', betAmount: 200, potentialWin: 1900, createdAt: '2026-11-03T08:02:00.000Z' },
  { userId: 3, userName: null, betAmount: 10, potentialWin: 95, createdAt: '2026-11-03T08:03:00.000Z' },
  // no potential win known: nothing to pay, so no exposure (never negative)
  { userId: 4, userName: 'Meena', betAmount: 100, potentialWin: null, createdAt: '2026-11-03T08:04:00.000Z' },
]

const statValue = (label: string) => within(screen.getByText(label).parentElement!)

beforeEach(() => {
  useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] })
  hooks.useQuery.mockReset()
  hooks.useQuery.mockReturnValue({ data: { matkaBets: BETS }, loading: false })
})

test('a player\'s exposure is what the open bets pay if they all win, less the stake (MAT-13)', () => {
  render(<PlayerProfitability />)
  // Asha 1425 - 150 = 1275, Ravi 1900 - 200 = 1700, User #3 95 - 10 = 85, Meena 0: total 3060, converted ×2
  statValue('Total Exposure').getByText('INR 6120.00')
  statValue('Avg Exposure').getByText('INR 1530.00')
  statValue('Total Potential Payouts').getByText('INR 6840.00')

  // the highest exposure first; each shows its own exposure and share of the total
  const players = screen.getAllByRole('listitem')
  assert.deepEqual(players.map((item) => item.querySelector('h3')?.textContent), ['Ravi', 'Asha', 'User #3', 'Meena'])
  within(players[0]).getByText('INR 3400.00')
  within(players[0]).getByText('55.6%')
  within(players[1]).getByText('INR 2550.00')
  within(players[3]).getByText('INR 0.00')

  // the segments read the same exposure: two above 1000, none between 100 and 1000, two at 100 or less
  statValue('High Risk').getByText('2')
  statValue('Medium Risk').getByText('0')
  statValue('Low Risk').getByText('2')
})

test('asks for the open bets only and keeps the amounts masked without the finance view', () => {
  useAuthStore.setState({ permissions: [] })
  render(<PlayerProfitability />)
  const [, options] = hooks.useQuery.mock.calls[0] ?? []
  assert.deepEqual(options?.variables, { query: { statuses: ['pending', 'active'], limit: 10000 } })
  assert.ok(screen.getAllByText('••••').length >= 3)
  assert.ok(screen.queryByText('INR 6120.00') === null, 'no unmasked total')
})
