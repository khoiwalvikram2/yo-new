import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, useState } from 'react'
import { FilterChips, type FilterChip } from './FilterChips'

afterEach(cleanup)

const initialChips: readonly Omit<FilterChip, 'onRemove'>[] = [
  { key: 'status', label: 'Status', value: 'Pending' },
  { key: 'method', label: 'Method', value: 'UPI' },
  { key: 'period', label: 'Period', value: 'Today' },
]

function ControlledChips({ fallbackRef }: { fallbackRef?: React.RefObject<HTMLElement | null> }) {
  const [items, setItems] = useState(initialChips)
  const chips = items.map((item) => ({
    ...item,
    onRemove: () => setItems((current) => current.filter((candidate) => candidate.key !== item.key)),
  }))
  return (
    <FilterChips
      chips={chips}
      fallbackFocusRef={fallbackRef}
      onClearAll={() => setItems([])}
    />
  )
}

describe('FilterChips', () => {
  test('renders a named filter region and one accessible removal button per filter', () => {
    render(<ControlledChips />)
    const group = screen.getByLabelText('Active filters')
    assert.equal(group.querySelectorAll('li').length, 3)
    assert.ok(screen.getByRole('button', { name: 'Remove Status: Pending' }))
    assert.ok(screen.getByRole('button', { name: 'Remove Method: UPI' }))
    assert.ok(screen.getByRole('button', { name: 'Clear all' }))
  })

  test('removing a middle chip restores focus to the next chip', async () => {
    render(<ControlledChips />)
    const method = screen.getByRole('button', { name: 'Remove Method: UPI' })
    method.focus()
    fireEvent.click(method)
    const next = screen.getByRole('button', { name: 'Remove Period: Today' })
    await waitFor(() => assert.ok(document.activeElement === next))
    assert.equal(screen.queryByRole('button', { name: 'Remove Method: UPI' }), null)
  })

  test('removing the final chip in the row restores focus to the previous chip', async () => {
    render(<ControlledChips />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Period: Today' }))
    const previous = screen.getByRole('button', { name: 'Remove Method: UPI' })
    await waitFor(() => assert.ok(document.activeElement === previous))
  })

  test('Delete removes a focused chip and follows the same focus rule', async () => {
    render(<ControlledChips />)
    const first = screen.getByRole('button', { name: 'Remove Status: Pending' })
    first.focus()
    fireEvent.keyDown(first, { key: 'Delete' })
    assert.equal(screen.queryByRole('button', { name: 'Remove Status: Pending' }), null)
    const next = screen.getByRole('button', { name: 'Remove Method: UPI' })
    await waitFor(() => assert.ok(document.activeElement === next))
  })

  test('Backspace removes a chip without navigating or losing predictable focus', async () => {
    render(<ControlledChips />)
    const middle = screen.getByRole('button', { name: 'Remove Method: UPI' })
    middle.focus()
    fireEvent.keyDown(middle, { key: 'Backspace' })
    const next = screen.getByRole('button', { name: 'Remove Period: Today' })
    await waitFor(() => assert.ok(document.activeElement === next))
  })

  test('the last removal transfers focus to the configured fallback', async () => {
    const fallback = createRef<HTMLButtonElement>()
    function Single() {
      const [shown, setShown] = useState(true)
      return (
        <>
          <button ref={fallback}>Filters</button>
          <FilterChips
            chips={shown ? [{ key: 'status', label: 'Status', value: 'Pending', onRemove: () => setShown(false) }] : []}
            fallbackFocusRef={fallback}
          />
        </>
      )
    }
    render(<Single />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Status: Pending' }))
    const fallbackButton = screen.getByRole('button', { name: 'Filters' })
    await waitFor(() => assert.ok(document.activeElement === fallbackButton))
  })

  test('clear all removes every chip and focuses the configured fallback', async () => {
    const fallback = createRef<HTMLButtonElement>()
    render(
      <>
        <button ref={fallback}>Open filters</button>
        <ControlledChips fallbackRef={fallback} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal(screen.queryByLabelText('Active filters'), null)
    const fallbackButton = screen.getByRole('button', { name: 'Open filters' })
    await waitFor(() => assert.ok(document.activeElement === fallbackButton))
  })

  test('supports a custom accessible removal name without hiding the visible value', () => {
    const onRemove = vi.fn()
    render(
      <FilterChips
        chips={[
          {
            key: 'date',
            label: 'Date',
            value: '22/09/2026–24/09/2026',
            removeLabel: 'custom date range',
            onRemove,
          },
        ]}
      />,
    )
    const button = screen.getByRole('button', { name: 'Remove custom date range' })
    assert.match(button.textContent ?? '', /22\/09\/2026–24\/09\/2026/)
    button.click()
    assert.equal(onRemove.mock.calls.length, 1)
  })

  test('renders nothing for no active filters', () => {
    const { container } = render(<FilterChips chips={[]} />)
    assert.equal(container.innerHTML, '')
  })
})
