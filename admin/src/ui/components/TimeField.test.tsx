import assert from 'node:assert/strict'
import { createRef } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { TimeField } from './TimeField'
import { timeOptions } from './timeOptions'
import styles from './TextField.module.css'
import listboxStyles from './Listbox.module.css'
import timeStyles from './TimeField.module.css'

// Query the input while the list is closed: the open listbox is named by the label too.
const timeInput = (label = 'Draw time') => screen.getByLabelText(label) as HTMLInputElement
const clock = () => screen.getByRole('button', { name: 'Choose a time' }) as HTMLButtonElement
const openList = async () => {
  fireEvent.click(clock())
  return screen.findByRole('listbox')
}
// The active option carries the kit's active class; its first child is the label. (Matched in script:
// jsdom's selector engine can answer a class selector from a stale cache right after a class change.)
const activeLabel = (list: HTMLElement) =>
  Array.from(list.querySelectorAll('[role="option"]'))
    .find((option) => option.classList.contains(listboxStyles.active))
    ?.firstElementChild?.textContent ?? null

describe('TimeField', () => {
  test('is a controlled native time input with a one-minute step by default', () => {
    render(<TimeField label="Draw time" value="14:30" onChange={() => undefined} />)
    const input = timeInput()
    assert.equal(input.type, 'time')
    assert.equal(input.value, '14:30')
    assert.equal(input.step, '60')
  })

  test('emits the plain HH:mm string and the empty string when cleared', () => {
    const changes = vi.fn()
    const { rerender } = render(<TimeField label="Draw time" value="" onChange={changes} />)
    fireEvent.change(timeInput(), { target: { value: '09:05' } })
    rerender(<TimeField label="Draw time" value="09:05" onChange={changes} />)
    fireEvent.change(timeInput(), { target: { value: '' } })
    assert.deepEqual(changes.mock.calls, [['09:05'], ['']])
  })

  test('never emits a seconds-bearing value', () => {
    const changes = vi.fn()
    render(<TimeField label="Draw time" value="" onChange={changes} />)
    fireEvent.change(timeInput(), { target: { value: '14:30:30' } })
    assert.equal(changes.mock.calls.length, 0)
  })

  test('uncontrolled: starts from defaultValue and still reports changes', () => {
    const changes = vi.fn()
    render(<TimeField label="Draw time" defaultValue="08:00" onChange={changes} />)
    const input = timeInput()
    assert.equal(input.value, '08:00')
    fireEvent.change(input, { target: { value: '08:15' } })
    assert.equal(input.value, '08:15')
    assert.deepEqual(changes.mock.calls, [['08:15']])
  })

  test('passes bounds and a whole-minute step to the native input', () => {
    render(<TimeField label="Draw time" value="10:00" onChange={() => undefined} min="09:00" max="17:55" step={300} />)
    const input = timeInput()
    assert.equal(input.min, '09:00')
    assert.equal(input.max, '17:55')
    assert.equal(input.step, '300')
  })

  test('rejects a step that is not a whole number of minutes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // React reports the render error to window before rethrowing it; keep jsdom from printing it.
    const swallow = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener('error', swallow)
    try {
      assert.throws(
        () => render(<TimeField label="Draw time" value="" onChange={() => undefined} step={30} />),
        RangeError,
      )
    } finally {
      window.removeEventListener('error', swallow)
    }
  })

  test('wires required, help and error copy through FieldShell', () => {
    render(
      <TimeField
        label="Closes at"
        value=""
        onChange={() => undefined}
        required
        help="Times use IST."
        error="Close must be after open"
        aria-invalid={false}
      />,
    )
    const input = screen.getByLabelText(/Closes at/) as HTMLInputElement
    assert.equal(input.required, true)
    assert.equal(input.getAttribute('aria-required'), 'true')
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    assert.equal(ids.length, 2)
    assert.equal(document.getElementById(ids[0])?.textContent, 'Times use IST.')
    assert.equal(document.getElementById(ids[1])?.textContent, 'Close must be after open')
    assert.equal(screen.getByRole('alert').textContent, 'Close must be after open')
  })

  test('keeps a hidden real label and forwards its ref and native attributes', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <TimeField ref={ref} label="Open time" hideLabel value="" onChange={() => undefined} name="openTime" data-testid="open" />,
    )
    const input = screen.getByTestId('open') as HTMLInputElement
    assert.ok(ref.current === input)
    assert.equal(input.name, 'openTime')
    assert.ok(screen.getByLabelText('Open time') === input)
  })

  test('wears the TextField face with its size, status and disabled chrome', () => {
    const { container, rerender } = render(
      <TimeField label="Draw time" size="sm" status="success" value="" onChange={() => undefined} />,
    )
    const chrome = container.querySelector(`.${styles.field}`)
    assert.ok(chrome?.classList.contains(styles.sm))
    assert.ok(chrome?.classList.contains(styles.success))

    rerender(<TimeField label="Draw time" disabled value="" onChange={() => undefined} />)
    assert.ok(container.querySelector(`.${styles.field}`)?.classList.contains(styles.disabled))
    assert.equal(timeInput().disabled, true)
    assert.equal(clock().disabled, true, 'a disabled field cannot open its time list')
  })
})

describe('TimeField time list', () => {
  test('lists every 30 minutes by default, or the coarser step counted from min, within min..max', () => {
    const daily = timeOptions(60)
    assert.equal(daily.length, 48)
    assert.deepEqual([daily[0].value, daily[1].value, daily[47].value], ['00:00', '00:30', '23:30'])
    assert.deepEqual(
      timeOptions(60, '09:10', '10:30').map((option) => option.value),
      ['09:30', '10:00', '10:30'],
    )
    assert.deepEqual(
      timeOptions(900, '09:10', '10:00').map((option) => option.value),
      ['09:10', '09:25', '09:40', '09:55'],
    )
    assert.equal(timeOptions(300).length, 288)
  })

  test('the clock button opens the list with the current value ticked', async () => {
    render(<TimeField label="Draw time" value="14:30" onChange={() => undefined} />)
    const button = clock()
    assert.equal(button.getAttribute('aria-haspopup'), 'listbox')
    assert.equal(button.getAttribute('aria-expanded'), 'false')

    const list = await openList()
    assert.equal(list.getAttribute('aria-label'), 'Draw time')
    assert.equal(button.getAttribute('aria-expanded'), 'true')
    assert.equal(button.getAttribute('aria-controls'), list.id)
    assert.equal(within(list).getAllByRole('option').length, 48)
    assert.equal(within(list).getByRole('option', { selected: true }).textContent, '14:30')
    assert.equal(activeLabel(list), '14:30')

    fireEvent.click(button)
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
  })

  test('picking a time emits HH:mm and closes the list', async () => {
    const changes = vi.fn()
    render(<TimeField label="Draw time" value="14:30" onChange={changes} />)
    const list = await openList()
    fireEvent.click(within(list).getByRole('option', { name: '09:00' }))
    assert.deepEqual(changes.mock.calls, [['09:00']])
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))

    // Re-picking the shown time is no change, as with the native input.
    fireEvent.click(within(await openList()).getByRole('option', { name: '14:30' }))
    assert.equal(changes.mock.calls.length, 1)
  })

  test('keys on the button: ArrowDown opens, the arrows move, Enter picks, Escape stays inside', async () => {
    const changes = vi.fn()
    const outer: string[] = []
    render(
      <div onKeyDown={(event) => outer.push(event.key)}>
        <TimeField label="Open time" value="10:10" step={900} min="10:00" max="12:00" onChange={changes} />
      </div>,
    )
    const button = clock()
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    const list = await screen.findByRole('listbox')
    assert.equal(activeLabel(list), '10:15', 'a time off the grid opens on the next listed one')
    assert.equal(within(list).queryByRole('option', { selected: true }), null)

    assert.equal(fireEvent.keyDown(button, { key: 'ArrowDown' }), false)
    assert.equal(activeLabel(list), '10:30')
    fireEvent.keyDown(button, { key: 'End' })
    assert.equal(activeLabel(list), '12:00')
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    assert.equal(activeLabel(list), '12:00', 'no wrap past the end')
    fireEvent.keyDown(button, { key: '1' })
    fireEvent.keyDown(button, { key: '1' })
    assert.equal(activeLabel(list), '11:00', 'typeahead')
    fireEvent.keyDown(button, { key: 'Enter' })
    assert.deepEqual(changes.mock.calls, [['11:00']])
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))

    fireEvent.keyDown(button, { key: 'ArrowDown' })
    await screen.findByRole('listbox')
    assert.equal(fireEvent.keyDown(button, { key: 'Escape' }), false)
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
    assert.equal(changes.mock.calls.length, 1)
    // Only the two opening presses, made while the list was closed, bubbled on.
    assert.deepEqual(outer, ['ArrowDown', 'ArrowDown'], 'no open-list key reaches an enclosing Dialog')
  })

  test('uncontrolled: a pick writes the native input, and typing still works after it', async () => {
    const changes = vi.fn()
    render(<TimeField label="Draw time" defaultValue="08:00" onChange={changes} />)
    const list = await openList()
    fireEvent.click(within(list).getByRole('option', { name: '08:30' }))
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
    const input = timeInput()
    assert.equal(input.value, '08:30')

    fireEvent.change(input, { target: { value: '08:45' } })
    assert.equal(input.value, '08:45')
    assert.deepEqual(changes.mock.calls, [['08:30'], ['08:45']])

    // The list reads the typed value when it opens: 08:45 is off the grid, so 09:00 is active, none ticked.
    const reopened = await openList()
    assert.equal(activeLabel(reopened), '09:00')
    assert.equal(within(reopened).queryByRole('option', { selected: true }), null)
  })

  test('the native picker indicator is hidden by a TimeField class on the input', () => {
    render(<TimeField label="Draw time" value="" onChange={() => undefined} />)
    assert.ok(timeInput().classList.contains(timeStyles.input))
    assert.ok(clock().closest(`.${styles.field}`), 'the clock button sits inside the field face')
  })
})
