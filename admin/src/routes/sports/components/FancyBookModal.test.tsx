import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FancyBookModal } from './FancyBookModal'
import { calculateFancyBook } from '../utils/fancyBookCalculator'
import { fancyBookCsv } from './eventDetailModel'

vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value * 2 }) }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const market = { id: 'fancy-1', runners: [{ id: 'selection-1', name: 'Total runs' }] }
const bets = [
  { id: 'back', marketId: 'fancy-1', selectionId: 'selection-1', side: 'back', price: 10, oddsSize: 100, stake: 100, liability: 100, status: 'matched' },
  { id: 'lay', marketId: 'fancy-1', selectionId: 'selection-1', side: 'lay', price: 12, oddsSize: 100, stake: 50, liability: 50, status: 'matched' },
  { id: 'other-line', marketId: 'fancy-1', selectionId: 'other', side: 'back', price: 10, stake: 9999, status: 'matched' },
  { id: 'unmatched', marketId: 'fancy-1', selectionId: 'selection-1', side: 'back', price: 10, stake: 9999, status: 'unmatched' },
]
describe('fancy book analysis dialog', () => {
  test('retains selection matching, matched-only statistics and display-only conversion, switching summary/full range', () => {
    const { rerender } = render(<FancyBookModal open market={market} bets={bets} fancySelection="Total runs" onClose={() => {}} />)
    assert.ok(screen.getByRole('dialog', { name: 'Fancy Book Analysis' }))
    assert.ok(screen.getByText('Showing 10 of 13 positions'))
    const table = screen.getByRole('table', { name: 'Fancy book positions' })
    assert.equal(within(table).getAllByRole('row').length, 11)
    assert.ok(screen.getByText('₹200.00')) // total back stake100, converted at2
    assert.ok(screen.getByText('₹100.00')) // total lay stake50, converted at2
    assert.ok(within(table).getAllByText('+₹300.00').length > 0)
    fireEvent.click(screen.getByRole('switch', { name: 'Full Range' }))
    assert.ok(screen.getByText('Showing 13 of 13 positions'))
    assert.equal(within(table).getAllByRole('row').length, 14)
    rerender(<FancyBookModal open={false} market={market} bets={bets} fancySelection="Total runs" onClose={() => {}} />)
    rerender(<FancyBookModal open market={market} bets={bets} fancySelection="Total runs" onClose={() => {}} />)
    assert.equal(screen.getByRole('switch', { name: 'Full Range' }).getAttribute('aria-checked'), 'false')
  })
  test('exports the complete raw book rather than filtered summary or converted P/L', async () => {
    let captured: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob as Blob; return 'blob:book' })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let filename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
    render(<FancyBookModal open market={market} bets={bets} fancySelection="Total runs" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    assert.ok(captured)
    const expected = fancyBookCsv(calculateFancyBook(bets, 'fancy-1', 'selection-1', 'Total runs').entries)
    const actual = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(captured!)
    })
    assert.equal(actual, expected)
    assert.ok(expected.includes('10,150.00'))
    assert.equal(expected.split('\n').length, 14)
    assert.match(filename, /^fancy-book-fancy-1-.*\.csv$/)
    assert.equal(revoke.mock.calls[0][0], 'blob:book')
  })
  test('keeps the empty market state explicit and name-based fallback selection matching', () => {
    const { rerender } = render(<FancyBookModal open market={market} bets={bets} fancySelection="Missing line" onClose={() => {}} />)
    assert.ok(screen.getByText('No bets found for this fancy market'))
    assert.equal(Boolean(screen.queryByRole('button', { name: 'Export CSV' })), false)
    rerender(<FancyBookModal open market={{ id: 'fancy-1' }} bets={[{ ...bets[0], selectionName: 'Named line' }]} fancySelection="Named line" onClose={() => {}} />)
    assert.ok(screen.getByRole('table', { name: 'Fancy book positions' }))
  })
})
