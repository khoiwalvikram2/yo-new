import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PayoutAccountsFiltersBar } from './PayoutAccountsFiltersBar'

function renderFilters(overrides: Partial<React.ComponentProps<typeof PayoutAccountsFiltersBar>> = {}) {
  const handlers = {
    onChangeStatus: vi.fn(),
    onChangeQuery: vi.fn(),
    onChangeDateRange: vi.fn(),
    onClearAll: vi.fn(),
  }

  const props: React.ComponentProps<typeof PayoutAccountsFiltersBar> = {
    status: '',
    query: '',
    dateRange: {},
    ...handlers,
    ...overrides,
  }

  return { ...render(<PayoutAccountsFiltersBar {...props} />), handlers, props }
}

afterEach(cleanup)

describe('PayoutAccountsFiltersBar', () => {
  test('keeps the search placeholder, All Status plus the three states, and their callbacks', () => {
    const { handlers } = renderFilters()

    assert.ok(screen.getByRole('search', { name: 'Filters' }))
    const search = screen.getByRole('searchbox', { name: 'Search payout accounts' })
    assert.equal(search.getAttribute('placeholder'), 'User name, phone, email...')
    fireEvent.change(search, { target: { value: '98765' } })
    assert.deepEqual(handlers.onChangeQuery.mock.calls, [['98765']])

    const status = screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement
    assert.deepEqual([...status.options].map((option) => [option.value, option.text]), [
      ['', 'All Status'],
      ['PENDING', 'Pending'],
      ['APPROVED', 'Approved'],
      ['REJECTED', 'Rejected'],
    ])
    assert.equal(status.value, '')
    fireEvent.change(status, { target: { value: 'REJECTED' } })
    fireEvent.change(status, { target: { value: '' } })
    assert.deepEqual(handlers.onChangeStatus.mock.calls, [['REJECTED'], ['']])
  })

  test('starts unfiltered on All dates and hides Clear all until a filter applies', () => {
    renderFilters()
    assert.equal(screen.getByRole('status').textContent, '0 filters applied')
    assert.ok(screen.getByRole('button', { name: 'Date range: All dates' }))
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
  })

  test('counts search, status and a date range once each and delegates Clear all once', () => {
    const { handlers } = renderFilters({
      status: 'APPROVED',
      query: 'asha',
      dateRange: { from: '2026-09-01', to: '2026-09-12' },
    })
    assert.equal(screen.getByRole('status').textContent, '3 filters applied')
    assert.ok(screen.getByRole('button', { name: 'Date range: 2026-09-01 – 2026-09-12' }))

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal(handlers.onClearAll.mock.calls.length, 1)
    assert.equal(handlers.onChangeStatus.mock.calls.length, 0)
    assert.equal(handlers.onChangeQuery.mock.calls.length, 0)
    assert.equal(handlers.onChangeDateRange.mock.calls.length, 0)
  })

  test('applies a complete custom range only after Apply and blocks a half range', () => {
    const { handlers } = renderFilters()
    fireEvent.click(screen.getByRole('button', { name: 'Date range: All dates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }))

    const start = screen.getByLabelText('Start date')
    const end = screen.getByLabelText('End date')
    fireEvent.change(start, { target: { value: '2026-09-08' } })
    const apply = screen.getByRole('button', { name: 'Apply' })
    assert.equal(apply.getAttribute('aria-disabled'), 'true')
    fireEvent.click(apply)
    assert.equal(handlers.onChangeDateRange.mock.calls.length, 0, 'the draft must not leak before Apply')

    fireEvent.change(end, { target: { value: '2026-09-12' } })
    assert.equal(apply.getAttribute('aria-disabled'), null)
    fireEvent.click(apply)
    assert.deepEqual(handlers.onChangeDateRange.mock.calls, [[{ from: '2026-09-08', to: '2026-09-12' }]])
  })

  test('All dates and Reset both clear the date filter, as clearing the legacy picker did', () => {
    const { handlers } = renderFilters({ dateRange: { from: '2026-09-01', to: '2026-09-12' } })
    const trigger = screen.getByRole('button', { name: 'Date range: 2026-09-01 – 2026-09-12' })

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'All dates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.deepEqual(handlers.onChangeDateRange.mock.calls, [[null]])

    handlers.onChangeDateRange.mockClear()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.deepEqual(handlers.onChangeDateRange.mock.calls, [[null]])
  })

  test('treats a half range from the caller as the unfiltered state', () => {
    renderFilters({ dateRange: { from: '2026-09-01' } })
    assert.ok(screen.getByRole('button', { name: 'Date range: All dates' }))
    assert.equal(screen.getByRole('status').textContent, '0 filters applied')
  })
})
