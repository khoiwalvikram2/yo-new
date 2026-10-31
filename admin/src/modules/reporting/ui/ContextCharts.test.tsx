import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, within } from '@testing-library/react'
import { ContextCharts } from './ContextCharts'

vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }))
vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDate: (value: string, pattern: string) => `${pattern}:${value}` }),
}))

const formatAmount = (value: number) => `₹${value}`

const TRENDS = [
  { date: '2026-09-20', stakes: 100, payouts: 60, ggr: 40 },
  { date: '2026-09-21', stakes: 120, payouts: 70, ggr: 50 },
  { date: '2026-09-22', stakes: 90, payouts: 80, ggr: 10 },
]

const BREAKDOWN = [
  { name: 'Cricket', totalStakes: 500, grossGamingRevenue: 50 },
  { name: 'Football', totalStakes: 300, grossGamingRevenue: 20 },
]

function headings(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent ?? '')
}

describe('ContextCharts', () => {
  test('loading shows one status and no cards', () => {
    render(<ContextCharts level="all" domain="sports" data={{ trends: TRENDS }} loading formatAmount={formatAmount} />)
    assert.equal(screen.getByRole('status').textContent, 'Loading charts')
    assert.equal(screen.queryAllByRole('region').length, 0)
  })

  test('trends and a breakdown give the trend, bar and share cards', () => {
    render(
      <ContextCharts level="sport" domain="sports" data={{ trends: TRENDS, breakdown: BREAKDOWN }} loading={false} formatAmount={formatAmount} />,
    )
    assert.deepEqual(headings(), ['Performance Trends', 'Top Performers (Stakes)', 'Distribution (GGR)'])
    assert.ok(within(screen.getByRole('region', { name: 'Performance Trends' })).getByText('3 data points'))
    assert.ok(within(screen.getByRole('region', { name: 'Top Performers (Stakes)' })).getByText('Top 2 entries'))
    assert.ok(within(screen.getByRole('region', { name: 'Distribution (GGR)' })).getByText('Proportional breakdown'))
    assert.equal(document.querySelectorAll('.recharts-responsive-container').length, 3)
  })

  test('the bonus domain uses its own titles, and a breakdown alone draws no trend card', () => {
    render(
      <ContextCharts
        level="all"
        domain="bonuses"
        data={{ breakdown: [{ campaignName: 'Diwali', totalIssued: 10, totalRedeemed: 4 }] }}
        loading={false}
        formatAmount={formatAmount}
      />,
    )
    assert.deepEqual(headings(), ['Top Campaigns (Issued)', 'Distribution (Redeemed)'])
    assert.ok(screen.getByText('Top 1 entries'))
  })

  test('nothing to draw gives one "Charts" card that says so', () => {
    render(<ContextCharts level="all" domain="casino" data={{ trends: [], breakdown: [] }} loading={false} formatAmount={formatAmount} />)
    assert.deepEqual(headings(), ['Charts'])
    assert.ok(screen.getByText('No chart data available'))
  })

  test('cards can title themselves one level down', () => {
    render(
      <ContextCharts level="all" domain="matka" data={{ trends: TRENDS }} loading={false} formatAmount={formatAmount} headingLevel={3} />,
    )
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Performance Trends' }))
    assert.equal(screen.queryAllByRole('heading', { level: 2 }).length, 0)
  })
})
