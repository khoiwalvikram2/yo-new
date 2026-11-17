/**
 * The Bet List filter bar on its own: each control's name and placeholder, the domain-dependent status and
 * wallet choices, the immediate search, the filter count with its Today rule, Clear all, the legacy date
 * windows (IST, last 7 days = today and six before), and the agent session without an id (no agent filter).
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import type { ComponentProps } from 'react'
import { BetListFiltersBar } from './BetListFiltersBar'

const TODAY = '2026-10-07'

function renderFilters(overrides: Partial<ComponentProps<typeof BetListFiltersBar>> = {}) {
  const handlers = { onDomainChange: vi.fn(), onFiltersChange: vi.fn(), onClear: vi.fn() }
  const props: ComponentProps<typeof BetListFiltersBar> = {
    domain: 'ALL',
    filters: { dateFrom: TODAY, dateTo: TODAY },
    ...handlers,
    ...overrides,
  }
  const view = render(
    <MockedProvider mocks={[]}>
      <BetListFiltersBar {...props} />
    </MockedProvider>,
  )
  const rerender = (next: Partial<ComponentProps<typeof BetListFiltersBar>>) => view.rerender(
    <MockedProvider mocks={[]}>
      <BetListFiltersBar {...props} {...next} />
    </MockedProvider>,
  )
  return { handlers, rerender }
}

function count() {
  return screen.getByText(/filters? applied/).textContent
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T06:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BetListFiltersBar', () => {
  test('names every control, keeps the legacy placeholders and offers the four domains', () => {
    const { handlers } = renderFilters()

    assert.ok(screen.getByRole('search', { name: 'Filters' }))
    const search = screen.getByRole('searchbox', { name: 'Search bets' })
    assert.equal(search.getAttribute('placeholder'), 'Search')
    const domain = screen.getByRole('combobox', { name: 'Domain' }) as HTMLSelectElement
    assert.deepEqual([...domain.options].map((option) => [option.value, option.text]), [
      ['ALL', 'All'], ['SPORTS', 'Sports'], ['CASINO', 'Casino'], ['MATKA', 'Matka'],
    ])
    fireEvent.change(domain, { target: { value: 'MATKA' } })
    assert.deepEqual(handlers.onDomainChange.mock.calls, [['MATKA']])

    assert.equal(screen.getByRole('combobox', { name: 'Status' }).getAttribute('placeholder'), 'Status')
    assert.equal(screen.getByRole('combobox', { name: 'Wallet' }).getAttribute('placeholder'), 'Wallet')
    assert.equal(screen.getByRole('combobox', { name: 'Agent' }).getAttribute('placeholder'), 'Agent (search)')
    assert.equal(screen.getByRole('combobox', { name: 'Player' }).getAttribute('placeholder'), 'Player (search)')
    assert.ok(screen.getByRole('button', { name: 'Date range: Today' }))
  })

  test('sends the search as typed, and an emptied search as no filter', () => {
    const { handlers } = renderFilters()
    const search = screen.getByRole('searchbox', { name: 'Search bets' })
    fireEvent.change(search, { target: { value: 'BT-44' } })
    assert.deepEqual(handlers.onFiltersChange.mock.calls.at(-1), [{ dateFrom: TODAY, dateTo: TODAY, search: 'BT-44' }])
  })

  test('offers each domain its statuses and shows the wallet filter only for All and Casino', () => {
    const { rerender } = renderFilters({ domain: 'CASINO' })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Status' }), { key: 'ArrowDown' })
    // Open lists the casino rounds still in play (the stuck rounds alert's list).
    assert.deepEqual(
      within(screen.getByRole('listbox', { name: 'Status' })).getAllByRole('option').map((option) => option.textContent),
      ['Open', 'won', 'lost', 'cancelled', 'void'],
    )
    assert.ok(screen.getByRole('combobox', { name: 'Wallet' }))

    rerender({ domain: 'MATKA' })
    assert.equal(screen.queryByRole('combobox', { name: 'Wallet' }), null)
    rerender({ domain: 'SPORTS' })
    assert.equal(screen.queryByRole('combobox', { name: 'Wallet' }), null)
  })

  test('counts each status and set filter, and Clear all hands over once and resets the date to Today', () => {
    const { handlers, rerender } = renderFilters()
    assert.equal(count(), '0 filters applied')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)

    rerender({
      filters: {
        dateFrom: TODAY,
        dateTo: TODAY,
        status: ['won', 'lost'],
        walletType: 'bonus',
        search: 'x',
        playerSearch: 'rk',
        agentUsername: 'ravi',
      },
    })
    assert.equal(count(), '6 filters applied')

    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.equal(count(), '7 filters applied')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal(handlers.onClear.mock.calls.length, 1)
    rerender({ filters: { dateFrom: TODAY, dateTo: TODAY } })
    assert.equal(count(), '0 filters applied')
    assert.ok(screen.getByRole('button', { name: 'Date range: Today' }))
  })

  test.each([
    ['Yesterday', { dateFrom: '2026-10-06', dateTo: '2026-10-06' }],
    ['Last 7 Days', { dateFrom: '2026-10-01', dateTo: '2026-10-07' }],
    ['Last 30 Days', { dateFrom: '2026-09-08', dateTo: '2026-10-07' }],
  ])('applies the staged %s window and nothing before Apply', (label, expected) => {
    const { handlers } = renderFilters()
    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    fireEvent.click(screen.getByRole('button', { name: label }))
    assert.equal(handlers.onFiltersChange.mock.calls.length, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.deepEqual(handlers.onFiltersChange.mock.calls, [[expected]])
  })

  test('applies a complete custom range, and Reset returns to Today', () => {
    const { handlers } = renderFilters()
    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-20' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.deepEqual(handlers.onFiltersChange.mock.calls, [[{ dateFrom: '2026-09-20', dateTo: '2026-09-25' }]])
    assert.equal(count(), '1 filter applied')

    handlers.onFiltersChange.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /^Date range:/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.deepEqual(handlers.onFiltersChange.mock.calls, [[{ dateFrom: TODAY, dateTo: TODAY }]])
    assert.equal(count(), '0 filters applied')
  })

  test('an agent session without an id gets no agent filter and the plain Player placeholder', () => {
    renderFilters({ isAgent: true })
    assert.equal(screen.queryByRole('combobox', { name: 'Agent' }), null)
    assert.equal(screen.getByRole('combobox', { name: 'Player' }).getAttribute('placeholder'), 'Player')
  })
})
