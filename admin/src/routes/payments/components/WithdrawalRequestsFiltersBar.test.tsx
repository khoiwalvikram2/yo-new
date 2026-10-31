import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WithdrawalRequestsFiltersBar } from './WithdrawalRequestsFiltersBar'
import type { WithdrawalDateRange } from '../withdrawalRequestsModel'

const TODAY: WithdrawalDateRange = { from: '2026-10-03', to: '2026-10-03' }

function renderFilters(overrides: Partial<React.ComponentProps<typeof WithdrawalRequestsFiltersBar>> = {}) {
  const handlers = {
    onChangeStatus: vi.fn(),
    onChangeQuery: vi.fn(),
    onChangeDateRange: vi.fn(),
    onClearAll: vi.fn(),
  }

  const props: React.ComponentProps<typeof WithdrawalRequestsFiltersBar> = {
    status: 'PENDING',
    query: '',
    dateRange: TODAY,
    ...handlers,
    ...overrides,
  }

  return { ...render(<WithdrawalRequestsFiltersBar {...props} />), handlers, props }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-03T06:00:00.000Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WithdrawalRequestsFiltersBar', () => {
  test('keeps the controlled search placeholder, the five statuses plus All and their callbacks', () => {
    const { handlers } = renderFilters()

    const search = screen.getByRole('searchbox', { name: 'Search withdrawal requests' })
    assert.equal(search.getAttribute('placeholder'), 'User name, phone, email...')
    fireEvent.change(search, { target: { value: '98765' } })
    assert.deepEqual(handlers.onChangeQuery.mock.calls, [['98765']])

    const status = screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement
    assert.deepEqual([...status.options].map((option) => [option.value, option.text]), [
      ['', 'All Status'],
      ['PENDING', 'Pending'],
      ['PROCESSING', 'Processing'],
      ['COMPLETED', 'Completed'],
      ['FAILED', 'Failed'],
      ['CANCELLED', 'Cancelled'],
    ])
    assert.equal(status.value, 'PENDING')
    fireEvent.change(status, { target: { value: 'FAILED' } })
    fireEvent.change(status, { target: { value: '' } })
    assert.deepEqual(handlers.onChangeStatus.mock.calls, [['FAILED'], ['']])
    assert.equal(screen.queryByRole('combobox', { name: 'Method' }), null)
  })

  test('counts Pending as the initial filter, treats Today as the default and delegates Clear all once', () => {
    const { handlers, rerender, props } = renderFilters()
    assert.equal(screen.getByRole('status').textContent, '1 filter applied')
    assert.ok(screen.getByRole('button', { name: 'Date range: Today' }))

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal(handlers.onClearAll.mock.calls.length, 1)
    assert.equal(handlers.onChangeStatus.mock.calls.length, 0)
    assert.equal(handlers.onChangeDateRange.mock.calls.length, 0)

    rerender(
      <WithdrawalRequestsFiltersBar
        {...props}
        status="COMPLETED"
        query="asha"
        dateRange={{ from: '2026-09-26', to: '2026-10-03' }}
      />,
    )
    assert.equal(screen.getByRole('status').textContent, '3 filters applied')
    assert.ok(screen.getByRole('button', { name: 'Date range: Last 7 Days' }))
  })

  test.each([
    ['Yesterday', { from: '2026-10-02', to: '2026-10-02' }],
    ['Last 7 Days', { from: '2026-09-26', to: '2026-10-03' }],
    ['Last 30 Days', { from: '2026-09-03', to: '2026-10-03' }],
  ])('applies the staged %s inclusive IST calendar range', (presetLabel, expected) => {
    const { handlers } = renderFilters()
    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    fireEvent.click(screen.getByRole('button', { name: presetLabel }))

    assert.equal(handlers.onChangeDateRange.mock.calls.length, 0, 'the draft must not leak before Apply')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.deepEqual(handlers.onChangeDateRange.mock.calls, [[expected]])
  })

  test('stages a complete custom range, blocks a cleared endpoint and restores Today on Reset', () => {
    const { handlers } = renderFilters()
    const trigger = screen.getByRole('button', { name: 'Date range: Today' })

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }))
    const start = screen.getByLabelText('Start date')
    const end = screen.getByLabelText('End date')
    fireEvent.change(start, { target: { value: '2026-09-08' } })
    fireEvent.change(end, { target: { value: '' } })

    const blockedApply = screen.getByRole('button', { name: 'Apply' })
    assert.equal(blockedApply.getAttribute('aria-disabled'), 'true')
    fireEvent.click(blockedApply)
    assert.equal(handlers.onChangeDateRange.mock.calls.length, 0)

    fireEvent.change(end, { target: { value: '2026-09-12' } })
    assert.equal(blockedApply.getAttribute('aria-disabled'), null)
    fireEvent.click(blockedApply)
    assert.deepEqual(handlers.onChangeDateRange.mock.calls, [[{ from: '2026-09-08', to: '2026-09-12' }]])

    handlers.onChangeDateRange.mockClear()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.deepEqual(handlers.onChangeDateRange.mock.calls, [[TODAY]])
  })

  test('handles missing date endpoints as the Today default and names an applied custom range', () => {
    const { rerender, props } = renderFilters({ status: '', dateRange: { from: '2026-09-01' } })
    assert.ok(screen.getByRole('button', { name: 'Date range: Today' }))
    assert.equal(screen.getByRole('status').textContent, '0 filters applied')

    rerender(
      <WithdrawalRequestsFiltersBar
        {...props}
        status=""
        dateRange={{ from: '2026-09-01', to: '2026-09-12' }}
      />,
    )
    assert.ok(screen.getByRole('button', { name: 'Date range: 2026-09-01 – 2026-09-12' }))
    assert.equal(screen.getByRole('status').textContent, '1 filter applied')
  })
})
