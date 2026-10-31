/**
 * The field is a native date input in kit clothing, so what matters is the wiring a form depends on:
 * the label names the control, help and error are linked rather than merely nearby, an error marks the
 * input invalid, and the value the page gets back is the day string it gave — whether it was typed or
 * picked in the themed calendar its icon button opens.
 */
import { test, describe, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import { DateField } from './DateField'

afterEach(cleanup)

describe('DateField', () => {
  test('is a date input named by its label', () => {
    render(<DateField label="From" value="2026-09-22" onChange={() => {}} />)
    const input = screen.getByLabelText('From') as HTMLInputElement
    assert.equal(input.type, 'date')
    assert.equal(input.value, '2026-09-22')
  })

  test('keeps the label for assistive tech when it is hidden', () => {
    render(<DateField label="Start date" hideLabel value="" onChange={() => {}} />)
    assert.ok(screen.getByLabelText('Start date'))
  })

  test('gives the page the day string', () => {
    const seen: string[] = []
    render(<DateField label="From" value="" onChange={(v) => seen.push(v)} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-24' } })
    assert.deepEqual(seen, ['2026-09-24'])
  })

  test('links help and error to the input, and marks it invalid', () => {
    render(
      <DateField
        label="To"
        value="2026-09-01"
        onChange={() => {}}
        help="Both dates are inclusive"
        error="The end cannot be before the start"
      />
    )
    const input = screen.getByLabelText('To')
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ')
    assert.equal(describedBy.length, 2)
    for (const id of describedBy) assert.ok(document.getElementById(id), `missing element for ${id}`)
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    assert.ok(screen.getByText('The end cannot be before the start'))
  })

  test('passes the day bounds and the required state to the native control', () => {
    render(<DateField label="From" value="" onChange={() => {}} min="2026-01-01" max="2026-12-31" required />)
    const input = screen.getByLabelText(/From/) as HTMLInputElement
    assert.equal(input.min, '2026-01-01')
    assert.equal(input.max, '2026-12-31')
    assert.equal(input.required, true)
  })

  test('forwards its ref and spreads the rest onto the input', () => {
    const ref = createRef<HTMLInputElement>()
    render(<DateField ref={ref} label="From" value="" onChange={() => {}} data-testid="from" disabled />)
    const input = screen.getByTestId('from') as HTMLInputElement
    assert.equal(ref.current, input)
    assert.equal(input.disabled, true)
  })

  test('the calendar button opens a themed calendar on the value, and a pick gives the page the day string', async () => {
    const seen: string[] = []
    render(<DateField label="From" value="2026-10-17" onChange={(v) => seen.push(v)} />)
    const button = screen.getByRole('button', { name: 'Choose date' })
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog')
    assert.equal(button.getAttribute('aria-expanded'), 'false')

    fireEvent.click(button)
    const calendar = await screen.findByRole('dialog', { name: 'Choose a date' })
    assert.equal(button.getAttribute('aria-expanded'), 'true')
    assert.ok(within(calendar).getByRole('group', { name: 'October 2026' }))
    assert.ok(within(calendar).getByText('Dates in IST'))
    await waitFor(() => assert.equal((document.activeElement as HTMLElement).dataset.day, '2026-10-17'))

    fireEvent.click(within(calendar).getByRole('button', { name: /^20 October 2026/ }))
    assert.deepEqual(seen, ['2026-10-20'])
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.equal(document.activeElement, button))
  })

  test('typing still goes through the native input, which keeps its type and value', () => {
    const seen: string[] = []
    render(<DateField label="From" value="2026-10-17" onChange={(v) => seen.push(v)} />)
    const input = screen.getByLabelText('From') as HTMLInputElement
    assert.equal(input.type, 'date')
    fireEvent.change(input, { target: { value: '2026-11-02' } })
    assert.deepEqual(seen, ['2026-11-02'])
    assert.equal(screen.queryByRole('dialog'), null, 'typing does not open the calendar')
  })

  test("the calendar keeps to the field's min and max", async () => {
    render(<DateField label="From" value="2026-10-17" min="2026-10-10" max="2026-10-20" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }))
    const calendar = await screen.findByRole('dialog', { name: 'Choose a date' })
    const named = (name: string) =>
      within(calendar).getByRole('button', { name: new RegExp(`^${name}(, today)?$`) }) as HTMLButtonElement
    assert.equal(named('9 October 2026').disabled, true)
    assert.equal(named('10 October 2026').disabled, false)
    assert.equal(named('20 October 2026').disabled, false)
    assert.equal(named('21 October 2026').disabled, true)
  })

  test('a disabled or read-only field never opens its calendar', () => {
    const { rerender } = render(<DateField label="From" value="2026-10-17" onChange={() => {}} disabled />)
    const button = screen.getByRole('button', { name: 'Choose date' }) as HTMLButtonElement
    assert.equal(button.disabled, true)
    fireEvent.click(button)
    assert.equal(screen.queryByRole('dialog'), null)

    rerender(<DateField label="From" value="2026-10-17" onChange={() => {}} readOnly />)
    assert.equal((screen.getByLabelText('From') as HTMLInputElement).readOnly, true)
    assert.equal(button.disabled, true)
    fireEvent.click(button)
    assert.equal(screen.queryByRole('dialog'), null)
  })
})
