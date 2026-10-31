import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { SearchField, type SearchFieldProps } from './SearchField'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function ControlledSearch(props: Partial<SearchFieldProps> = {}) {
  const { value: initialValue = '', onChange: observeChange, ...rest } = props
  const [value, setValue] = useState(initialValue)
  return (
    <SearchField
      label="Search payments"
      value={value}
      onChange={(nextValue) => {
        setValue(nextValue)
        observeChange?.(nextValue)
      }}
      placeholder="Search"
      {...rest}
    />
  )
}

describe('SearchField', () => {
  test('uses a real label for its native search input', () => {
    render(<ControlledSearch />)
    const input = screen.getByRole('searchbox', { name: 'Search payments' }) as HTMLInputElement
    assert.equal(input.type, 'search')
    assert.equal(screen.getByText('Search payments').tagName, 'LABEL')
    assert.equal(screen.getByText('Search payments').getAttribute('for'), input.id)
  })

  test('can show the label without replacing its accessible name', () => {
    render(<ControlledSearch hideLabel={false} />)
    assert.ok(screen.getByRole('searchbox', { name: 'Search payments' }))
    assert.equal((screen.getByText('Search payments').getAttribute('for')?.length ?? 0) > 0, true)
  })

  test('updates the visible controlled value immediately while submission remains debounced', () => {
    vi.useFakeTimers()
    const submitted = vi.fn()
    render(<ControlledSearch onSubmit={submitted} />)
    const input = screen.getByRole('searchbox', { name: 'Search payments' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'utr-42' } })
    assert.equal(input.value, 'utr-42')
    assert.equal(submitted.mock.calls.length, 0)
    vi.advanceTimersByTime(299)
    assert.equal(submitted.mock.calls.length, 0)
    vi.advanceTimersByTime(1)
    assert.deepEqual(submitted.mock.calls, [['utr-42']])
  })

  test('coalesces rapid edits and submits only the latest value', () => {
    vi.useFakeTimers()
    const submitted = vi.fn()
    render(<ControlledSearch onSubmit={submitted} debounceMs={250} />)
    const input = screen.getByRole('searchbox', { name: 'Search payments' })
    fireEvent.change(input, { target: { value: 'u' } })
    vi.advanceTimersByTime(100)
    fireEvent.change(input, { target: { value: 'ut' } })
    vi.advanceTimersByTime(100)
    fireEvent.change(input, { target: { value: 'utr' } })
    vi.advanceTimersByTime(249)
    assert.equal(submitted.mock.calls.length, 0)
    vi.advanceTimersByTime(1)
    assert.deepEqual(submitted.mock.calls, [['utr']])
  })

  test('Enter cancels pending work and submits the current value immediately', () => {
    vi.useFakeTimers()
    const submitted = vi.fn()
    render(<ControlledSearch onSubmit={submitted} />)
    const input = screen.getByRole('searchbox', { name: 'Search payments' })
    fireEvent.change(input, { target: { value: 'player' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    assert.deepEqual(submitted.mock.calls, [['player']])
    vi.runAllTimers()
    assert.deepEqual(submitted.mock.calls, [['player']])
  })

  test('Escape clears immediately and cancels a pending stale submission', () => {
    vi.useFakeTimers()
    const submitted = vi.fn()
    render(<ControlledSearch value="pending" onSubmit={submitted} />)
    const input = screen.getByRole('searchbox', { name: 'Search payments' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'pending x' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    assert.equal(input.value, '')
    assert.deepEqual(submitted.mock.calls, [['']])
    vi.runAllTimers()
    assert.deepEqual(submitted.mock.calls, [['']])
  })

  test('the labelled clear button follows the same immediate clear contract', () => {
    vi.useFakeTimers()
    const submitted = vi.fn()
    render(<ControlledSearch value="reference" onSubmit={submitted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search payments' }))
    assert.equal((screen.getByRole('searchbox', { name: 'Search payments' }) as HTMLInputElement).value, '')
    assert.deepEqual(submitted.mock.calls, [['']])
  })

  test('does not create a debounce timer when no submitted-value callback is requested', () => {
    vi.useFakeTimers()
    render(<ControlledSearch />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search payments' }), { target: { value: 'visible' } })
    assert.equal(vi.getTimerCount(), 0)
  })

  test('clears pending timers when unmounted', () => {
    vi.useFakeTimers()
    const submitted = vi.fn()
    const { unmount } = render(<ControlledSearch onSubmit={submitted} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search payments' }), { target: { value: 'orphan' } })
    assert.equal(vi.getTimerCount(), 1)
    unmount()
    assert.equal(vi.getTimerCount(), 0)
    vi.runAllTimers()
    assert.equal(submitted.mock.calls.length, 0)
  })

  test('disabled search has no clear action and cannot be edited', () => {
    render(<ControlledSearch value="locked" disabled />)
    const input = screen.getByRole('searchbox', { name: 'Search payments' }) as HTMLInputElement
    assert.equal(input.disabled, true)
    assert.equal(screen.queryByRole('button', { name: 'Clear Search payments' }), null)
  })
})
