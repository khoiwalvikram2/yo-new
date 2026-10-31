/**
 * The panel is the kit's; what this file owns is the wiring to the dashboard store, and the one thing
 * that must not drift: a custom range still reaches the store as the same instants the antd picker
 * sent, or every query on the page would move by hours.
 */
import { test, describe, afterEach, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PeriodPanel } from './PeriodPanel'
import { useDashboardStore } from '@/state/dashboardStore'

beforeEach(() => {
  useDashboardStore.getState().resetFilters()
})

afterEach(cleanup)

const range = () => useDashboardStore.getState().filters.dateRange

describe('PeriodPanel', () => {
  test('shows every preset the store supports, with the applied one pressed', () => {
    render(<PeriodPanel />)
    for (const label of ['Today', 'Yesterday', '7D', '30D', 'This Month', 'Last Month', 'Custom']) {
      assert.ok(screen.getByRole('button', { name: label }), `missing preset ${label}`)
    }
    assert.equal(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed'), 'true')
  })

  test('applying a preset writes it to the store and closes the host', () => {
    let closed = 0
    render(<PeriodPanel onDone={() => { closed += 1 }} />)
    fireEvent.click(screen.getByRole('button', { name: '7D' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    assert.equal(range().preset, 'last7days')
    assert.equal(closed, 1)
  })

  test('a custom range reaches the store as whole IST days', () => {
    render(<PeriodPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-10' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    assert.equal(range().preset, 'custom')
    assert.equal(range().dateFrom, '2026-09-09T18:30:00.000Z')
    assert.equal(range().dateTo, '2026-09-20T18:29:59.999Z')
  })

  test('Custom opens on the range in force', () => {
    useDashboardStore.getState().setDateRange({
      preset: 'custom',
      dateFrom: '2026-09-09T18:30:00.000Z',
      dateTo: '2026-09-20T18:29:59.999Z',
    })
    render(<PeriodPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    assert.equal((screen.getByLabelText('Start date') as HTMLInputElement).value, '2026-09-10')
    assert.equal((screen.getByLabelText('End date') as HTMLInputElement).value, '2026-09-20')
  })

  test('Reset puts the store back to its default period', () => {
    useDashboardStore.getState().setDateRangePreset('last30days')
    render(<PeriodPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.equal(range().preset, 'today')
  })
})
