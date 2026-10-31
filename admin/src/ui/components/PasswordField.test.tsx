import assert from 'node:assert/strict'
import { createRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { PasswordField } from './PasswordField'

function ControlledPassword({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <PasswordField label="Password" autoComplete="new-password" value={value} onChange={setValue} />
}

const passwordInput = () => screen.getByLabelText('Password') as HTMLInputElement
const toggleButton = () => screen.getByRole('button', { name: 'Show password' })

describe('PasswordField', () => {
  test('is a labelled native password input that forwards its ref and native attributes', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <PasswordField
        ref={ref}
        label="Password"
        autoComplete="current-password"
        name="password"
        value=""
        onChange={() => undefined}
        maxLength={64}
        data-testid="secret"
      />,
    )
    const input = passwordInput()
    assert.ok(ref.current === input)
    assert.equal(input.type, 'password')
    assert.equal(input.name, 'password')
    assert.equal(input.autocomplete, 'current-password')
    assert.equal(input.maxLength, 64)
    assert.equal(input.getAttribute('spellcheck'), 'false')
    assert.equal(input.getAttribute('autocapitalize'), 'off')
    assert.equal(input.dataset.testid, 'secret')
  })

  test('controlled: emits the typed string and renders the value it is given', () => {
    const changed = vi.fn()
    const { rerender } = render(
      <PasswordField label="Password" autoComplete="new-password" value="" onChange={changed} />,
    )
    fireEvent.change(passwordInput(), { target: { value: 'hunter2' } })
    assert.deepEqual(changed.mock.calls, [['hunter2']])

    rerender(<PasswordField label="Password" autoComplete="new-password" value="hunter2" onChange={changed} />)
    assert.equal(passwordInput().value, 'hunter2')
  })

  test('controlled: a refused edit is put back, and the value never reaches the markup', async () => {
    render(<PasswordField label="Password" autoComplete="new-password" value="kept" onChange={() => undefined} />)
    const input = passwordInput()
    assert.equal(input.value, 'kept')
    assert.equal(input.getAttribute('value'), null)

    fireEvent.change(input, { target: { value: 'kept!' } })
    await Promise.resolve()
    assert.equal(input.value, 'kept')

    render(<ControlledPassword />)
    const typed = screen.getAllByLabelText('Password')[1] as HTMLInputElement
    fireEvent.change(typed, { target: { value: 'abc' } })
    assert.equal(typed.value, 'abc')
    assert.equal(typed.getAttribute('value'), null)
  })

  test('uncontrolled: keeps the value in the DOM from defaultValue and still reports changes', () => {
    const changed = vi.fn()
    render(<PasswordField label="Password" autoComplete="new-password" defaultValue="abc" onChange={changed} />)
    const input = passwordInput()
    assert.equal(input.value, 'abc')
    fireEvent.change(input, { target: { value: 'abcd' } })
    assert.equal(input.value, 'abcd')
    assert.deepEqual(changed.mock.calls, [['abcd']])
  })

  test('the toggle is a pressed-state button that controls the input and flips its type', () => {
    render(<ControlledPassword initial="s3cret" />)
    const input = passwordInput()
    const toggle = toggleButton()

    assert.equal(toggle.getAttribute('type'), 'button')
    assert.equal(toggle.getAttribute('aria-pressed'), 'false')
    assert.equal(toggle.getAttribute('aria-controls'), input.id)
    assert.equal(toggle.hasAttribute('tabindex'), false)

    fireEvent.click(toggle)
    assert.equal(input.type, 'text')
    assert.equal(toggle.getAttribute('aria-pressed'), 'true')
    assert.equal(input.value, 's3cret')

    fireEvent.click(toggle)
    assert.equal(input.type, 'password')
    assert.equal(toggle.getAttribute('aria-pressed'), 'false')
  })

  test('a pointer press on the toggle keeps focus and the caret in the input', () => {
    render(<ControlledPassword initial="abcdef" />)
    const input = passwordInput()
    input.focus()
    input.setSelectionRange(2, 4)

    const toggle = toggleButton()
    const mouseDown = fireEvent.mouseDown(toggle)
    assert.equal(mouseDown, false, 'mousedown default is prevented so the button never takes focus')
    fireEvent.click(toggle)

    assert.ok(document.activeElement === input)
    assert.equal(input.type, 'text')
    assert.equal(input.selectionStart, 2)
    assert.equal(input.selectionEnd, 4)
  })

  test('keyboard activation leaves focus on the toggle the user is on', () => {
    render(<ControlledPassword initial="abc" />)
    const toggle = toggleButton()
    toggle.focus()
    fireEvent.click(toggle)
    assert.ok(document.activeElement === toggle)
    assert.equal(passwordInput().type, 'text')
  })

  test('hides a revealed password before its form submits', () => {
    const submitted: string[] = []
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submitted.push((event.currentTarget.elements.namedItem('pw') as HTMLInputElement).type)
        }}
      >
        <PasswordField label="Password" name="pw" autoComplete="new-password" defaultValue="abc" />
      </form>,
    )
    fireEvent.click(toggleButton())
    assert.equal(passwordInput().type, 'text')

    fireEvent.submit(passwordInput().form as HTMLFormElement)
    assert.deepEqual(submitted, ['password'])
    assert.equal(passwordInput().type, 'password')
    assert.equal(toggleButton().getAttribute('aria-pressed'), 'false')
  })

  test('disabled disables both the input and the toggle', () => {
    render(<PasswordField label="Password" autoComplete="off" value="x" onChange={() => undefined} disabled />)
    assert.equal(passwordInput().disabled, true)
    assert.equal((toggleButton() as HTMLButtonElement).disabled, true)
  })

  test('wires required, help and error through FieldShell', () => {
    render(
      <PasswordField
        label="New password"
        autoComplete="new-password"
        value=""
        onChange={() => undefined}
        required
        help="At least 8 characters."
        error="Password is too short"
        aria-invalid={false}
      />,
    )
    const input = screen.getByLabelText(/New password/) as HTMLInputElement
    assert.equal(input.required, true)
    assert.equal(input.getAttribute('aria-required'), 'true')
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    assert.equal(ids.length, 2)
    assert.equal(document.getElementById(ids[0])?.textContent, 'At least 8 characters.')
    assert.equal(document.getElementById(ids[1])?.textContent, 'Password is too short')
    assert.equal(screen.getByRole('alert').textContent, 'Password is too short')
  })

  test('keeps a hidden label for assistive tech', () => {
    render(<PasswordField label="Password" hideLabel autoComplete="off" value="" onChange={() => undefined} />)
    assert.equal(passwordInput().type, 'password')
  })

  test('never logs or stores the value', () => {
    const consoleSpies = (['log', 'info', 'debug', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
    window.sessionStorage.clear()
    render(<ControlledPassword />)
    fireEvent.change(passwordInput(), { target: { value: 'top-secret-value' } })
    fireEvent.click(toggleButton())
    fireEvent.click(toggleButton())

    for (const spy of consoleSpies) assert.equal(spy.mock.calls.length, 0)
    assert.equal(window.localStorage.length, 0)
    assert.equal(window.sessionStorage.length, 0)
    assert.ok(!document.body.innerHTML.includes('top-secret-value'), 'the value is never written to markup')
  })
})
