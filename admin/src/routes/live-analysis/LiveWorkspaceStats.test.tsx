import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LiveWorkspaceStats } from './LiveWorkspaceStats'

// A Stat delta reads "Up 12.5%" across the arrow's hidden direction word and the visible figure, so the
// innermost element with that whole text is the delta chip.
const deltaText = (text: string) => (_: string, element: Element | null) =>
  !!element && element.textContent === text && ![...element.children].some((child) => child.textContent === text)

const currency = vi.hoisted(() => ({
  formatAmount: vi.fn((value: number) => `INR ${value}`),
  convertFromWhitelabelCurrency: vi.fn((value: number) => value * 2),
}))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => currency }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const dashboard = { kpis: { wagered: 999999999, payouts: 100, activePlayers: 42, betsPerMin: 3.5 },
  breakdown: { byType: [{ bets: 17 }] } }

function Stats({ canViewFinance }: { canViewFinance: boolean }) {
  return <LiveWorkspaceStats feature="matka" dashboard={dashboard} canViewFinance={canViewFinance}
    trends={{ wageredTrend: 12.5 }} />
}

describe('live statistics access and expansion', () => {
  test('finance-restricted matka users get masked monetary values while operational counts stay visible', () => {
    render(<Stats canViewFinance={false} />)
    assert.equal(screen.getAllByText('••••').length, 3)
    assert.ok(screen.getByText('42'))
    assert.ok(screen.getByText('17'))
    assert.equal(currency.formatAmount.mock.calls.length, 0)
    assert.equal(currency.convertFromWhitelabelCurrency.mock.calls.length, 0)
  })

  test('authorized statistics convert currency and every tile carries its kit supporting line', () => {
    const { container } = render(<Stats canViewFinance />)
    assert.ok(screen.getByText('INR 1999999998'))
    // the trend shows on the tile itself (no Expand stats step); tiles without one say what they cover
    assert.ok(screen.getByText(deltaText('Up 12.5%')))
    assert.equal(screen.queryByRole('button', { name: 'Expand stats' }), null)
    assert.equal(screen.getAllByText('Open bets').length, 5)
    const grid = container.querySelector('[data-count]')!
    assert.equal(grid.getAttribute('data-count'), '6')
    assert.equal((grid as HTMLElement).style.getPropertyValue('--mid-tracks'), '3')
    assert.equal(grid.querySelectorAll('svg').length >= 6, true, 'each tile has its glyph')
  })

  test('two-row tracks let a short second row widen instead of leaving a hole', () => {
    const { container } = render(<LiveWorkspaceStats feature="casino" dashboard={{ kpis: { wagered: 10, ggr: 1, rtp: 90 } }}
      trends={null} windowMins={15} />)
    const grid = container.querySelector('[data-count]') as HTMLElement
    assert.equal(grid.getAttribute('data-count'), '7')
    assert.equal(grid.style.getPropertyValue('--mid-tracks'), '12') // 4 + 3 tiles on twelve tracks
    const spans = [...grid.children].map(tile => (tile as HTMLElement).style.getPropertyValue('--mid-span'))
    assert.deepEqual(spans, ['3', '3', '3', '3', '4', '4', '4'])
    assert.ok(screen.getAllByText('Last 15m').length > 0)
  })

  test('before the first snapshot the row holds every tile of the feature as a placeholder', () => {
    const { container } = render(<LiveWorkspaceStats feature="casino" dashboard={undefined} loading
      trends={null} />)
    const grid = container.querySelector('[aria-busy="true"]')
    assert.ok(grid)
    assert.equal(grid.querySelectorAll(':scope > [aria-busy="true"]').length, 7)
    assert.ok(screen.getByText('Wagered'))
    assert.ok(screen.getByText('House Edge'))
    // no zero figure stands in for the missing snapshot
    assert.equal(screen.queryByText('INR 0'), null)
  })
})
