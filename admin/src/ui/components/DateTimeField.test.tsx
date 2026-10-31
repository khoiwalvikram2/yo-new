import { createRef } from 'react'
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DateTimeField } from './DateTimeField'
import styles from './TextField.module.css'

afterEach(cleanup)

describe('DateTimeField', () => {
  test('is a controlled minute-precision native datetime-local input', () => {
    render(<DateTimeField label="Starts at" value="2026-09-22T14:30" onChange={() => {}} />)
    const input = screen.getByLabelText('Starts at') as HTMLInputElement
    assert.equal(input.type, 'datetime-local')
    assert.equal(input.value, '2026-09-22T14:30')
    assert.equal(input.step, '60')
  })

  test('emits the plain calendar string supplied by the native control', () => {
    const changes: string[] = []
    render(<DateTimeField label="Starts at" value="" onChange={(next) => changes.push(next)} />)
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '2026-09-22T14:30' } })
    assert.deepEqual(changes, ['2026-09-22T14:30'])
  })

  test('passes bounds and a custom step to the native input', () => {
    render(
      <DateTimeField
        label="Window"
        value="2026-09-22T14:30"
        onChange={() => {}}
        min="2026-09-01T00:00"
        max="2026-09-30T23:55"
        step={300}
      />,
    )
    const input = screen.getByLabelText('Window') as HTMLInputElement
    assert.equal(input.min, '2026-09-01T00:00')
    assert.equal(input.max, '2026-09-30T23:55')
    assert.equal(input.step, '300')
  })

  test('never emits a seconds-bearing value', () => {
    const changes = vi.fn()
    render(<DateTimeField label="Window" value="" onChange={changes} />)
    const input = screen.getByLabelText('Window')
    fireEvent.change(input, { target: { value: '2026-09-22T14:30:30' } })
    assert.equal(changes.mock.calls.length, 0)
    fireEvent.change(input, { target: { value: '2026-09-22T14:30' } })
    assert.deepEqual(changes.mock.calls, [['2026-09-22T14:30']])
  })

  test('wires required, help and error copy through FieldShell', () => {
    render(
      <DateTimeField
        label="Ends at"
        value=""
        onChange={() => {}}
        required
        help="Times use IST."
        error="End must be after start"
        aria-invalid={false}
      />,
    )
    const input = screen.getByLabelText(/Ends at/) as HTMLInputElement
    assert.equal(input.required, true)
    assert.equal(input.getAttribute('aria-required'), 'true')
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    const descriptionIds = (input.getAttribute('aria-describedby') ?? '').split(' ')
    assert.equal(descriptionIds.length, 2)
    for (const id of descriptionIds) assert.ok(document.getElementById(id), `missing description ${id}`)
    assert.ok(screen.getByRole('alert'))
  })

  test('preserves an explicit accessible required state without forcing native required', () => {
    render(
      <DateTimeField
        label="Optional schedule"
        value=""
        onChange={() => {}}
        aria-required="true"
      />,
    )
    const input = screen.getByLabelText('Optional schedule') as HTMLInputElement
    assert.equal(input.required, false)
    assert.equal(input.getAttribute('aria-required'), 'true')
  })

  test('keeps a hidden real label and forwards its input ref and native attributes', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <DateTimeField
        ref={ref}
        label="Internal schedule"
        hideLabel
        value=""
        onChange={() => {}}
        name="startDate"
        autoComplete="off"
        data-testid="schedule"
      />,
    )
    const input = screen.getByTestId('schedule') as HTMLInputElement
    assert.equal(ref.current, input)
    assert.equal(input.name, 'startDate')
    assert.equal(input.autocomplete, 'off')
    assert.equal(screen.getByLabelText('Internal schedule'), input)
  })

  test('reuses TextField size, status and disabled chrome', () => {
    const { container, rerender } = render(
      <DateTimeField label="Starts at" size="sm" status="success" value="" onChange={() => {}} />,
    )
    const chrome = container.querySelector(`.${styles.field}`)
    assert.ok(chrome?.classList.contains(styles.sm))
    assert.ok(chrome?.classList.contains(styles.success))

    rerender(<DateTimeField label="Starts at" disabled value="" onChange={() => {}} />)
    assert.ok(container.querySelector(`.${styles.field}`)?.classList.contains(styles.disabled))
    assert.equal((screen.getByLabelText('Starts at') as HTMLInputElement).disabled, true)
  })

  test('the calendar picks the date part within the bounds and keeps the typed time', async () => {
    const changes: string[] = []
    render(
      <DateTimeField
        label="Starts at"
        value="2026-10-17T14:30"
        min="2026-10-05T09:00"
        max="2026-10-25T18:00"
        onChange={(next) => changes.push(next)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }))
    const calendar = await screen.findByRole('dialog', { name: 'Choose a date' })
    assert.ok(within(calendar).getByText('Time stays 14:30 IST'))
    const named = (name: string) =>
      within(calendar).getByRole('button', { name: new RegExp(`^${name}(, today)?$`) }) as HTMLButtonElement
    assert.equal(named('4 October 2026').disabled, true)
    assert.equal(named('26 October 2026').disabled, true)

    fireEvent.click(named('20 October 2026'))
    assert.deepEqual(changes, ['2026-10-20T14:30'])
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
  })

  test('a disabled field never opens its calendar', () => {
    render(<DateTimeField label="Starts at" value="" disabled onChange={() => {}} />)
    const button = screen.getByRole('button', { name: 'Choose date' }) as HTMLButtonElement
    assert.equal(button.disabled, true)
    fireEvent.click(button)
    assert.equal(screen.queryByRole('dialog'), null)
  })
})
