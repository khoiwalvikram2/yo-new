/**
 * The panel stages a period and applies it once. The cases that matter are the ones the dashboard's
 * own panel got wrong before it was fixed: Apply must not close the host as if it had applied a range
 * it could not apply, and it must say why it cannot. Closing without applying must throw the staging
 * away, which a host popover gets for free by unmounting.
 */
import { test, describe, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DateRangePanel, type DateRangeApply } from './DateRangePanel'
import calendarStyles from './Calendar.module.css'

afterEach(cleanup)

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: '7D' },
  { value: 'custom', label: 'Custom' },
]

function setup(overrides: Partial<React.ComponentProps<typeof DateRangePanel>> = {}) {
  const applied: DateRangeApply[] = []
  let resets = 0
  let dones = 0
  render(
    <DateRangePanel
      presets={PRESETS}
      appliedPreset="today"
      appliedFrom="2026-09-01"
      appliedTo="2026-09-22"
      onApply={(payload) => applied.push(payload)}
      onReset={() => {
        resets += 1
      }}
      onDone={() => {
        dones += 1
      }}
      {...overrides}
    />
  )
  return {
    applied,
    get resets() {
      return resets
    },
    get dones() {
      return dones
    },
  }
}

const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value
const openCalendar = async (button: HTMLElement) => {
  fireEvent.click(button)
  return screen.findByRole('dialog', { name: 'Choose a date' })
}
const dayIn = (calendar: HTMLElement, name: string) =>
  within(calendar).getByRole('button', { name: new RegExp(`^${name}(, today)?$`) })

describe('DateRangePanel', () => {
  test('shows the presets with the applied one pressed, and no date fields', () => {
    setup()
    assert.equal(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed'), 'true')
    assert.equal(screen.queryByLabelText('Start date'), null)
  })

  test('staging a preset changes nothing until Apply', () => {
    const state = setup()
    fireEvent.click(screen.getByRole('button', { name: '7D' }))
    assert.deepEqual(state.applied, [])
    assert.equal(screen.getByRole('button', { name: '7D' }).getAttribute('aria-pressed'), 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.deepEqual(state.applied, [{ kind: 'preset', preset: 'last7days' }])
    assert.equal(state.dones, 1)
  })

  test('Custom opens two date fields seeded from the applied range', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    assert.equal((screen.getByLabelText('Start date') as HTMLInputElement).value, '2026-09-01')
    assert.equal((screen.getByLabelText('End date') as HTMLInputElement).value, '2026-09-22')
  })

  test('Apply is blocked, and says why, while the custom range is incomplete or reversed', () => {
    const state = setup({ appliedFrom: undefined, appliedTo: undefined })
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))

    const apply = screen.getByRole('button', { name: 'Apply' })
    assert.equal(apply.getAttribute('aria-disabled'), 'true')
    assert.ok(screen.getByText('Pick both dates'))
    // the reason is linked to the button, not merely near it
    assert.equal(apply.getAttribute('aria-describedby'), screen.getByText('Pick both dates').id)

    fireEvent.click(apply)
    assert.deepEqual(state.applied, [], 'a blocked Apply must apply nothing')
    assert.equal(state.dones, 0, 'and must not let the host close as if it had')

    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-20' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-10' } })
    assert.ok(screen.getByText('The end date is before the start'))
    assert.equal(screen.getByRole('button', { name: 'Apply' }).getAttribute('aria-disabled'), 'true')
  })

  test('a whole custom range applies as days', () => {
    const state = setup({ appliedFrom: undefined, appliedTo: undefined })
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-10' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-20' } })

    const apply = screen.getByRole('button', { name: 'Apply' })
    assert.equal(apply.getAttribute('aria-disabled'), null)
    fireEvent.click(apply)
    assert.deepEqual(state.applied, [{ kind: 'custom', from: '2026-09-10', to: '2026-09-20' }])
    assert.equal(state.dones, 1)
  })

  test('Reset clears the staged dates, tells the page, and lets the host close', () => {
    const state = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.equal(state.resets, 1)
    assert.equal(state.dones, 1)
    assert.deepEqual(state.applied, [])
  })

  test('follows the applied preset when the page changes it from outside', () => {
    const { rerender } = render(
      <DateRangePanel
        presets={PRESETS}
        appliedPreset="today"
        onApply={() => {}}
        onReset={() => {}}
      />
    )
    assert.equal(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed'), 'true')

    rerender(
      <DateRangePanel
        presets={PRESETS}
        appliedPreset="yesterday"
        onApply={() => {}}
        onReset={() => {}}
      />
    )
    assert.equal(screen.getByRole('button', { name: 'Yesterday' }).getAttribute('aria-pressed'), 'true')
    assert.equal(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed'), 'false')
  })

  test('the custom fields share a range calendar: start, then end, and a reversed end swaps', async () => {
    const state = setup({ appliedPreset: 'custom' })
    const [startButton] = screen.getAllByRole('button', { name: 'Choose date' })

    const calendar = await openCalendar(startButton)
    assert.ok(within(calendar).getByText('Pick the start date'))
    assert.equal(dayIn(calendar, '1 September 2026').getAttribute('aria-pressed'), 'true')
    assert.equal(dayIn(calendar, '22 September 2026').getAttribute('aria-pressed'), 'true')
    assert.ok(dayIn(calendar, '10 September 2026').classList.contains(calendarStyles.isIn))

    fireEvent.click(dayIn(calendar, '10 September 2026'))
    assert.equal(value('Start date'), '2026-09-10')
    assert.equal(value('End date'), '2026-09-22')
    assert.ok(screen.getByRole('dialog', { name: 'Choose a date' }), 'it stays open for the end')
    assert.ok(within(calendar).getByText('Pick the end date'))
    assert.ok(!dayIn(calendar, '5 September 2026').classList.contains(calendarStyles.isIn))

    fireEvent.click(dayIn(calendar, '5 September 2026'))
    assert.equal(value('Start date'), '2026-09-05')
    assert.equal(value('End date'), '2026-09-10')
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Choose a date' }), null))
    assert.deepEqual(state.applied, [], 'a pick stages; it applies nothing')

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.deepEqual(state.applied, [{ kind: 'custom', from: '2026-09-05', to: '2026-09-10' }])
  })

  test('opened from the end field the calendar picks the end; a start after the end clears it', async () => {
    setup({ appliedPreset: 'custom' })
    const [startButton, endButton] = screen.getAllByRole('button', { name: 'Choose date' })

    let calendar = await openCalendar(endButton)
    assert.ok(within(calendar).getByText('Pick the end date'))
    fireEvent.click(dayIn(calendar, '25 September 2026'))
    assert.equal(value('Start date'), '2026-09-01')
    assert.equal(value('End date'), '2026-09-25')
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Choose a date' }), null))

    calendar = await openCalendar(startButton)
    fireEvent.click(dayIn(calendar, '28 September 2026'))
    assert.equal(value('Start date'), '2026-09-28')
    assert.equal(value('End date'), '', 'the old end now precedes the start, so it is picked again')
    assert.ok(screen.getByText('Pick both dates'))
    fireEvent.click(dayIn(calendar, '30 September 2026'))
    assert.equal(value('End date'), '2026-09-30')
  })

  test('the range calendar keeps to the panel bounds, not the narrowed bounds of each field', async () => {
    setup({ appliedPreset: 'custom', min: '2026-08-01', max: '2026-09-30' })
    const [startButton] = screen.getAllByRole('button', { name: 'Choose date' })
    // typing keeps the cross-field bound on the native input
    assert.equal((screen.getByLabelText('Start date') as HTMLInputElement).max, '2026-09-22')

    const calendar = await openCalendar(startButton)
    assert.equal((dayIn(calendar, '25 September 2026') as HTMLButtonElement).disabled, false)
    assert.equal((dayIn(calendar, '1 October 2026') as HTMLButtonElement).disabled, true)
  })
})
