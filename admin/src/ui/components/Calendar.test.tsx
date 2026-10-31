/**
 * The calendar replaces the browser's picker, so it owes what the native one gave for free: a keyboard
 * route to every day (the WAI-ARIA date picker dialog keys, with one tabbable day), days a bound rules
 * out that cannot be picked, names a screen reader can say, and an Escape that closes only the calendar —
 * not the Dialog or period popover it was opened from. Today is pinned through the `today` prop.
 */
import { useState } from 'react'
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Calendar } from './Calendar'
import { DateField } from './DateField'
import { DateRangeField } from './DateRangeField'
import type { DateRangeApply } from './DateRangePanel'
import { Dialog } from './Dialog'
import styles from './Calendar.module.css'

afterEach(cleanup)

const TODAY = '2026-10-17'

const focusedDay = () => (document.activeElement as HTMLElement | null)?.dataset.day
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
/** Lets a host's deferred (next-frame) first focus land, as it has long before a person clicks. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)))
const day = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}(, today)?$`) }) as HTMLButtonElement

describe('Calendar', () => {
  test('draws a six-week month from Monday, with today and the chosen day marked and tabbable', () => {
    const { container } = render(<Calendar value="2026-10-20" today={TODAY} onSelect={() => {}} />)
    const grid = screen.getByRole('group', { name: 'October 2026' })
    const days = within(grid).getAllByRole('button')
    assert.equal(days.length, 42)
    assert.equal(days[0].getAttribute('aria-label'), '28 September 2026')
    assert.equal(days[41].getAttribute('aria-label'), '8 November 2026')
    assert.ok(days[0].classList.contains(styles.isOut))
    assert.deepEqual(
      Array.from(container.querySelectorAll(`.${styles.dow}`), (node) => node.textContent),
      ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    )

    const today = within(grid).getByRole('button', { name: '17 October 2026, today' })
    assert.ok(today.classList.contains(styles.isToday))
    const chosen = within(grid).getByRole('button', { name: '20 October 2026' })
    assert.equal(chosen.getAttribute('aria-pressed'), 'true')
    assert.ok(chosen.classList.contains(styles.isSel))
    assert.equal(today.getAttribute('aria-pressed'), null)
    // roving tabindex: the chosen day is the one way in
    assert.deepEqual(days.filter((button) => button.tabIndex === 0), [chosen])
  })

  test('arrows, Home/End and PageUp/PageDown move focus, and the month follows the focused day', () => {
    render(<Calendar value={TODAY} today={TODAY} onSelect={() => {}} autoFocus />)
    assert.equal(focusedDay(), '2026-10-17')

    press('ArrowRight')
    assert.equal(focusedDay(), '2026-10-18')
    press('ArrowDown')
    assert.equal(focusedDay(), '2026-10-25')
    press('ArrowLeft')
    assert.equal(focusedDay(), '2026-10-24')
    press('ArrowUp')
    assert.equal(focusedDay(), '2026-10-17')
    press('Home')
    assert.equal(focusedDay(), '2026-10-12', 'Monday starts the week')
    press('End')
    assert.equal(focusedDay(), '2026-10-18', 'Sunday ends it')

    press('PageDown')
    assert.equal(focusedDay(), '2026-11-18')
    assert.ok(screen.getByRole('group', { name: 'November 2026' }))
    press('PageUp')
    assert.equal(focusedDay(), '2026-10-18')
    press('PageDown', { shiftKey: true })
    assert.equal(focusedDay(), '2027-10-18')
    press('PageUp', { shiftKey: true })

    press('ArrowDown')
    press('ArrowDown')
    assert.equal(focusedDay(), '2026-11-01', 'leaving the month turns the page')
    assert.ok(screen.getByRole('group', { name: 'November 2026' }))
    assert.equal((document.activeElement as HTMLElement).tabIndex, 0)
  })

  test('a month on is held to the last day of a shorter month', () => {
    render(<Calendar value="2026-01-31" today={TODAY} onSelect={() => {}} autoFocus />)
    press('PageDown')
    assert.equal(focusedDay(), '2026-02-28')
  })

  test('Enter and Space pick the focused day; Escape asks to close and goes no further', () => {
    const picked: string[] = []
    const onClose = vi.fn()
    const outside = vi.fn()
    document.addEventListener('keydown', outside)
    try {
      render(<Calendar value={TODAY} today={TODAY} onSelect={(next) => picked.push(next)} onClose={onClose} autoFocus />)
      press('ArrowRight')
      press('Enter')
      press('ArrowRight')
      press(' ')
      assert.deepEqual(picked, ['2026-10-18', '2026-10-19'])

      press('Escape')
      assert.equal(onClose.mock.calls.length, 1)
      const escapes = outside.mock.calls.filter(([event]) => (event as KeyboardEvent).key === 'Escape')
      assert.equal(escapes.length, 0, 'an enclosing Dialog must not see the Escape')
    } finally {
      document.removeEventListener('keydown', outside)
    }
  })

  test('min and max disable the days outside, Today and the month buttons, and keep focus inside', () => {
    const onSelect = vi.fn()
    render(
      <Calendar value="2026-10-10" min="2026-10-05" max="2026-10-15" today={TODAY} onSelect={onSelect} autoFocus />,
    )
    assert.equal(day('4 October 2026').disabled, true)
    assert.equal(day('5 October 2026').disabled, false)
    assert.equal(day('15 October 2026').disabled, false)
    assert.equal(day('16 October 2026').disabled, true)
    assert.equal((screen.getByRole('button', { name: 'Today' }) as HTMLButtonElement).disabled, true)

    const previous = screen.getByRole('button', { name: 'Previous month' })
    const next = screen.getByRole('button', { name: 'Next month' })
    assert.equal(previous.getAttribute('aria-disabled'), 'true')
    assert.equal(next.getAttribute('aria-disabled'), 'true')
    fireEvent.click(next)
    assert.ok(screen.getByRole('group', { name: 'October 2026' }))

    press('ArrowDown')
    assert.equal(focusedDay(), '2026-10-15', 'focus stops at max')
    press('PageUp')
    assert.equal(focusedDay(), '2026-10-05', 'and at min')

    fireEvent.click(day('20 October 2026'))
    assert.equal(onSelect.mock.calls.length, 0)
  })

  test('a range marks both ends and shades the days between', () => {
    render(<Calendar start="2026-10-05" end="2026-10-09" today={TODAY} onSelect={() => {}} />)
    for (const end of ['5 October 2026', '9 October 2026']) {
      assert.equal(day(end).getAttribute('aria-pressed'), 'true')
      assert.ok(day(end).classList.contains(styles.isSel))
    }
    for (const between of ['6 October 2026', '7 October 2026', '8 October 2026']) {
      assert.ok(day(between).classList.contains(styles.isIn), between)
      assert.equal(day(between).getAttribute('aria-pressed'), null)
    }
    for (const outside of ['4 October 2026', '10 October 2026']) {
      assert.ok(!day(outside).classList.contains(styles.isIn), outside)
      assert.equal(day(outside).getAttribute('aria-pressed'), null)
    }
  })

  test('the month buttons turn the page and carry the tabbable day; Today picks today', () => {
    const onSelect = vi.fn()
    render(<Calendar value="2026-08-03" today={TODAY} onSelect={onSelect} />)
    assert.ok(screen.getByRole('group', { name: 'August 2026' }))

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    assert.ok(screen.getByRole('group', { name: 'September 2026' }))
    assert.equal(day('3 September 2026').tabIndex, 0)

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    assert.ok(screen.getByRole('group', { name: 'July 2026' }))

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    assert.deepEqual(onSelect.mock.calls, [[TODAY]])
    assert.ok(screen.getByRole('group', { name: 'October 2026' }))
  })
})

describe('CalendarPopover in its hosts', () => {
  test('Escape closes the calendar and returns focus to its button, leaving the enclosing Dialog open', async () => {
    const onDialogChange = vi.fn()
    function Host() {
      const [value, setValue] = useState('2026-10-14')
      return (
        <Dialog open onOpenChange={onDialogChange} title="Edit window">
          <DateField label="From" value={value} onChange={setValue} />
        </Dialog>
      )
    }
    render(<Host />)
    const button = await screen.findByRole('button', { name: 'Choose date' })
    // the Dialog's own first focus lands a frame later; a person clicks after it, so the test does too
    await settle()
    fireEvent.click(button)
    await screen.findByRole('dialog', { name: 'Choose a date' })
    await waitFor(() => assert.equal(focusedDay(), '2026-10-14'))

    press('Escape')
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Choose a date' }), null))
    assert.ok(screen.getByRole('dialog', { name: 'Edit window' }))
    assert.equal(onDialogChange.mock.calls.length, 0)
    await waitFor(() => assert.equal(document.activeElement, button))
  })

  test('inside the period popover a press in the calendar is not an outside press, and Escape stays local', async () => {
    const applied: DateRangeApply[] = []
    render(
      <DateRangeField
        presets={[
          { value: 'today', label: 'Today' },
          { value: 'custom', label: 'Custom' },
        ]}
        appliedPreset="custom"
        appliedFrom="2026-09-01"
        appliedTo="2026-09-22"
        onApply={(payload) => applied.push(payload)}
        onReset={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Period: 2026-09-01 – 2026-09-22' }))
    const period = await screen.findByRole('dialog', { name: 'Period' })
    await settle()
    const [startButton] = within(period).getAllByRole('button', { name: 'Choose date' })

    fireEvent.click(startButton)
    await screen.findByRole('dialog', { name: 'Choose a date' })
    await waitFor(() => assert.equal(focusedDay(), '2026-09-01'))
    press('Escape')
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Choose a date' }), null))
    assert.ok(screen.getByRole('dialog', { name: 'Period' }), 'the period popover stays open')

    fireEvent.click(startButton)
    await screen.findByRole('dialog', { name: 'Choose a date' })
    for (const name of ['10 September 2026', '15 September 2026']) {
      const target = day(name)
      fireEvent.pointerDown(target)
      fireEvent.mouseDown(target)
      fireEvent.pointerUp(target)
      fireEvent.mouseUp(target)
      fireEvent.click(target)
    }
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Choose a date' }), null))
    assert.ok(screen.getByRole('dialog', { name: 'Period' }))
    assert.equal((within(period).getByLabelText('Start date') as HTMLInputElement).value, '2026-09-10')
    assert.equal((within(period).getByLabelText('End date') as HTMLInputElement).value, '2026-09-15')

    fireEvent.click(within(period).getByRole('button', { name: 'Apply' }))
    assert.deepEqual(applied, [{ kind: 'custom', from: '2026-09-10', to: '2026-09-15' }])
  })
})
