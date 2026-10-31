import { createRef } from 'react'
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Checkbox } from './Checkbox'
import styles from './Checkbox.module.css'

describe('Checkbox', () => {
  test('is a controlled native checkbox named by its visible label', () => {
    const changes: boolean[] = []
    const { rerender } = render(
      <Checkbox checked={false} onChange={(checked) => changes.push(checked)} label="Select settlement" />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Select settlement' }) as HTMLInputElement
    assert.equal(checkbox.tagName, 'INPUT')
    assert.equal(checkbox.type, 'checkbox')
    assert.equal(checkbox.checked, false)

    fireEvent.click(checkbox)
    assert.deepEqual(changes, [true])

    rerender(<Checkbox checked onChange={(checked) => changes.push(checked)} label="Select settlement" />)
    assert.equal(checkbox.checked, true)
    fireEvent.click(checkbox)
    assert.deepEqual(changes, [true, false])
  })

  test('sets and clears the native indeterminate DOM property', () => {
    const { rerender } = render(
      <Checkbox checked={false} indeterminate onChange={() => {}} label="Select all on this page" />,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Select all on this page' }) as HTMLInputElement

    assert.equal(checkbox.indeterminate, true)
    assert.equal(checkbox.checked, false)

    rerender(<Checkbox checked={false} indeterminate={false} onChange={() => {}} label="Select all on this page" />)
    assert.equal(checkbox.indeterminate, false)
  })

  test('hideLabel keeps a real label and an accessible name without visible copy', () => {
    const { container } = render(
      <Checkbox checked={false} hideLabel onChange={() => {}} label="Select request DR-78421" />,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Select request DR-78421' }) as HTMLInputElement
    const label = screen.getByText('Select request DR-78421')
    const root = container.firstElementChild
    assert.ok(root)
    assert.equal(label.tagName, 'LABEL')
    assert.equal(label.getAttribute('for'), checkbox.id)
    assert.ok(label.classList.contains(styles.visuallyHidden))
  })

  test('links optional descriptive copy to the native input', () => {
    render(
      <Checkbox
        checked
        onChange={() => {}}
        label="Include archived agents"
        description="Archived accounts will appear in exported results."
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Include archived agents' })
    const description = screen.getByText('Archived accounts will appear in exported results.')
    assert.ok(description.id)
    assert.equal(checkbox.getAttribute('aria-describedby'), description.id)
  })

  test('disabled state is native and cannot call onChange', () => {
    const changes: boolean[] = []
    render(<Checkbox checked={false} disabled onChange={(checked) => changes.push(checked)} label="Locked choice" />)
    const checkbox = screen.getByRole('checkbox', { name: 'Locked choice' }) as HTMLInputElement
    assert.equal(checkbox.disabled, true)
    fireEvent.click(checkbox)
    assert.deepEqual(changes, [])
  })

  test('forwards its input ref and native attributes while className stays on the root', () => {
    const ref = createRef<HTMLInputElement>()
    const { container } = render(
      <Checkbox
        ref={ref}
        id="request-choice"
        name="requests"
        value="DR-1"
        title="Choose request"
        className="selection-control"
        checked={false}
        onChange={() => {}}
        label="Select DR-1"
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Select DR-1' }) as HTMLInputElement
    const root = container.firstElementChild
    assert.equal(ref.current, checkbox)
    assert.equal(checkbox.id, 'request-choice')
    assert.equal(checkbox.name, 'requests')
    assert.equal(checkbox.value, 'DR-1')
    assert.equal(checkbox.title, 'Choose request')
    assert.equal(checkbox.classList.contains('selection-control'), false)
    assert.ok(root?.classList.contains('selection-control'))
  })
})
