import assert from 'node:assert/strict'
import { cloneElement, isValidElement, type ReactNode } from 'react'
import { afterEach, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TimeSeriesChart } from './TimeSeriesChart'
import { BarChartComponent } from './BarChartComponent'
import { DistributionChart } from './DistributionChart'

// jsdom has no layout, so the responsive wrapper is given a fixed size for the chart to draw its legend.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactNode }) => (isValidElement(children) ? cloneElement(children as never, { width: 600, height: 300 }) : null) }
})
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatTime: () => '12:00' }) }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('the chart legends render their own list without recharts props reaching the DOM', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const series = [{ key: 'stake', name: 'Total Stake', color: 'blue' }, { key: 'liability', name: 'Total Liability', color: 'red' }]
  render(<TimeSeriesChart data={[{ time: '2026-11-03T10:00:00Z', stake: 1, liability: 2 }]} dataKeys={series} />)
  render(<BarChartComponent data={[{ name: 'Cricket', stake: 1, liability: 2 }]} dataKeys={series} xAxisKey="name" />)
  render(<DistributionChart data={[{ name: 'Back', value: 3 }, { name: 'Lay', value: 1 }]} />)
  assert.equal(screen.getAllByText('Total Stake').length >= 2, true, 'both series legends are drawn')
  assert.ok(screen.getByText('Back'))
  const unknownProps = errors.mock.calls.map((call) => call.map(String).join(' ')).filter((text) => /does not recognize|Unknown prop|React does not recognize/i.test(text))
  assert.deepEqual(unknownProps, [])
})
