import assert from 'node:assert/strict'
import { createRef, useState, type ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { NumberField } from './NumberField'

function ControlledNumberField(props: Partial<ComponentProps<typeof NumberField>>) {
  const [value, setValue] = useState<number | null>(props.value ?? null)
  return <NumberField label="Amount" {...props} value={value} onChange={setValue} />
}

describe('NumberField', () => {
  test('is a nullable controlled decimal textbox and forwards its native ref', () => {
    const ref = createRef<HTMLInputElement>()
    const changed = vi.fn()
    render(
      <NumberField ref={ref} label="Amount" name="amount" value={null} onChange={changed} required />,
    )

    const input = screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement
    assert.equal(ref.current, input)
    assert.equal(input.type, 'text')
    assert.equal(input.inputMode, 'decimal')
    assert.equal(input.name, 'amount')
    assert.equal(input.value, '')
    assert.equal(input.required, true)
    assert.equal(input.hasAttribute('aria-valuemin'), false)
    assert.equal(input.hasAttribute('aria-valuemax'), false)

    fireEvent.change(input, { target: { value: '12.5' } })
    fireEvent.change(input, { target: { value: '' } })
    assert.deepEqual(changed.mock.calls, [[12.5]])
  })

  test('formats with the requested locale only while blurred', () => {
    render(<ControlledNumberField value={1234567.5} grouping="en-IN" precision={2} />)
    const input = screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement

    assert.equal(input.value, '12,34,567.50')
    fireEvent.focus(input)
    assert.equal(input.value, '1234567.50')
    fireEvent.blur(input)
    assert.equal(input.value, '12,34,567.50')
  })

  test('keeps transient signs, decimals and trailing decimal text without corrupting the numeric value', () => {
    const changed = vi.fn()
    const { rerender } = render(<NumberField label="Amount" value={8} onChange={changed} />)
    const input = screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement
    fireEvent.focus(input)

    fireEvent.change(input, { target: { value: '-' } })
    assert.equal(input.value, '-')
    assert.equal(changed.mock.calls.length, 0)

    fireEvent.change(input, { target: { value: '-.' } })
    assert.equal(input.value, '-.')
    assert.equal(changed.mock.calls.length, 0)

    fireEvent.change(input, { target: { value: '1.' } })
    assert.equal(input.value, '1.')
    assert.deepEqual(changed.mock.calls, [[1]])

    rerender(<NumberField label="Amount" value={1} onChange={changed} />)
    assert.equal(input.value, '1.')

    fireEvent.change(input, { target: { value: '1.2.3' } })
    assert.equal(input.value, '1.')
  })

  test('reverts an unfinished transient on blur and accepts an external parent update while focused', () => {
    const changed = vi.fn()
    const { rerender } = render(<NumberField label="Amount" value={20} onChange={changed} precision={1} />)
    const input = screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '-' } })
    fireEvent.blur(input)
    assert.equal(input.value, '20.0')
    assert.equal(changed.mock.calls.length, 0)

    fireEvent.focus(input)
    rerender(<NumberField label="Amount" value={42} onChange={changed} precision={1} />)
    assert.equal(input.value, '42.0')
  })

  test('rounds and clamps on blur, states its range in help and announces the adjustment', () => {
    render(
      <ControlledNumberField
        value={5}
        min={0}
        max={10}
        precision={2}
        grouping="en-US"
        help="Before tax."
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement

    assert.match(screen.getByText(/Before tax/).textContent ?? '', /Allowed range: 0.00 to 10.00/)
    assert.ok(input.getAttribute('aria-describedby'))
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '12.345' } })
    fireEvent.blur(input)

    assert.equal(input.value, '10.00')
    assert.equal(screen.getByRole('status').textContent, 'Value adjusted to 10.00.')
  })

  test('does not round a safe large integer when precision is unspecified', () => {
    const changed = vi.fn()
    render(
      <NumberField
        label="Reference amount"
        value={1_234_567_890_123_456}
        onChange={changed}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Reference amount' }) as HTMLInputElement

    fireEvent.focus(input)
    fireEvent.blur(input)

    assert.equal(input.value, '1234567890123456')
    assert.equal(changed.mock.calls.length, 0)
  })

  test('steps with Arrow keys, applies Shift x10 and clamps at the boundary', () => {
    render(<ControlledNumberField value={9} min={0} max={10} step={0.2} precision={1} />)
    const input = screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement
    fireEvent.focus(input)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    assert.equal(input.value, '9.2')
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true })
    assert.equal(input.value, '10.0')
    assert.equal(screen.getByRole('status').textContent, 'Value adjusted to 10.0.')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    assert.equal(input.value, '9.8')
  })

  test('renders prefix, suffix and optional accessible stepper controls', () => {
    render(
      <ControlledNumberField value={10} min={0} max={10} prefix="₹" suffix="INR" stepper />,
    )
    const input = screen.getByRole('textbox', { name: 'Amount' })
    assert.match(input.parentElement?.textContent ?? '', /₹/)
    assert.match(input.parentElement?.textContent ?? '', /INR/)
    assert.equal((screen.getByRole('button', { name: 'Increase Amount' }) as HTMLButtonElement).disabled, true)
    assert.equal((screen.getByRole('button', { name: 'Decrease Amount' }) as HTMLButtonElement).disabled, false)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Amount' }))
    assert.equal((input as HTMLInputElement).value, '9')
  })

  test('an error wins over caller aria-invalid and caller aria-required is otherwise preserved', () => {
    render(
      <NumberField
        label="Amount"
        value={2}
        onChange={() => undefined}
        error=""
        aria-invalid={false}
        aria-required="true"
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Amount' })
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    assert.equal(input.getAttribute('aria-required'), 'true')
  })
})
