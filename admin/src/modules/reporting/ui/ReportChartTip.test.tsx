import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { ReportChartTip } from './ReportChartTip'

describe('ReportChartTip', () => {
  test('renders nothing while recharts says the tip is inactive or empty', () => {
    const slotOf = vi.fn(() => 's1' as const)
    const { container, rerender } = render(<ReportChartTip active={false} payload={[{ name: 'A', value: 1 }]} slotOf={slotOf} format={String} />)
    assert.equal(container.innerHTML, '')
    rerender(<ReportChartTip active payload={[]} slotOf={slotOf} format={String} />)
    assert.equal(container.innerHTML, '')
    assert.equal(slotOf.mock.calls.length, 0)
  })

  test('one row per series: decorative swatch, name and formatted value under the hovered label', () => {
    const slotOf = vi.fn((_entry: unknown, index: number) => (index === 0 ? 's1' : 's2') as 's1' | 's2')
    const { container } = render(
      <ReportChartTip
        active
        label="2026-09-22"
        payload={[
          { name: 'Stakes', value: 1200, dataKey: 'stakes' },
          { name: 'GGR', value: ['45', 0], dataKey: 'ggr' },
        ]}
        slotOf={slotOf}
        format={(value, entry) => `${String(entry.dataKey)}=${value.toFixed(1)}`}
      />,
    )
    const tip = container.firstElementChild as HTMLElement
    assert.equal(tip.querySelector('p')?.textContent, '2026-09-22')
    const rows = Array.from(tip.querySelectorAll('div'))
    assert.deepEqual(
      rows.map((row) => Array.from(row.children).map((cell) => cell.textContent)),
      [
        ['', 'Stakes', 'stakes=1200.0'],
        ['', 'GGR', 'ggr=45.0'],
      ],
    )
    for (const row of rows) assert.equal(row.querySelector('i')?.getAttribute('aria-hidden'), 'true')
    assert.deepEqual(slotOf.mock.calls.map((call) => call[1]), [0, 1])
  })

  test('a missing label leaves no heading line', () => {
    const { container } = render(
      <ReportChartTip active payload={[{ name: 'Cricket', value: 5 }]} slotOf={() => 'hInd'} format={(v) => `₹${v}`} />,
    )
    assert.equal(container.querySelector('p'), null)
    assert.equal(container.textContent, 'Cricket₹5')
  })
})
