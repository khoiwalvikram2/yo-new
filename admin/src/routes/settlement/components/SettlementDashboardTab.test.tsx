import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettlementDashboardTab } from './SettlementDashboardTab'

// The real charts (SettlementSections.test.tsx stubs them), at a fixed size: jsdom measures every box as 0 x 0, so a
// ResponsiveContainer would draw nothing.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  const ResponsiveContainer = ({ children }: { children?: ReactNode }) =>
    isValidElement(children) ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, { width: 640, height: 256 }) : null
  return { ...actual, ResponsiveContainer }
})
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (amount: number) => `₹${amount.toFixed(2)}`, convertFromWhitelabelCurrency: (amount: number) => amount }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDateTime: (date: string) => date }) }))
afterEach(cleanup)

test("the trend chart's legend draws as written, with none of the legend's props on its list (AGE-12)", () => {
  // Given as an element, recharts cloned it with iconSize, payload, layout...: React warned of unknown props on the
  // <ul> on every load of /settlement.
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    render(<MemoryRouter><SettlementDashboardTab isAgent={false} dashboard={{ pendingSharingSettlements: 100, monthlyTrend: [
      { month: 'September', totalSettled: 50, commissionPaid: 10 },
      { month: 'October', totalSettled: 80, commissionPaid: 20 },
    ] }} /></MemoryRouter>)
    assert.ok(screen.getByText('Settled & Commission over time'))
    const legend = screen.getByText('Commission', { selector: 'li' }).closest('ul')
    assert.ok(legend, 'the legend is drawn')
    assert.equal(legend.getAttributeNames().some(name => /icon|payload|layout|align/i.test(name)), false)
    const unknownProps = errors.mock.calls.map(args => args.map(String).join(' ')).filter(text => /does not recognize the .* prop on a DOM element|unknown prop/i.test(text))
    assert.deepEqual(unknownProps, [])
  } finally {
    errors.mockRestore()
  }
})
