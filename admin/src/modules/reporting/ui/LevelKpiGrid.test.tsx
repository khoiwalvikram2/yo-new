import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, within } from '@testing-library/react'
import { LevelKpiGrid } from './LevelKpiGrid'

vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }))

const formatAmount = (value: number) => `₹${value.toFixed(2)}`
const convertCurrency = (value: number) => value * 2

function labels(): string[] {
  const group = screen.getByRole('group', { name: 'Key figures' })
  return Array.from(group.children).map((stat) => within(stat as HTMLElement).getAllByText(/./)[0].textContent ?? '')
}

describe('LevelKpiGrid', () => {
  test('renders nothing without data, as before', () => {
    const { container } = render(
      <LevelKpiGrid level="all" domain="sports" data={null} formatAmount={formatAmount} convertCurrency={convertCurrency} />,
    )
    assert.equal(container.innerHTML, '')
  })

  test('a sports level shows its six figures, converted and formatted', () => {
    render(
      <LevelKpiGrid
        level="league"
        domain="sports"
        data={{ totalStakes: 100, totalPayouts: 40, grossGamingRevenue: 60, holdPercentage: 0.6, betCount: 1200, activePlayerCount: 9 }}
        formatAmount={formatAmount}
        convertCurrency={convertCurrency}
      />,
    )
    assert.deepEqual(labels(), [
      'Total Stakes',
      'Total Payouts',
      'Gross Gaming Revenue',
      'Hold Percentage',
      'Total Bets',
      'Active Players',
    ])
    assert.ok(screen.getByText('₹200.00'))
    assert.ok(screen.getByText('₹80.00'))
    assert.ok(screen.getByText('60.00%'))
    assert.ok(screen.getByText((1200).toLocaleString()))
  })

  test('a bonus player shows the bonus figures', () => {
    render(
      <LevelKpiGrid
        level="player"
        domain="bonuses"
        data={{ totalIssued: 5, redemptionRate: 0.25, awardCount: 3 }}
        formatAmount={formatAmount}
        convertCurrency={convertCurrency}
      />,
    )
    assert.deepEqual(labels(), ['Total Issued', 'Total Redeemed', 'Total Expired', 'Avg Amount', 'Redemption Rate', 'Awards'])
    assert.ok(screen.getByText('₹10.00'))
    assert.ok(screen.getByText('25.00%'))
  })

  test('a level with no figures renders an empty group', () => {
    render(<LevelKpiGrid level="market" domain="matka" data={{}} formatAmount={formatAmount} convertCurrency={convertCurrency} />)
    assert.equal(screen.getByRole('group', { name: 'Key figures' }).children.length, 0)
  })
})
