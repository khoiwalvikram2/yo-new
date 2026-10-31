import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, within } from '@testing-library/react'
import { ReportKpiGrid } from './ReportKpiGrid'

vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }))

/** The figure a Stat shows under its label: label, value and the optional delta line, in DOM order. */
function readStat(group: HTMLElement, label: string): string[] {
  const labelNode = within(group).getByText(label)
  const stack = labelNode.parentElement
  assert.ok(stack, `${label} sits in a stat stack`)
  return Array.from(stack.children).map((node) => node.textContent ?? '')
}

describe('ReportKpiGrid', () => {
  test('renders one named figure per KPI with the legacy formatting rules', () => {
    render(
      <ReportKpiGrid
        kpis={[
          { title: 'Total Stakes', value: 1234.5, formatter: (v) => `₹${v.toFixed(2)}` },
          { title: 'Hold Percentage', value: 12.345, suffix: '%', precision: 2 },
          { title: 'Total Bets', value: 1500, precision: 0 },
          { title: 'Status', value: 'Live' },
          { title: 'Plain', value: 7 },
        ]}
      />,
    )
    const group = screen.getByRole('group', { name: 'Key figures' })
    assert.deepEqual(readStat(group, 'Total Stakes'), ['Total Stakes', '₹1234.50'])
    assert.deepEqual(readStat(group, 'Hold Percentage'), ['Hold Percentage', '12.35%'])
    assert.deepEqual(readStat(group, 'Total Bets'), ['Total Bets', '1,500'])
    assert.deepEqual(readStat(group, 'Status'), ['Status', 'Live'])
    assert.deepEqual(readStat(group, 'Plain'), ['Plain', '7.00'])
  })

  test('a trend states its direction in words; otherwise the secondary row shows', () => {
    render(
      <ReportKpiGrid
        kpis={[
          { title: 'GGR', value: 10, trend: { value: 4.256, isPositive: true }, secondaryLabel: 'Ignored', secondaryValue: 1 },
          { title: 'Payouts', value: 10, trend: { value: -3, isPositive: false } },
          { title: 'Players', value: 3, secondaryLabel: 'Active', secondaryValue: 2 },
        ]}
      />,
    )
    const group = screen.getByRole('group', { name: 'Key figures' })
    assert.deepEqual(readStat(group, 'GGR'), ['GGR', '10.00', 'Up 4.26%vs previous'])
    assert.deepEqual(readStat(group, 'Payouts'), ['Payouts', '10.00', 'Down 3.00%vs previous'])
    assert.deepEqual(readStat(group, 'Players'), ['Players', '3.00', 'Active: 2'])
  })

  test('every tile glyph is decorative', () => {
    const { container } = render(<ReportKpiGrid kpis={[{ title: 'A', value: 1 }, { title: 'B', value: 2 }]} />)
    const glyphs = container.querySelectorAll('svg')
    assert.equal(glyphs.length, 2)
    for (const glyph of glyphs) assert.ok(glyph.closest('[aria-hidden="true"]'), 'the glyph sits in a hidden tile')
  })

  test('while loading each card keeps its label and holds a placeholder instead of its figure', () => {
    const view = render(<ReportKpiGrid kpis={[{ title: 'A', value: 1 }, { title: 'B', value: 2 }]} loading />)
    const group = screen.getByRole('group', { name: 'Key figures' })
    assert.equal(group.getAttribute('aria-busy'), 'true')
    assert.equal(group.children.length, 2)
    assert.deepEqual(readStat(group, 'A'), ['A', 'Loading'])
    assert.equal(within(group).queryByText('1.00'), null)

    view.rerender(<ReportKpiGrid kpis={[{ title: 'A', value: 1 }, { title: 'B', value: 2 }]} />)
    assert.equal(group.getAttribute('aria-busy'), null)
    assert.deepEqual(readStat(group, 'A'), ['A', '1.00'])
  })

  test('an empty list renders an empty group', () => {
    render(<ReportKpiGrid kpis={[]} />)
    assert.equal(screen.getByRole('group', { name: 'Key figures' }).children.length, 0)
  })
})
