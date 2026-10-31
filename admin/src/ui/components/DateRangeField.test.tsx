import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DateRangeField } from './DateRangeField'
import type { DateRangeApply } from './DateRangePanel'

const OVERVIEW_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: '7D' },
  { value: 'custom', label: 'Custom' },
]

const DEPOSIT_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'last30days', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

function renderField(overrides: Partial<React.ComponentProps<typeof DateRangeField>> = {}) {
  const applied: DateRangeApply[] = []
  const reset = vi.fn()
  render(
    <DateRangeField
      presets={OVERVIEW_PRESETS}
      appliedPreset="today"
      onApply={(value) => applied.push(value)}
      onReset={reset}
      {...overrides}
    />,
  )
  return { applied, reset }
}

describe('DateRangeField', () => {
  test('renders a named pill from the controlled applied preset', () => {
    renderField()
    const trigger = screen.getByRole('button', { name: 'Period: Today' })
    assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog')
    assert.ok(trigger.querySelector('svg.tabler-icon-calendar'))
  })

  test('passes either pilot preset set to the panel without assuming fixed values', async () => {
    renderField({ presets: DEPOSIT_PRESETS, appliedPreset: 'last30days', label: 'Date range' })
    fireEvent.click(screen.getByRole('button', { name: 'Date range: Last 30 days' }))

    const dialog = await screen.findByRole('dialog', { name: 'Date range' })
    assert.ok(dialog)
    assert.ok(screen.getByRole('button', { name: 'Last 7 days' }))
    assert.ok(screen.getByRole('button', { name: 'Custom range' }))
    assert.equal(screen.queryByRole('button', { name: 'Yesterday' }), null)
  })

  test('Apply reports the draft, closes, and returns focus without changing controlled text itself', async () => {
    const state = renderField()
    const trigger = screen.getByRole('button', { name: 'Period: Today' })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Period' })

    fireEvent.click(screen.getByRole('button', { name: '7D' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    assert.deepEqual(state.applied, [{ kind: 'preset', preset: 'last7days' }])
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.equal(document.activeElement, trigger))
    assert.ok(screen.getByRole('button', { name: 'Period: Today' }), 'the owner has not updated its controlled value')
  })

  test('Reset closes, returns focus, and delegates the controlled reset', async () => {
    const state = renderField({ appliedPreset: 'last7days' })
    const trigger = screen.getByRole('button', { name: 'Period: 7D' })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Period' })

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    assert.equal(state.reset.mock.calls.length, 1)
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.equal(document.activeElement, trigger))
  })

  test('custom applied days form the default visible value and a caller may override it', () => {
    const { rerender } = render(
      <DateRangeField
        presets={OVERVIEW_PRESETS}
        appliedPreset="custom"
        appliedFrom="2026-09-01"
        appliedTo="2026-09-22"
        onApply={() => {}}
        onReset={() => {}}
      />,
    )
    assert.ok(screen.getByRole('button', { name: 'Period: 2026-09-01 – 2026-09-22' }))

    rerender(
      <DateRangeField
        presets={OVERVIEW_PRESETS}
        appliedPreset="custom"
        appliedFrom="2026-09-01"
        appliedTo="2026-09-22"
        valueLabel="1–22 Sep 2026"
        onApply={() => {}}
        onReset={() => {}}
      />,
    )
    assert.ok(screen.getByRole('button', { name: 'Period: 1–22 Sep 2026' }))
  })

  test('disabled prevents the popover from opening', () => {
    renderField({ disabled: true })
    fireEvent.click(screen.getByRole('button', { name: 'Period: Today' }))
    assert.equal(screen.queryByRole('dialog'), null)
  })
})
