import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, within } from '@testing-library/react'
import { TrendCard, TrendLegend } from './TrendCard'
import { contextChartCopy, seriesLegend } from './drillDownModel'
import s from './reportCharts.module.css'

vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }))
vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDate: (value: string, pattern: string) => `${pattern}:${value}` }),
}))

const LINES = [
  { key: 'stakes', name: 'Stakes', color: '#1890ff' },
  { key: 'payouts', name: 'Payouts', color: '#ff4d4f' },
  { key: 'ggr', name: 'GGR', color: '#52c41a' },
]

const DATA = [
  { date: '2026-09-20', stakes: 100, payouts: 60, ggr: 40 },
  { date: '2026-09-21', stakes: 120, payouts: 70, ggr: 50 },
]

describe('TrendCard', () => {
  test('a titled card with its data-point count and one plot (jsdom draws no lines)', () => {
    render(<TrendCard title="Performance Trends" data={DATA} lines={LINES} />)
    const card = screen.getByRole('region', { name: 'Performance Trends' })
    assert.ok(within(card).getByRole('heading', { level: 2, name: 'Performance Trends' }))
    assert.ok(within(card).getByText('2 data points'))
    assert.equal(card.querySelectorAll('.recharts-responsive-container').length, 1)
    assert.equal(card.getAttribute('aria-busy'), null)
  })

  test('no data says so, with no plot', () => {
    render(<TrendCard title="Performance Trends" data={[]} lines={LINES} />)
    const card = screen.getByRole('region', { name: 'Performance Trends' })
    assert.ok(within(card).getByText('No data available'))
    assert.equal(card.querySelector('.recharts-responsive-container'), null)
    assert.equal(within(card).queryByText(/data points/), null)
  })

  test('loading before the first data announces itself instead of claiming there is none', () => {
    render(<TrendCard title="Performance Trends" data={[]} lines={LINES} loading />)
    const card = screen.getByRole('region', { name: 'Performance Trends' })
    assert.equal(within(card).getByRole('status').textContent, 'Loading trend data')
    assert.equal(within(card).queryByText('No data available'), null)
    assert.equal(card.getAttribute('aria-busy'), 'true')
  })

  test('a refetch keeps the plot and marks the card busy with a named spinner', () => {
    render(<TrendCard title="Performance Trends" data={DATA} lines={LINES} loading />)
    const card = screen.getByRole('region', { name: 'Performance Trends' })
    assert.ok(within(card).getByRole('img', { name: 'Refreshing trend data' }))
    assert.equal(card.querySelectorAll('.recharts-responsive-container').length, 1)
    assert.equal(card.getAttribute('aria-busy'), 'true')
  })

  test('the card can title itself one level down inside another section', () => {
    render(<TrendCard title="Trends" data={DATA} lines={LINES} headingLevel={3} />)
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Trends' }))
    assert.equal(screen.queryByRole('heading', { level: 2 }), null)
  })
})

describe('TrendLegend', () => {
  function entries(): { name: string; key: Element | null }[] {
    return screen.getAllByRole('listitem').map((item) => ({
      name: item.textContent ?? '',
      key: item.querySelector('i'),
    }))
  }

  test('lists the series in their own order, each swatch on its line slot, swatches hidden', () => {
    // recharts' default legend sorts by name (GGR, Payouts, Stakes) and its swatch classes follow that
    render(<TrendLegend items={seriesLegend(LINES)} />)
    const list = entries()
    assert.deepEqual(list.map((entry) => entry.name), ['Stakes', 'Payouts', 'GGR'])
    assert.ok(list[0].key?.classList.contains(s.keyS1))
    assert.ok(list[1].key?.classList.contains(s.keyS2))
    assert.ok(list[2].key?.classList.contains(s.keyS3))
    assert.ok(list.every((entry) => entry.key?.getAttribute('aria-hidden') === 'true'))
  })

  test('the bonus trend legend keeps redeemed green and expired red', () => {
    render(<TrendLegend items={seriesLegend(contextChartCopy('bonuses').lines)} />)
    const list = entries()
    assert.deepEqual(list.map((entry) => entry.name), ['Issued', 'Redeemed', 'Expired', 'Revenue'])
    assert.ok(list[0].key?.classList.contains(s.keyHInd))
    assert.ok(list[1].key?.classList.contains(s.keyHGrn))
    assert.ok(list[2].key?.classList.contains(s.keyHRed))
    assert.ok(list[3].key?.classList.contains(s.keyHAmb))
  })
})
