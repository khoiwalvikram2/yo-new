import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RadioGroup } from './RadioGroup'
import styles from './RadioGroup.module.css'

afterEach(cleanup)

describe('RadioGroup', () => {
  test('renders one controlled native radio group with a real legend', () => {
    render(
      <RadioGroup
        label="Amount type"
        name="amountType"
        value="fixed"
        onChange={() => {}}
        options={[
          { value: 'fixed', label: 'Fixed' },
          { value: 'percentage', label: 'Percentage' },
        ]}
      />,
    )

    const group = screen.getByRole('group', { name: 'Amount type' })
    const fixed = screen.getByRole('radio', { name: 'Fixed' }) as HTMLInputElement
    const percentage = screen.getByRole('radio', { name: 'Percentage' }) as HTMLInputElement
    assert.equal(group.tagName, 'FIELDSET')
    assert.equal(fixed.type, 'radio')
    assert.equal(fixed.name, 'amountType')
    assert.equal(percentage.name, 'amountType')
    assert.equal(fixed.checked, true)
    assert.equal(percentage.checked, false)
  })

  test('emits the typed option value and remains controlled', () => {
    const changes: string[] = []
    const { rerender } = render(
      <RadioGroup
        label="Release"
        value="bonus"
        onChange={(next) => changes.push(next)}
        options={[
          { value: 'bonus', label: 'Bonus only' },
          { value: 'wallet', label: 'Whole wallet' },
        ] as const}
      />,
    )

    const wallet = screen.getByRole('radio', { name: 'Whole wallet' }) as HTMLInputElement
    fireEvent.click(wallet)
    assert.deepEqual(changes, ['wallet'])
    assert.equal(wallet.checked, false, 'the caller still owns the controlled value')

    rerender(
      <RadioGroup
        label="Release"
        value="wallet"
        onChange={(next) => changes.push(next)}
        options={[
          { value: 'bonus', label: 'Bonus only' },
          { value: 'wallet', label: 'Whole wallet' },
        ] as const}
      />,
    )
    assert.equal(wallet.checked, true)
  })

  test('preserves boolean values needed by the Create Bonus form', () => {
    const changes: boolean[] = []
    render(
      <RadioGroup
        label="Deposit required"
        value={false}
        onChange={(next) => changes.push(next)}
        options={[
          { value: true, label: 'Yes' },
          { value: false, label: 'No' },
        ] as const}
      />,
    )

    assert.equal((screen.getByRole('radio', { name: 'No' }) as HTMLInputElement).checked, true)
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }))
    assert.deepEqual(changes, [true])
    assert.equal(typeof changes[0], 'boolean')
  })

  test('the segmented presentation keeps native radio semantics', () => {
    const { container } = render(
      <RadioGroup
        label="Status"
        variant="segmented"
        orientation="vertical"
        value="draft"
        onChange={() => {}}
        options={[
          { value: 'draft', label: 'Draft' },
          { value: 'active', label: 'Active' },
        ]}
      />,
    )

    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    assert.equal(radios.length, 2)
    assert.equal(radios.every((radio) => radio.type === 'radio'), true)
    const options = container.querySelector(`.${styles.options}`)
    assert.ok(options?.classList.contains(styles.segmented))
    assert.ok(options?.classList.contains(styles.vertical))
  })

  test('a disabled segmented option stays native-disabled and cannot emit a change', () => {
    const changes: string[] = []
    render(
      <RadioGroup
        label="Status"
        variant="segmented"
        value="draft"
        onChange={(next) => changes.push(next)}
        options={[
          { value: 'draft', label: 'Draft' },
          { value: 'active', label: 'Active', disabled: true },
        ]}
      />,
    )

    const active = screen.getByRole('radio', { name: 'Active' }) as HTMLInputElement
    assert.equal(active.disabled, true)
    assert.ok(active.classList.contains(styles.segmentedInput))
    fireEvent.click(screen.getByText('Active'))
    assert.deepEqual(changes, [])
  })

  test('links help, option descriptions and errors while exposing required state', () => {
    render(
      <RadioGroup
        label="Distribution"
        value={undefined}
        onChange={() => {}}
        required
        help="Choose how the bonus is released."
        error="Distribution is required"
        options={[
          { value: 'instant', label: 'Instant', description: 'Release immediately.' },
          { value: 'rollover', label: 'Rollover' },
        ]}
      />,
    )

    const group = screen.getByRole('group', { name: /Distribution/ })
    assert.equal(group.hasAttribute('aria-required'), false)
    assert.equal(group.hasAttribute('aria-invalid'), false)
    for (const id of (group.getAttribute('aria-describedby') ?? '').split(' ')) {
      assert.ok(document.getElementById(id), `missing group description ${id}`)
    }
    const instant = screen.getByRole('radio', { name: 'Instant' }) as HTMLInputElement
    assert.equal(instant.required, true)
    assert.equal(instant.getAttribute('aria-invalid'), 'true')
    const inputDescriptions = (instant.getAttribute('aria-describedby') ?? '').split(' ')
    assert.equal(inputDescriptions.length, 3)
    for (const id of inputDescriptions) assert.ok(document.getElementById(id), `missing input description ${id}`)
    assert.ok(screen.getByRole('alert'))
  })

  test('respects option and whole-group disabled states and can visually hide its legend', () => {
    const changes: string[] = []
    const { rerender } = render(
      <RadioGroup
        label="Private status"
        hideLabel
        value="draft"
        onChange={(next) => changes.push(next)}
        options={[
          { value: 'draft', label: 'Draft' },
          { value: 'active', label: 'Active', disabled: true },
        ]}
      />,
    )

    const group = screen.getByRole('group', { name: 'Private status' })
    assert.ok(group.querySelector('legend')?.classList.contains(styles.visuallyHidden))
    const active = screen.getByRole('radio', { name: 'Active' }) as HTMLInputElement
    assert.equal(active.disabled, true)
    fireEvent.click(active)
    assert.equal(changes.length, 0)

    rerender(
      <RadioGroup
        label="Private status"
        disabled
        value="draft"
        onChange={(next) => changes.push(next)}
        options={[
          { value: 'draft', label: 'Draft' },
          { value: 'active', label: 'Active' },
        ]}
      />,
    )
    assert.equal((screen.getByRole('radio', { name: 'Draft' }) as HTMLInputElement).disabled, true)
    assert.equal((screen.getByRole('radio', { name: 'Active' }) as HTMLInputElement).disabled, true)
  })

  test('treats an explicitly supplied empty error node as an invalid state', () => {
    render(
      <RadioGroup
        label="Status"
        error=""
        value="draft"
        onChange={() => {}}
        options={[{ value: 'draft', label: 'Draft' }]}
      />,
    )
    const group = screen.getByRole('group', { name: 'Status' })
    assert.equal(group.hasAttribute('aria-invalid'), false)
    const errorId = group.getAttribute('aria-describedby')
    assert.ok(errorId)
    assert.ok(document.getElementById(errorId))
    assert.equal(screen.getByRole('radio', { name: 'Draft' }).getAttribute('aria-invalid'), 'true')
    assert.ok(screen.getByRole('alert'))
  })
})
