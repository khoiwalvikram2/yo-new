import { useState } from 'react'
import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FilterBar } from './FilterBar'

function Search() {
  return <input type="search" aria-label="Search requests" />
}

describe('FilterBar', () => {
  test('is a named search landmark that composes search and controls and announces the count', () => {
    const clear = vi.fn()
    render(
      <FilterBar activeCount={3} onClearAll={clear} search={<Search />} label="Deposit filters">
        <button type="button">Status</button>
        <button type="button">Method</button>
      </FilterBar>,
    )

    const bar = screen.getByRole('search', { name: 'Deposit filters' })
    assert.ok(bar.contains(screen.getByRole('searchbox', { name: 'Search requests' })))
    assert.ok(screen.getByRole('button', { name: 'Status' }))
    assert.equal(screen.getByRole('status').textContent, '3 filters applied')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal(clear.mock.calls.length, 1)
  })

  test('uses correct singular and hides Clear all when there is nothing to clear', () => {
    const { rerender } = render(
      <FilterBar activeCount={1} onClearAll={() => {}} search={<Search />}>
        <button type="button">Status</button>
      </FilterBar>,
    )
    assert.equal(screen.getByRole('status').textContent, '1 filter applied')

    rerender(
      <FilterBar activeCount={0} onClearAll={() => {}} search={<Search />}>
        <button type="button">Status</button>
      </FilterBar>,
    )
    assert.equal(screen.getByRole('status').textContent, '0 filters applied')
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
  })

  test('shows a summary as the last thing in the bar, and only when given one', () => {
    const { rerender } = render(
      <FilterBar
        activeCount={1}
        onClearAll={() => {}}
        search={<Search />}
        summary={<><b>6</b> of <b>18</b> requests</>}
      >
        <button type="button">Status</button>
      </FilterBar>,
    )

    const bar = screen.getByRole('search', { name: 'Filters' })
    const summary = screen.getByText((_, node) => node?.textContent === '6 of 18 requests' && node.tagName === 'DIV')
    assert.ok(bar.contains(summary))
    // after the controls and Clear all; only the visually hidden status follows it
    assert.equal(summary.nextElementSibling, screen.getByRole('status'))
    assert.equal(summary.previousElementSibling, screen.getByRole('button', { name: 'Clear all' }))

    rerender(
      <FilterBar activeCount={1} onClearAll={() => {}} search={<Search />}>
        <button type="button">Status</button>
      </FilterBar>,
    )
    assert.equal(screen.getByRole('status').previousElementSibling, screen.getByRole('button', { name: 'Clear all' }))
  })

  test('measures its container, not the viewport, and moves controls into a Filters popover when narrow', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 760,
      height: 40,
      top: 0,
      right: 760,
      bottom: 40,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    render(
      <FilterBar activeCount={2} onClearAll={() => {}} search={<Search />} summary="6 of 18 requests">
        <button type="button">Status control</button>
      </FilterBar>,
    )

    const trigger = await screen.findByRole('button', { name: /Filters/ })
    assert.equal(screen.queryByRole('button', { name: 'Status control' }), null)
    assert.ok(screen.getByRole('searchbox', { name: 'Search requests' }))
    // the summary is not a filter: it stays in the bar
    assert.ok(screen.getByRole('search').contains(screen.getByText('6 of 18 requests')))

    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    assert.ok(dialog.contains(screen.getByRole('button', { name: 'Status control' })))
    assert.ok(dialog.contains(screen.getByRole('button', { name: 'Clear all' })))
    // the sheet's head says how many filters are on; Done and the close button both put it away
    assert.ok(within(dialog).getByText('2 applied'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Filters' }), null))
    fireEvent.click(trigger)
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Filters' })).getByRole('button', { name: 'Close filters' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Filters' }), null))
    rect.mockRestore()
  })

  test('a bar with only a search stays a search when narrow: no empty Filters popover', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 760,
      height: 40,
      top: 0,
      right: 760,
      bottom: 40,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    render(<FilterBar activeCount={1} onClearAll={() => {}} search={<Search />}>{null}</FilterBar>)

    assert.ok(await screen.findByRole('searchbox', { name: 'Search requests' }))
    assert.equal(screen.queryByRole('button', { name: /Filters/ }), null)
    // Clear all stays in the bar, beside the search
    assert.ok(screen.getByRole('search').contains(screen.getByRole('button', { name: 'Clear all' })))
    rect.mockRestore()
  })

  test('after a focused chip is removed, focus moves to the next remaining control', async () => {
    function Harness() {
      const [chips, setChips] = useState(['Status: Pending', 'Method: UPI'])
      return (
        <FilterBar activeCount={chips.length} onClearAll={() => setChips([])} search={<Search />}>
          {chips.map((chip) => (
            <button key={chip} type="button" onClick={() => setChips((current) => current.filter((item) => item !== chip))}>
              {chip}
            </button>
          ))}
        </FilterBar>
      )
    }

    render(<Harness />)
    const first = screen.getByRole('button', { name: 'Status: Pending' })
    first.focus()
    fireEvent.click(first)

    const next = await screen.findByRole('button', { name: 'Method: UPI' })
    await waitFor(() => assert.equal(document.activeElement, next))
    assert.equal(screen.getByRole('status').textContent, '1 filter applied')
  })

  test('clearing the last controls returns focus to search', async () => {
    function Harness() {
      const [active, setActive] = useState(true)
      return (
        <FilterBar activeCount={active ? 1 : 0} onClearAll={() => setActive(false)} search={<Search />}>
          {active ? <button type="button">Status: Pending</button> : null}
        </FilterBar>
      )
    }

    render(<Harness />)
    const clear = screen.getByRole('button', { name: 'Clear all' })
    clear.focus()
    fireEvent.click(clear)

    await waitFor(() => assert.equal(document.activeElement, screen.getByRole('searchbox', { name: 'Search requests' })))
  })
})
