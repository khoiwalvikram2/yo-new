import assert from 'node:assert/strict'
import { createRef, useState, type ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { TextField } from './TextField'

function ControlledTextField(props: Partial<ComponentProps<typeof TextField>>) {
  const [value, setValue] = useState(props.value ?? '')
  return <TextField label="Campaign name" {...props} value={value} onChange={setValue} />
}

describe('TextField', () => {
  test('is controlled, forwards the native input ref and retains native attributes', () => {
    const ref = createRef<HTMLInputElement>()
    const changed = vi.fn()
    render(
      <TextField
        ref={ref}
        label="Contact email"
        type="email"
        name="email"
        value="ops@example.test"
        onChange={changed}
        required
        autoComplete="email"
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Contact email' }) as HTMLInputElement
    assert.equal(ref.current, input)
    assert.equal(input.type, 'email')
    assert.equal(input.name, 'email')
    assert.equal(input.required, true)
    assert.equal(input.autocomplete, 'email')

    fireEvent.change(input, { target: { value: 'new@example.test' } })
    assert.deepEqual(changed.mock.calls, [['new@example.test']])
  })

  test('wires prefix, suffix, help, error and count through FieldShell', () => {
    render(
      <TextField
        label="Referral URL"
        value="offer"
        onChange={() => undefined}
        prefix="https://"
        suffix=".example.test"
        help="Use a unique slug"
        error="That slug is taken"
        maxLength={20}
        showCount
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Referral URL' })
    const ids = input.getAttribute('aria-describedby')?.split(' ') ?? []
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    assert.equal(ids.length, 3)
    assert.equal(document.getElementById(ids[0])?.textContent, 'Use a unique slug')
    assert.equal(document.getElementById(ids[1])?.textContent, 'That slug is taken')
    assert.equal(document.getElementById(ids[2])?.textContent, '5 / 20')
    assert.match(input.parentElement?.textContent ?? '', /https:\/\//)
    assert.match(input.parentElement?.textContent ?? '', /.example.test/)
  })

  test('clears a value and returns focus to the input', () => {
    render(<ControlledTextField value="Welcome bonus" clearable />)
    const input = screen.getByRole('textbox', { name: 'Campaign name' }) as HTMLInputElement

    fireEvent.click(screen.getByRole('button', { name: 'Clear Campaign name' }))

    assert.equal(input.value, '')
    assert.equal(document.activeElement, input)
    assert.equal(screen.queryByRole('button', { name: 'Clear Campaign name' }), null)
  })

  test('does not offer clear for disabled or read-only fields', () => {
    const { rerender } = render(
      <TextField label="Immutable" value="Fixed" onChange={() => undefined} clearable readOnly />,
    )
    assert.equal(screen.queryByRole('button', { name: 'Clear Immutable' }), null)

    rerender(<TextField label="Immutable" value="Fixed" onChange={() => undefined} clearable disabled />)
    assert.equal(screen.queryByRole('button', { name: 'Clear Immutable' }), null)
  })

  test('announces its count only near the limit and preserves explicit aria-invalid', () => {
    const { rerender } = render(
      <TextField label="Code" value="1234" onChange={() => undefined} maxLength={20} showCount />,
    )
    assert.equal(screen.getByRole('status').textContent, '')

    rerender(
      <TextField
        label="Code"
        value="123456789012345"
        onChange={() => undefined}
        maxLength={20}
        showCount
        status="error"
        aria-invalid="spelling"
      />,
    )
    assert.equal(screen.getByRole('status').textContent, '15 / 20')
    assert.equal(screen.getByRole('textbox', { name: 'Code' }).getAttribute('aria-invalid'), 'true')
  })

  test('treats an empty error as present and preserves caller aria-required otherwise', () => {
    const { rerender } = render(
      <TextField
        label="Code"
        value=""
        onChange={() => undefined}
        error=""
        aria-invalid={false}
      />,
    )
    assert.equal(screen.getByRole('textbox', { name: 'Code' }).getAttribute('aria-invalid'), 'true')

    rerender(
      <TextField label="Code" value="" onChange={() => undefined} aria-required="true" />,
    )
    assert.equal(screen.getByRole('textbox', { name: 'Code' }).getAttribute('aria-required'), 'true')
  })
})
