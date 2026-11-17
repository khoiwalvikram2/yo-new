import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { SelectionRiskDashboard } from './SelectionRiskDashboard'

vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))
beforeEach(() => useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] }))
afterEach(() => vi.restoreAllMocks())

// Since E004 the server sends one bySelection row per matka, market, session, bid type and numbers (as the Exposure
// Book groups them), so one matka's "5" bet in the Open and in the Close session (or under an older bid spelling) is
// two rows with the same matkaId and selection. The list was keyed by those two alone: React saw duplicate keys and,
// when a live frame re-sorted the list, could show one row twice and drop the other.
const row = (marketSession: string | null, bidType: string, exposure: number) => ({
  selection: '5', matkaId: 'm-kalyan', matkaName: 'Kalyan', marketName: 'KALYAN', marketSession, bidType, wagered: 10, payouts: 0, exposure, bets: 1,
})
const listed = () => within(screen.getByRole('region', { name: 'Top Risky Selections' })).getAllByRole('listitem')
  .map((item) => `${within(item).queryByText('open') ? 'open' : within(item).queryByText('close') ? 'close' : '-'} ${item.querySelector('p')?.textContent}`)

test("one matka's rows that share their numbers stay separate rows across live frames", () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const page = render(<SelectionRiskDashboard breakdown={{ bySelection: [row('open', 'SINGLE', 80), row('close', 'SINGLE', 800), row('open', 'Single Digit', 40)] }} />)
  assert.deepEqual(listed(), ['close SINGLE · 5', 'open SINGLE · 5', 'open Single Digit · 5'])
  // The next frame re-sorts them: each row is still shown once, in the new order.
  page.rerender(<SelectionRiskDashboard breakdown={{ bySelection: [row('open', 'SINGLE', 900), row('close', 'SINGLE', 100), row('open', 'Single Digit', 400)] }} />)
  assert.deepEqual(listed(), ['open SINGLE · 5', 'open Single Digit · 5', 'close SINGLE · 5'])
  const duplicateKeys = errors.mock.calls.filter((call) => call.some((part) => String(part).includes('same key')))
  assert.equal(duplicateKeys.length, 0, 'React reported children with the same key')
})

// G502: bySelection holds the server's 200 riskiest selections, and the card summed it, so past 200 selections its
// totals and shares came up short. The server now sends selectionTotals over every selection.
const statValue = (label: string) => within(screen.getByText(label).parentElement!)
const many = (count: number, exposure: (index: number) => number) =>
  Array.from({ length: count }, (_, index) => ({ ...row('open', 'SINGLE_PANNA', exposure(index)), selection: String(100 + index) }))

test('past 200 selections the totals and shares are over every selection, and the card says the list is cut', () => {
  // 200 rows of 100 each (20,000), out of 250 selections whose exposure totals 22,500.
  render(<SelectionRiskDashboard breakdown={{ bySelection: many(200, () => 100), selectionTotals: { selections: 250, wagered: 2500, payouts: 0, exposure: 22500, bets: 260 } }} />)
  statValue('Unique Selections').getByText('250')
  statValue('Total Exposure').getByText('INR 22500.00')
  statValue('Top 5 Concentration').getByText(`${(500 / 22500 * 100).toFixed(1)}%`)
  statValue('Top 10 Concentration').getByText(`${(1000 / 22500 * 100).toFixed(1)}%`)
  assert.ok(screen.getByText('Showing top 200 of 250 selections'))
  // Each row's share is of the full total too.
  within(listedItems()[0]).getByText(`${(100 / 22500 * 100).toFixed(1)}%`)
})

test('under the cap the totals match the rows and no cut is mentioned; an older frame without totals sums the rows', () => {
  const rows = [row('open', 'SINGLE', 600), row('close', 'SINGLE', 300), row('open', 'Single Digit', 100)]
  const page = render(<SelectionRiskDashboard breakdown={{ bySelection: rows, selectionTotals: { selections: 3, wagered: 30, payouts: 0, exposure: 1000, bets: 3 } }} />)
  statValue('Unique Selections').getByText('3'); statValue('Total Exposure').getByText('INR 1000.00')
  assert.equal(screen.queryByText(/^Showing top/), null)
  page.rerender(<SelectionRiskDashboard breakdown={{ bySelection: rows, selectionTotals: null }} />)
  statValue('Unique Selections').getByText('3'); statValue('Total Exposure').getByText('INR 1000.00')
  page.rerender(<SelectionRiskDashboard breakdown={{ bySelection: rows }} />)
  statValue('Total Exposure').getByText('INR 1000.00')
  assert.equal(screen.queryByText(/^Showing top/), null)
})

test('the full total stays masked without the finance view', () => {
  useAuthStore.setState({ permissions: [] })
  render(<SelectionRiskDashboard breakdown={{ bySelection: many(200, () => 100), selectionTotals: { selections: 250, wagered: 2500, payouts: 0, exposure: 22500, bets: 260 } }} />)
  statValue('Total Exposure').getByText('••••')
  assert.equal(screen.queryByText('INR 22500.00'), null)
  assert.ok(screen.getByText('Showing top 200 of 250 selections'))
})

function listedItems() {
  return within(screen.getByRole('region', { name: 'Top Risky Selections' })).getAllByRole('listitem')
}
