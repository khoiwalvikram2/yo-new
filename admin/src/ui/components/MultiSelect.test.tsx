/**
 * MultiSelect: Combobox's input and list with aria-multiselectable, toggling options, removable chips
 * (Backspace and "Remove <label>" buttons), the "+N" summary, controlled and uncontrolled values,
 * disabled and FieldShell wiring. DOM nodes are compared with assert.ok(a === b) (see Combobox.test.tsx).
 */
import assert from 'node:assert/strict'
import { createRef, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { MultiSelect, type MultiSelectProps } from './MultiSelect'
import type { ListboxOption } from './useListbox'

const STATUSES: ListboxOption[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected', disabled: true },
  { value: 'paid', label: 'Paid' },
]

function Controlled({
  initial = [],
  onChange,
  ...props
}: Partial<MultiSelectProps> & { initial?: string[] }) {
  const [values, setValues] = useState<string[]>(initial)
  return (
    <MultiSelect
      label="Status"
      options={STATUSES}
      {...props}
      value={values}
      onChange={(next, options) => {
        setValues(next)
        onChange?.(next, options)
      }}
    />
  )
}

const input = (name = 'Status') => screen.getByRole('combobox', { name }) as HTMLInputElement
const activeLabel = () => {
  const id = input().getAttribute('aria-activedescendant')
  const node = id ? document.getElementById(id) : null
  return node?.querySelector('span:not([aria-hidden])')?.textContent ?? null
}
const chipLabels = () =>
  screen.queryAllByRole('button', { name: /^Remove / }).map((button) => button.getAttribute('aria-label'))

async function openWithArrow() {
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  return screen.findByRole('listbox')
}

describe('MultiSelect', () => {
  test('a combobox input over a multi-selectable listbox whose options carry aria-selected', async () => {
    render(<Controlled initial={['approved']} />)
    const field = input()
    assert.equal(field.getAttribute('aria-expanded'), 'false')
    assert.equal(field.getAttribute('aria-haspopup'), 'listbox')

    const listbox = await openWithArrow()
    assert.equal(field.getAttribute('aria-expanded'), 'true')
    assert.equal(field.getAttribute('aria-controls'), listbox.id)
    assert.equal(listbox.getAttribute('aria-multiselectable'), 'true')
    assert.equal(listbox.getAttribute('aria-label'), 'Status')
    const selected = screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected'))
    assert.deepEqual(selected, ['false', 'true', 'false', 'false'])
    await waitFor(() => assert.equal(activeLabel(), 'Pending'))
  })

  test('Enter toggles the active option and keeps the list open', async () => {
    const changed = vi.fn()
    render(<Controlled onChange={changed} />)
    await openWithArrow()
    await waitFor(() => assert.equal(activeLabel(), 'Pending'))

    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' }) // skips the disabled Rejected
    assert.equal(activeLabel(), 'Paid')
    fireEvent.keyDown(input(), { key: 'Enter' })

    assert.equal(input().getAttribute('aria-expanded'), 'true')
    assert.deepEqual(changed.mock.calls.at(-1), [['pending', 'paid'], [STATUSES[0], STATUSES[3]]])
    assert.deepEqual(chipLabels(), ['Remove Pending', 'Remove Paid'])
    assert.equal(screen.getByRole('status').textContent, 'Added Paid')

    fireEvent.keyDown(input(), { key: 'Enter' })
    assert.deepEqual(changed.mock.calls.at(-1)?.[0], ['pending'])
    assert.equal(screen.getByRole('status').textContent, 'Removed Paid')
  })

  test('clicking options toggles them, keeps focus in the input and never chooses a disabled one', async () => {
    const changed = vi.fn()
    render(<Controlled onChange={changed} />)
    const field = input()
    field.focus()
    fireEvent.click(field, { detail: 1 })
    await screen.findByRole('listbox')

    const options = screen.getAllByRole('option')
    assert.equal(fireEvent.mouseDown(options[1]), false)
    fireEvent.click(options[1])
    fireEvent.click(options[2])
    assert.deepEqual(changed.mock.calls.map(([values]) => values), [['approved']])
    assert.ok(document.activeElement === field)
    assert.equal(field.getAttribute('aria-expanded'), 'true')
  })

  test('each chip has a labelled remove button that removes it and returns focus to the input', () => {
    const changed = vi.fn()
    render(<Controlled initial={['pending', 'paid']} onChange={changed} />)
    assert.deepEqual(chipLabels(), ['Remove Pending', 'Remove Paid'])

    const remove = screen.getByRole('button', { name: 'Remove Pending' })
    assert.equal(remove.getAttribute('type'), 'button')
    fireEvent.click(remove)
    assert.deepEqual(changed.mock.calls, [[['paid'], [STATUSES[3]]]])
    assert.deepEqual(chipLabels(), ['Remove Paid'])
    assert.ok(document.activeElement === input())
    assert.equal(screen.getByRole('status').textContent, 'Removed Pending')
  })

  test('Backspace in an empty input removes the last chip, but not while there is text', () => {
    const changed = vi.fn()
    render(<Controlled initial={['pending', 'approved']} onChange={changed} />)
    fireEvent.change(input(), { target: { value: 'pa' } })
    fireEvent.keyDown(input(), { key: 'Backspace' })
    assert.equal(changed.mock.calls.length, 0)

    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.keyDown(input(), { key: 'Backspace' })
    assert.deepEqual(changed.mock.calls, [[['pending'], [STATUSES[0]]]])
    fireEvent.keyDown(input(), { key: 'Backspace' })
    assert.deepEqual(changed.mock.calls.at(-1)?.[0], [])
    assert.deepEqual(chipLabels(), [])
  })

  test('maxTagCount shows that many chips and a "+N" summary for the rest', () => {
    render(<Controlled initial={['pending', 'approved', 'paid']} maxTagCount={1} />)
    assert.deepEqual(chipLabels(), ['Remove Pending'])
    const summary = screen.getByText('+2', { exact: false })
    assert.equal(summary.textContent, '+2 more selected')
    assert.equal(summary.getAttribute('title'), 'Approved, Paid')
  })

  test('the chosen values are the input description, alongside help and error', () => {
    render(
      <Controlled
        initial={['pending', 'paid']}
        help="Filter by request status."
        error="Pick at most two"
        required
      />,
    )
    const field = screen.getByRole('combobox', { name: /Status/ })
    const ids = (field.getAttribute('aria-describedby') ?? '').split(' ')
    const texts = ids.map((id) => document.getElementById(id)?.textContent)
    assert.deepEqual(texts, ['2 selected: Pending, Paid', 'Filter by request status.', 'Pick at most two'])
    assert.equal(field.getAttribute('aria-invalid'), 'true')
    assert.equal(field.getAttribute('aria-required'), 'true')
    assert.equal(screen.getByRole('alert').textContent, 'Pick at most two')
  })

  test('typing filters; a choice clears the search and reports it ended', async () => {
    const typed = vi.fn()
    const changed = vi.fn()
    render(<Controlled onInputChange={typed} onChange={changed} />)
    fireEvent.change(input(), { target: { value: 'P' } })
    await screen.findByRole('listbox')
    const labels = () => screen.getAllByRole('option').map((o) => o.querySelector('span:not([aria-hidden])')?.textContent)
    assert.deepEqual(labels(), ['Pending', 'Approved', 'Paid'])

    fireEvent.change(input(), { target: { value: 'pa' } })
    assert.deepEqual(labels(), ['Paid'])
    assert.equal(activeLabel(), 'Paid')
    fireEvent.keyDown(input(), { key: 'Enter' })

    assert.deepEqual(changed.mock.calls.at(-1)?.[0], ['paid'])
    assert.equal(input().value, '')
    assert.deepEqual(typed.mock.calls, [['P'], ['pa'], ['']])
    assert.equal(screen.getAllByRole('option').length, 4)
    assert.equal(activeLabel(), 'Paid', 'the active option follows the choice into the full list')
  })

  test('Escape, Alt+ArrowUp and Tab close the list; Tab toggles nothing and is not prevented', async () => {
    const changed = vi.fn()
    render(<Controlled onChange={changed} />)
    await openWithArrow()
    fireEvent.keyDown(input(), { key: 'Escape' })
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    await openWithArrow()
    fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true })
    assert.equal(input().getAttribute('aria-expanded'), 'false')

    await openWithArrow()
    await waitFor(() => assert.equal(activeLabel(), 'Pending'))
    assert.equal(fireEvent.keyDown(input(), { key: 'Tab' }), true)
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(changed.mock.calls.length, 0)
  })

  test('autoHighlight={false}: typing makes no option active, so Enter toggles nothing', async () => {
    const changed = vi.fn()
    render(<Controlled autoHighlight={false} onChange={changed} />)
    fireEvent.change(input(), { target: { value: 'pa' } })
    await screen.findByRole('listbox')
    assert.equal(input().getAttribute('aria-activedescendant'), null)
    fireEvent.keyDown(input(), { key: 'Enter' })
    assert.equal(changed.mock.calls.length, 0)
  })

  test('controlled: chips follow the value prop only', async () => {
    const changed = vi.fn()
    const { rerender } = render(<MultiSelect label="Status" options={STATUSES} value={[]} onChange={changed} />)
    await openWithArrow()
    fireEvent.click(screen.getAllByRole('option')[0])
    assert.deepEqual(changed.mock.calls, [[['pending'], [STATUSES[0]]]])
    assert.deepEqual(chipLabels(), [])

    rerender(<MultiSelect label="Status" options={STATUSES} value={['pending']} onChange={changed} />)
    assert.deepEqual(chipLabels(), ['Remove Pending'])
  })

  test('uncontrolled: starts from defaultValue and keeps its own values', async () => {
    const changed = vi.fn()
    render(<MultiSelect label="Status" options={STATUSES} defaultValue={['paid']} onChange={changed} />)
    assert.deepEqual(chipLabels(), ['Remove Paid'])
    await openWithArrow()
    fireEvent.click(screen.getAllByRole('option')[1])
    assert.deepEqual(chipLabels(), ['Remove Paid', 'Remove Approved'])
    assert.deepEqual(changed.mock.calls, [[['paid', 'approved'], [STATUSES[3], STATUSES[1]]]])
  })

  test('clearable removes every value and returns focus', () => {
    const changed = vi.fn()
    render(<Controlled initial={['pending', 'paid']} clearable onChange={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear Status' }))
    assert.deepEqual(changed.mock.calls, [[[], []]])
    assert.deepEqual(chipLabels(), [])
    assert.ok(document.activeElement === input())
  })

  test('disabled: chips without remove buttons, no list, no clear button', () => {
    render(<Controlled initial={['pending']} clearable disabled />)
    const field = input()
    assert.equal(field.disabled, true)
    assert.ok(screen.getByText('Pending'))
    assert.deepEqual(chipLabels(), [])
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    assert.equal(screen.queryByRole('listbox'), null)
    assert.equal(screen.queryByRole('button', { name: 'Clear Status' }), null)
  })

  test('a chosen option keeps its chip label after a server search drops it', async () => {
    function ServerSearch() {
      const [query, setQuery] = useState('')
      const [values, setValues] = useState<string[]>([])
      const options = query === 'ch' ? [{ value: 'u7', label: 'Charlie' }] : [{ value: 'u1', label: 'Alpha' }]
      return (
        <MultiSelect
          label="Players"
          options={options}
          filter={false}
          value={values}
          onChange={setValues}
          onInputChange={setQuery}
        />
      )
    }
    render(<ServerSearch />)
    fireEvent.change(input('Players'), { target: { value: 'ch' } })
    await screen.findByRole('listbox')
    fireEvent.keyDown(input('Players'), { key: 'Enter' })
    assert.deepEqual(chipLabels(), ['Remove Charlie'])
  })

  test('name posts one hidden input per value and the ref reaches the input', () => {
    const ref = createRef<HTMLInputElement>()
    const { container } = render(
      <MultiSelect ref={ref} label="Status" options={STATUSES} value={['pending', 'paid']} name="status" />,
    )
    const posted = [...container.querySelectorAll('input[type="hidden"][name="status"]')].map(
      (node) => (node as HTMLInputElement).value,
    )
    assert.deepEqual(posted, ['pending', 'paid'])
    assert.ok(ref.current === input())
  })

  test('select-only mode: read-only input and typeahead', async () => {
    render(<Controlled searchable={false} />)
    const field = input()
    assert.equal(field.readOnly, true)
    assert.equal(field.getAttribute('aria-autocomplete'), 'none')
    fireEvent.keyDown(field, { key: 'p' })
    await screen.findByRole('listbox')
    await waitFor(() => assert.equal(activeLabel(), 'Pending'))
  })
})
