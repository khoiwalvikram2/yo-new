import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { FilterChips, type FilterChip } from './FilterChips'

describe('FilterChips (drill-down adapter)', () => {
  test('renders nothing without chips, as before', () => {
    const { container } = render(<FilterChips chips={[]} onClearAll={vi.fn()} />)
    assert.equal(container.innerHTML, '')
  })

  test('one removal button per chip, named by label and value; Clear all only from two chips', () => {
    const onRemove = vi.fn()
    const onClearAll = vi.fn()
    const chip: FilterChip = { key: 'sport', label: 'Sport', value: 'Cricket', onRemove }
    const { rerender } = render(<FilterChips chips={[chip]} onClearAll={onClearAll} />)
    const strip = screen.getByLabelText('Active filters')
    assert.ok(within(strip).getByText('Active'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sport: Cricket' }))
    assert.equal(onRemove.mock.calls.length, 1)
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)

    rerender(
      <FilterChips
        chips={[chip, { key: 'agent', label: 'Agent', value: 42, onRemove: vi.fn() }]}
        onClearAll={onClearAll}
      />,
    )
    assert.ok(screen.getByRole('button', { name: 'Remove Agent: 42' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal(onClearAll.mock.calls.length, 1)
  })

  test('Delete removes the focused chip and focus moves to the next one', () => {
    function Harness() {
      const [keys, setKeys] = useState(['sport', 'league'])
      return (
        <FilterChips
          chips={keys.map((key) => ({
            key,
            label: key === 'sport' ? 'Sport' : 'League',
            value: key === 'sport' ? 'Cricket' : 'IPL',
            onRemove: () => setKeys((current) => current.filter((k) => k !== key)),
          }))}
          onClearAll={() => setKeys([])}
        />
      )
    }
    render(<Harness />)
    const first = screen.getByRole('button', { name: 'Remove Sport: Cricket' })
    first.focus()
    fireEvent.keyDown(first, { key: 'Delete' })
    assert.equal(screen.queryByRole('button', { name: 'Remove Sport: Cricket' }), null)
    assert.equal(document.activeElement, screen.getByRole('button', { name: 'Remove League: IPL' }))
  })
})
