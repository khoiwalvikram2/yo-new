import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { BidTypeAnalytics } from './BidTypeAnalytics'
import { MatkaAnalytics } from './MatkaAnalytics'
import { DigitFrequencyAnalysis } from './DigitFrequencyAnalysis'
import { DigitHeatmap } from './DigitHeatmap'
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount * 2, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))
beforeEach(() => useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] }))
test('bid ranking retains top ten, conversion and signed GGR without inventing a finance guard', () => {
  useAuthStore.setState({ permissions: [] })
  render(<BidTypeAnalytics breakdown={{ byBidType: Array.from({ length: 12 }, (_, i) => ({ bidType: `bid-${i}`, wagered: i * 10, payouts: i, ggr: -i, bets: i + 1 })) }} />)
  const rows = screen.getAllByRole('listitem'); assert.equal(rows.length, 10)
  within(rows[0]).getByText('bid-11'); within(rows[0]).getByText('INR 220.00'); within(rows[0]).getByText('INR -22.00')
  assert.equal(screen.queryByText('bid-0'), null)
})
test('Matka exposure excludes negative differences and preserves money masking', () => {
  const rows = [{ matkaId: 'm1', matkaName: 'Kalyan', wagered: 100, payouts: 150, ggr: -50, bets: 2 }, { matkaId: 'm2', matkaName: 'Main', wagered: 50, payouts: 10, ggr: 40, bets: 1 }]
  const page = render(<MatkaAnalytics breakdown={{ byMatka: rows }} />)
  within(screen.getByText('Total Wagered').parentElement!).getByText('INR 300.00'); assert.ok(screen.getAllByText('INR 80.00').length >= 1)
  page.unmount(); useAuthStore.setState({ permissions: [] }); render(<MatkaAnalytics breakdown={{ byMatka: rows }} />)
  assert.ok(screen.getAllByText('••••').length >= 8); assert.equal(screen.queryByText('INR 300.00'), null)
})
test('digit frequency orders by bets and retains frequency and exposure math', () => {
  render(<DigitFrequencyAnalysis breakdown={{ byDigit: [{ digit: '1', bets: 2, wagered: 30, payouts: 10, exposure: 20 }, { digit: '2', bets: 6, wagered: 90, payouts: 40, exposure: 50 }] }} />)
  const rows = screen.getAllByRole('listitem'); within(rows[0]).getByText('Digit #2'); within(rows[0]).getByText('75.0%'); within(rows[0]).getByText('INR 100.00')
  assert.equal(screen.getByRole('meter', { name: 'Relative frequency of digit 1' }).getAttribute('aria-valuenow'), '33')
})
test('digit heatmap aggregates duplicate digits, keeps ten cells and excludes out of range identifiers', () => {
  render(<DigitHeatmap breakdown={{ byDigit: [{ digit: '2', bets: 2, wagered: 20, payouts: 0, exposure: 5 }, { digit: '2', bets: 3, wagered: 30, payouts: 0, exposure: 10 }, { digit: '12', bets: 100, wagered: 100, payouts: 0, exposure: 100 }] }} />)
  screen.getByLabelText('Digit 2: 5 bets, exposure INR 30.00'); screen.getByText(/1\/10 digits active/)
  assert.equal(document.querySelectorAll('[aria-label^="Digit "]').length, 10)
})
