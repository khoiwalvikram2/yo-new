import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CheckboxGroup } from './CheckboxGroup'
import styles from './RadioGroup.module.css'

afterEach(cleanup)

const options = [
  { value: 'sports', label: 'Sports' },
  { value: 'casino', label: 'Casino', description: 'Includes live casino.' },
  { value: 'matka', label: 'Matka' },
] as const

describe('CheckboxGroup', () => {
  test('uses a fieldset, legend and controlled native checkboxes', () => {
    render(
      <CheckboxGroup label="Domains" name="domains" options={options} value={['sports']} onChange={() => {}} />,
    )

    const group = screen.getByRole('group', { name: 'Domains' })
    const sports = screen.getByRole('checkbox', { name: 'Sports' }) as HTMLInputElement
    const casino = screen.getByRole('checkbox', { name: 'Casino' }) as HTMLInputElement
    assert.equal(group.tagName, 'FIELDSET')
    assert.equal(sports.type, 'checkbox')
    assert.equal(sports.name, 'domains')
    assert.equal(casino.name, 'domains')
    assert.equal(sports.checked, true)
    assert.equal(casino.checked, false)
  })

  test('adds and removes values in option order without mutating caller state', () => {
    const initial = ['matka']
    const changes: string[][] = []
    const { rerender } = render(
      <CheckboxGroup label="Domains" options={options} value={initial} onChange={(next) => changes.push(next)} />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sports' }))
    assert.deepEqual(changes, [['sports', 'matka']])
    assert.deepEqual(initial, ['matka'])
    assert.equal((screen.getByRole('checkbox', { name: 'Sports' }) as HTMLInputElement).checked, false)

    rerender(
      <CheckboxGroup
        label="Domains"
        options={options}
        value={['sports', 'matka']}
        onChange={(next) => changes.push(next)}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Matka' }))
    assert.deepEqual(changes.at(-1), ['sports'])
  })

  test('honours per-option and whole-group disabled states', () => {
    const changes: string[][] = []
    const disabledOptions = [options[0], { ...options[1], disabled: true }, options[2]]
    const { rerender } = render(
      <CheckboxGroup
        label="Domains"
        options={disabledOptions}
        value={[]}
        onChange={(next) => changes.push(next)}
      />,
    )

    const casino = screen.getByRole('checkbox', { name: 'Casino' }) as HTMLInputElement
    assert.equal(casino.disabled, true)
    fireEvent.click(casino)
    assert.equal(changes.length, 0)

    rerender(
      <CheckboxGroup disabled label="Domains" options={options} value={[]} onChange={(next) => changes.push(next)} />,
    )
    assert.equal(
      (screen.getAllByRole('checkbox') as HTMLInputElement[]).every((checkbox) => checkbox.disabled),
      true,
    )
  })

  test('links help and error to the group and retains a hidden accessible legend', () => {
    const { container } = render(
      <CheckboxGroup
        label="Eligible domains"
        hideLabel
        required
        orientation="horizontal"
        options={options}
        value={[]}
        onChange={() => {}}
        help="Select at least one."
        error="A domain is required"
      />,
    )

    const group = screen.getByRole('group', { name: 'Eligible domains, required' })
    assert.equal(group.hasAttribute('aria-required'), false)
    assert.equal(group.hasAttribute('aria-invalid'), false)
    for (const id of (group.getAttribute('aria-describedby') ?? '').split(' ')) {
      assert.ok(document.getElementById(id), `missing description ${id}`)
    }
    assert.ok(group.querySelector('legend')?.classList.contains(styles.visuallyHidden))
    assert.equal(container.querySelector(`.${styles.options}`)?.classList.contains(styles.vertical), false)
    const alert = screen.getByRole('alert')
    const sports = screen.getByRole('checkbox', { name: 'Sports' })
    assert.equal(sports.getAttribute('aria-invalid'), 'true')
    assert.equal(sports.getAttribute('aria-errormessage'), alert.id)
  })

  test('treats an explicitly supplied empty error node as an invalid state', () => {
    render(<CheckboxGroup label="Domains" options={options} value={[]} onChange={() => {}} error="" />)
    const group = screen.getByRole('group', { name: 'Domains' })
    assert.equal(group.hasAttribute('aria-invalid'), false)
    const errorId = group.getAttribute('aria-describedby')
    assert.ok(errorId)
    assert.ok(document.getElementById(errorId))
    assert.equal(screen.getByRole('checkbox', { name: 'Sports' }).getAttribute('aria-invalid'), 'true')
    assert.ok(screen.getByRole('alert'))
  })
})
