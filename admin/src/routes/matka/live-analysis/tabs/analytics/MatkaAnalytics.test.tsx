import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { BidTypeAnalytics } from './BidTypeAnalytics'
import { MatkaAnalytics } from './MatkaAnalytics'
import { MarketSessionAnalytics } from './MarketSessionAnalytics'
import { DigitFrequencyAnalysis } from './DigitFrequencyAnalysis'
import { DigitHeatmap } from './DigitHeatmap'
import { DigitAnalytics } from './DigitAnalytics'
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount * 2, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))
beforeEach(() => useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] }))
test('bid ranking retains top ten, conversion and signed GGR without inventing a finance guard', () => {
  useAuthStore.setState({ permissions: [] })
  render(<BidTypeAnalytics breakdown={{ byBidType: Array.from({ length: 12 }, (_, i) => ({ bidType: `bid-${i}`, wagered: i * 10, payouts: i, ggr: -i, bets: i + 1 })) }} />)
  const rows = screen.getAllByRole('listitem'); assert.equal(rows.length, 10)
  within(rows[0]).getByText('bid-11'); within(rows[0]).getByText('INR 220.00'); within(rows[0]).getByText('INR -22.00')
  assert.equal(screen.queryByText('bid-0'), null)
})
const termValues = (term: string) => screen.getAllByText(term, { selector: 'dt' }).map(dt => dt.nextElementSibling?.textContent)
test('Matka exposure is potential payouts above stake (MAT-13), never negative, and money stays masked', () => {
  // m1's open bets pay less than they staked; m2's pay 450 on 50 staked. Settled payouts must not count:
  // the old wagered - payouts rule gave m2 an exposure of 40 (INR 80.00).
  const rows = [
    { matkaId: 'm1', matkaName: 'Kalyan', wagered: 100, payouts: 150, ggr: -50, potentialPayouts: 90, bets: 2 },
    { matkaId: 'm2', matkaName: 'Main', wagered: 50, payouts: 10, ggr: 40, potentialPayouts: 450, bets: 1 },
    { matkaId: 'm3', matkaName: 'Old snapshot', wagered: 20, payouts: 0, ggr: 20, potentialPayouts: null, bets: 1 },
  ]
  const page = render(<MatkaAnalytics breakdown={{ byMatka: rows }} />)
  within(screen.getByText('Total Wagered').parentElement!).getByText('INR 340.00')
  within(screen.getByText('Total Exposure').parentElement!).getByText('INR 800.00')
  assert.deepEqual(termValues('Exposure'), ['INR 0.00', 'INR 800.00', 'INR 0.00'])
  assert.deepEqual(termValues('Potential Payouts'), ['INR 180.00', 'INR 900.00', 'INR 0.00'])
  assert.equal(screen.queryByText('INR 80.00'), null)
  page.unmount(); useAuthStore.setState({ permissions: [] }); render(<MatkaAnalytics breakdown={{ byMatka: rows }} />)
  assert.ok(screen.getAllByText('••••').length >= 14); assert.equal(screen.queryByText('INR 340.00'), null)
})
test('Market session exposure and potential payouts come from potentialPayouts, not settled payouts (MAT-13)', () => {
  render(<MarketSessionAnalytics breakdown={{ bySession: [
    { marketSession: 'open', wagered: 100, payouts: 0, ggr: 100, potentialPayouts: 900, bets: 3 },
    { marketSession: 'close', wagered: 40, payouts: 0, ggr: 40, potentialPayouts: null, bets: 1 },
  ] }} />)
  assert.deepEqual(termValues('Potential Payouts'), ['INR 1800.00', 'INR 0.00'])
  assert.deepEqual(termValues('Exposure'), ['INR 1600.00', 'INR 0.00'])
})
test('digit frequency orders by bets and retains frequency and exposure math', () => {
  render(<DigitFrequencyAnalysis breakdown={{ byDigit: [{ digit: '1', bets: 2, wagered: 30, payouts: 10, exposure: 20 }, { digit: '2', bets: 6, wagered: 90, payouts: 40, exposure: 50 }] }} />)
  const rows = screen.getAllByRole('listitem'); within(rows[0]).getByText('Digit #2'); within(rows[0]).getByText('75.0%'); within(rows[0]).getByText('INR 100.00')
  assert.equal(screen.getByRole('meter', { name: 'Relative frequency of digit 1' }).getAttribute('aria-valuenow'), '33')
})
// E004: byDigit was always empty, so these cards only ever said "No digit data available". The server now sends one row
// per digit of the open Single Digit, A and B bets, exposure being the payout above the stake (never negative).
test('Digit Analytics ranks the digits the server sends: hot and cold by bets, risky by exposure, money masked', () => {
  const byDigit = [
    { digit: '3', wagered: 10, payouts: 0, exposure: 0, bets: 1 },
    { digit: '4', wagered: 30, payouts: 0, exposure: 240, bets: 2 },
    { digit: '5', wagered: 150, payouts: 0, exposure: 1200, bets: 4 },
    { digit: '7', wagered: 30, payouts: 0, exposure: 245, bets: 3 },
  ]
  const page = render(<DigitAnalytics breakdown={{ byDigit }} />)
  assert.equal(screen.queryByText('No digit data available'), null)
  const digits = (card: string) => within(screen.getByRole('region', { name: card })).getAllByRole('listitem').map(item => item.querySelector('strong, h3')?.textContent)
  assert.deepEqual(digits('Hot Digits'), ['#5', '#7', '#4', '#3'])
  assert.deepEqual(digits('Cold Digits'), ['#3', '#4', '#7', '#5'])
  assert.deepEqual(digits('Risky Digits (High Exposure)'), ['Digit #5', 'Digit #7', 'Digit #4', 'Digit #3'])
  assert.deepEqual(termValues('Exposure'), ['INR 2400.00', 'INR 490.00', 'INR 480.00', 'INR 0.00'])
  page.unmount(); useAuthStore.setState({ permissions: [] }); render(<DigitAnalytics breakdown={{ byDigit }} />)
  assert.deepEqual(termValues('Exposure'), ['••••', '••••', '••••', '••••'])
})
test('Digit Analytics says plainly when no open bet is on a single digit', () => {
  render(<DigitAnalytics breakdown={{ byDigit: [] }} />)
  screen.getByText('No digit data available')
})
test('digit heatmap aggregates duplicate digits, keeps ten cells and excludes out of range identifiers', () => {
  render(<DigitHeatmap breakdown={{ byDigit: [{ digit: '2', bets: 2, wagered: 20, payouts: 0, exposure: 5 }, { digit: '2', bets: 3, wagered: 30, payouts: 0, exposure: 10 }, { digit: '12', bets: 100, wagered: 100, payouts: 0, exposure: 100 }] }} />)
  screen.getByLabelText('Digit 2: 5 bets, exposure INR 30.00'); screen.getByText(/1\/10 digits active/)
  assert.equal(document.querySelectorAll('[aria-label^="Digit "]').length, 10)
})
