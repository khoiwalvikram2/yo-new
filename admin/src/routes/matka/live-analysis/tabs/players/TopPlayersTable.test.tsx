import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { TopPlayersTable } from './TopPlayersTable'

const hooks = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@apollo/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@apollo/client')>()), useQuery: hooks.useQuery }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDateTime: (value: string) => value.slice(0, 16) }) }))

const bet = (id: string, userId: number, userName: string, betAmount: number, potentialWin: number | null) => ({
  id, userId, userName, betAmount, potentialWin, status: 'pending', createdAt: '2026-11-03T08:00:00.000Z', matkaType: 'Kalyan', marketName: 'Kalyan', bidType: 'single',
})

beforeEach(() => {
  useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] })
  hooks.useQuery.mockReset()
  hooks.useQuery.mockReturnValue({
    data: { matkaBets: [bet('1', 1, 'Asha', 300, 2850), bet('2', 2, 'Ravi', 1000, 1900), bet('3', 2, 'Ravi', 100, null)] },
    loading: false,
  })
})

test('a player\'s exposure is the open bets\' potential win less the stake (MAT-13)', () => {
  render(<TopPlayersTable sortBy="exposure" />)
  const rows = within(screen.getByRole('table', { name: 'Top Matka players' })).getAllByRole('row').slice(1)
  const cells = rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
  // Asha 2850 - 300 = 2550; Ravi (1900 + 0) - 1100 = 800: ranked by exposure
  assert.deepEqual(cells.map((row) => [row[1], row[2], row[3], row[4]]), [
    ['Asha', 'INR 300.00', 'INR 2850.00', 'INR 2550.00'],
    ['Ravi', 'INR 1100.00', 'INR 1900.00', 'INR 800.00'],
  ])
})

test('ranking by exposure follows the same rule when chosen', () => {
  hooks.useQuery.mockReturnValue({
    data: { matkaBets: [bet('1', 1, 'Asha', 900, 950), bet('2', 2, 'Ravi', 100, 950)] },
    loading: false,
  })
  render(<TopPlayersTable />)
  const names = () => within(screen.getByRole('table', { name: 'Top Matka players' })).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[1]?.textContent)
  // by wagered first, then by exposure: Ravi's 850 beats Asha's 50
  assert.deepEqual(names(), ['Asha', 'Ravi'])
  fireEvent.click(within(screen.getByRole('group', { name: 'Player ranking' })).getByRole('button', { name: 'Exposure' }))
  assert.deepEqual(names(), ['Ravi', 'Asha'])
})
