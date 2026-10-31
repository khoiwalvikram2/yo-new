/**
 * Combobox: the WAI-ARIA combobox contract (input role=combobox with aria-expanded / aria-controls /
 * aria-activedescendant, a labelled role=listbox, options with aria-selected), the APG keyboard model,
 * controlled and uncontrolled value, server search, AutoComplete text, disabled and FieldShell wiring.
 *
 * DOM elements are compared with assert.ok(a === b), never assert.equal: a failing equal diffs two live
 * jsdom nodes, which is slow enough under waitFor to time a worker out (see Menu.test.tsx).
 */
import assert from 'node:assert/strict'
import { createRef, useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { Combobox, type ComboboxProps, type ListboxOption } from './Combobox'
import { filterOptions, matchesLabel } from './useListbox'

const FRUITS: ListboxOption[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana', description: 'Yellow' },
  { value: 'blueberry', label: 'Blueberry' },
  { value: 'cherry', label: 'Cherry', disabled: true },
  { value: 'date', label: 'Date' },
]

function Controlled({
  initial = null,
  onChange,
  ...props
}: Partial<ComboboxProps> & { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial)
  return (
    <Combobox
      label="Fruit"
      options={FRUITS}
      {...props}
      value={value}
      onChange={(next, option) => {
        setValue(next)
        onChange?.(next, option)
      }}
    />
  )
}

const input = (name = 'Fruit') => screen.getByRole('combobox', { name }) as HTMLInputElement
const activeLabel = (name = 'Fruit') => {
  const id = input(name).getAttribute('aria-activedescendant')
  const node = id ? document.getElementById(id) : null
  return node?.querySelector('span:not([aria-hidden])')?.textContent ?? null
}
const optionLabels = () =>
  screen.getAllByRole('option').map((option) => option.querySelector('span:not([aria-hidden])')?.textContent)

async function openWithArrow() {
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  return screen.findByRole('listbox')
}

describe('filterOptions', () => {
  test('matches labels case-insensitively anywhere, keeps all for null or false', () => {
    assert.deepEqual(
      filterOptions(FRUITS, 'BERRY', undefined).map((o) => o.value),
      ['blueberry'],
    )
    assert.deepEqual(filterOptions(FRUITS, '  an ', undefined).map((o) => o.value), ['banana'])
    assert.equal(filterOptions(FRUITS, null, undefined), FRUITS)
    assert.equal(filterOptions(FRUITS, 'zzz', false), FRUITS)
    assert.equal(matchesLabel({ value: 'x', label: 'Anything' }, ''), true)
  })
})

describe('Combobox', () => {
  test('closed: a labelled combobox input with no popup wiring yet', () => {
    render(<Controlled />)
    const field = input()
    assert.equal(field.tagName, 'INPUT')
    assert.equal(field.getAttribute('aria-expanded'), 'false')
    assert.equal(field.getAttribute('aria-haspopup'), 'listbox')
    assert.equal(field.getAttribute('aria-autocomplete'), 'list')
    assert.equal(field.getAttribute('aria-controls'), null)
    assert.equal(field.getAttribute('aria-activedescendant'), null)
    assert.equal(screen.queryByRole('listbox'), null)
  })

  test('ArrowDown opens a labelled listbox of options and makes the first one active', async () => {
    render(<Controlled />)
    const field = input()
    field.focus()
    const listbox = await openWithArrow()

    assert.equal(field.getAttribute('aria-expanded'), 'true')
    assert.equal(field.getAttribute('aria-controls'), listbox.id)
    assert.equal(listbox.getAttribute('aria-label'), 'Fruit')
    assert.equal(listbox.getAttribute('aria-multiselectable'), null)
    const options = screen.getAllByRole('option')
    assert.equal(options.length, 5)
    for (const option of options) assert.equal(option.getAttribute('aria-selected'), 'false')
    assert.equal(options[3].getAttribute('aria-disabled'), 'true')
    await waitFor(() => assert.equal(activeLabel(), 'Apple'))
    assert.ok(document.activeElement === field, 'DOM focus never leaves the input')
  })

  test('arrows move the active option, skip disabled ones and wrap', async () => {
    render(<Controlled />)
    await openWithArrow()
    await waitFor(() => assert.equal(activeLabel(), 'Apple'))

    const steps: Array<string | null> = []
    for (let i = 0; i < 4; i += 1) {
      fireEvent.keyDown(input(), { key: 'ArrowDown' })
      steps.push(activeLabel())
    }
    assert.deepEqual(steps, ['Banana', 'Blueberry', 'Date', 'Apple'])

    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    assert.equal(activeLabel(), 'Date')
  })

  test('ArrowUp on a closed field opens on the last option', async () => {
    render(<Controlled />)
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    await screen.findByRole('listbox')
    await waitFor(() => assert.equal(activeLabel(), 'Date'))
  })

  test('Enter chooses the active option, closes the list and shows its label', async () => {
    const changed = vi.fn()
    render(<Controlled onChange={changed} />)
    await openWithArrow()
    await waitFor(() => assert.equal(activeLabel(), 'Apple'))
    fireEvent.keyDown(input(), { key: 'ArrowDown' })

    const enter = fireEvent.keyDown(input(), { key: 'Enter' })
    assert.equal(enter, false, 'Enter on an open list never submits the form')
    assert.deepEqual(changed.mock.calls, [['banana', FRUITS[1]]])
    assert.equal(input().value, 'Banana')
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
  })

  test('opening with a value marks it selected and starts on it', async () => {
    render(<Controlled initial="blueberry" />)
    assert.equal(input().value, 'Blueberry')
    await openWithArrow()
    await waitFor(() => assert.equal(activeLabel(), 'Blueberry'))
    const selected = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')
    assert.equal(selected.length, 1)
    assert.match(selected[0].textContent ?? '', /Blueberry/)
  })

  test('Escape closes without choosing and does not reach an enclosing dialog; closed, it does', async () => {
    const changed = vi.fn()
    const documentKeys = vi.fn()
    document.addEventListener('keydown', documentKeys)
    try {
      render(<Controlled initial="apple" onChange={changed} />)
      await openWithArrow()
      fireEvent.change(input(), { target: { value: 'ban' } })
      fireEvent.keyDown(input(), { key: 'Escape' })

      assert.equal(input().getAttribute('aria-expanded'), 'false')
      assert.equal(input().value, 'Apple', 'the typed search is dropped, the chosen label returns')
      assert.equal(changed.mock.calls.length, 0)
      assert.equal(documentKeys.mock.calls.filter(([event]) => event.key === 'Escape').length, 0)

      fireEvent.keyDown(input(), { key: 'Escape' })
      assert.equal(documentKeys.mock.calls.filter(([event]) => event.key === 'Escape').length, 1)
    } finally {
      document.removeEventListener('keydown', documentKeys)
    }
  })

  test('Alt+ArrowUp closes without choosing; Tab takes the active option and lets focus move on', async () => {
    const changed = vi.fn()
    render(<Controlled onChange={changed} />)
    await openWithArrow()
    fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true })
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(changed.mock.calls.length, 0)

    // opened by the pointer with nothing chosen, no option is active: Tab only closes
    fireEvent.click(input(), { detail: 1 })
    await screen.findByRole('listbox')
    assert.equal(input().getAttribute('aria-activedescendant'), null)
    assert.equal(fireEvent.keyDown(input(), { key: 'Tab' }), true, 'Tab is never prevented')
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(changed.mock.calls.length, 0)

    // typing makes the first match active and Tab takes it (antd, APG select-only)
    fireEvent.change(input(), { target: { value: 'ban' } })
    await screen.findByRole('listbox')
    assert.equal(fireEvent.keyDown(input(), { key: 'Tab' }), true, 'Tab is never prevented')
    assert.deepEqual(changed.mock.calls, [['banana', FRUITS[1]]])
    assert.equal(input().value, 'Banana')
    assert.equal(input().getAttribute('aria-expanded'), 'false')
  })

  test('re-choosing the chosen option closes the list and calls onSelect, never onChange', async () => {
    const changed = vi.fn()
    const picked = vi.fn()
    render(<Controlled initial="banana" onChange={changed} onSelect={picked} />)

    // Enter right after opening: the list opens on the chosen option
    await openWithArrow()
    await waitFor(() => assert.equal(activeLabel(), 'Banana'))
    fireEvent.keyDown(input(), { key: 'Enter' })
    assert.equal(input().getAttribute('aria-expanded'), 'false')

    // a click on the ticked option
    fireEvent.click(input(), { detail: 1 })
    await screen.findByRole('listbox')
    fireEvent.click(screen.getAllByRole('option')[1])
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(changed.mock.calls.length, 0, 'no change, so no onChange (antd triggerChange)')
    assert.deepEqual(picked.mock.calls, [
      ['banana', FRUITS[1]],
      ['banana', FRUITS[1]],
    ])
    assert.equal(input().value, 'Banana')

    // another option is a change: both are called
    fireEvent.click(input(), { detail: 1 })
    await screen.findByRole('listbox')
    fireEvent.click(screen.getAllByRole('option')[0])
    assert.deepEqual(changed.mock.calls, [['apple', FRUITS[0]]])
    assert.deepEqual(picked.mock.calls.at(-1), ['apple', FRUITS[0]])
  })

  test('autoHighlight={false}: typing filters but makes no option active, so Enter chooses nothing', async () => {
    const changed = vi.fn()
    render(<Controlled autoHighlight={false} onChange={changed} />)
    fireEvent.change(input(), { target: { value: 'bl' } })
    await screen.findByRole('listbox')
    assert.deepEqual(optionLabels(), ['Blueberry'])
    assert.equal(input().getAttribute('aria-activedescendant'), null)
    fireEvent.keyDown(input(), { key: 'Enter' })
    assert.equal(changed.mock.calls.length, 0)
    assert.equal(input().getAttribute('aria-expanded'), 'false')
  })

  test('groups: a labelled role=group per heading; the arrows and the filter skip the headings', async () => {
    const grouped: ListboxOption[] = [
      { value: 'deposit', label: 'deposit', group: 'Recent Searches' },
      { value: 'payments', label: 'payments', group: 'Domains' },
      { value: 'players', label: 'players', group: 'Domains' },
      { value: 'player.update', label: 'player.update', group: 'Actions' },
    ]
    render(<Combobox label="Search" options={grouped} value={null} onChange={() => undefined} />)
    fireEvent.keyDown(input('Search'), { key: 'ArrowDown' })
    const listbox = await screen.findByRole('listbox')

    const groups = within(listbox).getAllByRole('group')
    assert.equal(groups.length, 3)
    const domains = screen.getByRole('group', { name: 'Domains' })
    assert.equal(within(domains).getAllByRole('option').length, 2)
    assert.equal(screen.getAllByRole('option').length, 4, 'a heading is not an option')

    await waitFor(() => assert.equal(activeLabel('Search'), 'deposit'))
    fireEvent.keyDown(input('Search'), { key: 'ArrowDown' })
    assert.equal(activeLabel('Search'), 'payments', 'ArrowDown passes over the Domains heading')

    fireEvent.change(input('Search'), { target: { value: 'play' } })
    assert.deepEqual(optionLabels(), ['players', 'player.update'])
    assert.equal(screen.queryByRole('group', { name: 'Recent Searches' }), null)
    assert.ok(screen.getByRole('group', { name: 'Actions' }))
  })

  test('typing filters case-insensitively, highlights the first match and announces the count', async () => {
    const typed = vi.fn()
    render(<Controlled onInputChange={typed} />)
    fireEvent.change(input(), { target: { value: 'B' } })

    await screen.findByRole('listbox')
    assert.deepEqual(optionLabels(), ['Banana', 'Blueberry'])
    assert.equal(activeLabel(), 'Banana')
    assert.equal(screen.getByRole('status').textContent, '2 options available')
    assert.deepEqual(typed.mock.calls, [['B']])

    fireEvent.change(input(), { target: { value: 'blue' } })
    assert.deepEqual(optionLabels(), ['Blueberry'])
    assert.equal(screen.getByRole('status').textContent, '1 option available')
  })

  test('no match shows and announces the empty text', async () => {
    render(<Controlled emptyText="No fruit found" />)
    fireEvent.change(input(), { target: { value: 'kiwi' } })
    await screen.findByRole('listbox')
    assert.equal(screen.queryAllByRole('option').length, 0)
    // once in the list's empty row, once in the live region
    assert.equal(screen.getAllByText('No fruit found').length, 2)
    assert.equal(screen.getByRole('status').textContent, 'No fruit found')
    assert.equal(input().getAttribute('aria-activedescendant'), null)
  })

  test('defaults the empty text to "No matches"', async () => {
    render(<Controlled />)
    fireEvent.change(input(), { target: { value: 'kiwi' } })
    await screen.findByRole('listbox')
    assert.equal(screen.getAllByText('No matches').length, 2)
  })

  test('a filter prop replaces the label match', async () => {
    render(<Controlled filter={(option, query) => (option.description ?? '').toLowerCase().startsWith(query)} />)
    fireEvent.change(input(), { target: { value: 'yel' } })
    await screen.findByRole('listbox')
    assert.deepEqual(optionLabels(), ['Banana'])
  })

  test('server search: filter={false} keeps the given options, reports the text and keeps a chosen label', async () => {
    const searches: string[] = []
    function ServerSearch() {
      const [query, setQuery] = useState('')
      const [value, setValue] = useState<string | null>(null)
      const options = query === 'ch' ? [{ value: 'u7', label: 'Charlie' }] : [{ value: 'u1', label: 'Alpha' }]
      return (
        <Combobox
          label="Player"
          options={options}
          filter={false}
          value={value}
          onChange={setValue}
          onInputChange={(text) => {
            searches.push(text)
            setQuery(text)
          }}
        />
      )
    }
    render(<ServerSearch />)
    fireEvent.change(input('Player'), { target: { value: 'ch' } })
    await screen.findByRole('listbox')
    assert.deepEqual(optionLabels(), ['Charlie'])

    fireEvent.keyDown(input('Player'), { key: 'Enter' })
    // the search ends ('' reported), the server list no longer holds Charlie, the label stays
    assert.deepEqual(searches, ['ch', ''])
    assert.equal(input('Player').value, 'Charlie')
  })

  test('loading: a busy list with the loading text, and the field says it is busy', async () => {
    render(<Controlled options={[]} loading />)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    const listbox = await screen.findByRole('listbox')
    assert.equal(listbox.getAttribute('aria-busy'), 'true')
    assert.equal(input().getAttribute('aria-busy'), 'true')
    assert.equal(screen.getAllByText('Loading…').length, 2)
    assert.equal(screen.getByRole('status').textContent, 'Loading…')
  })

  test('mouse: clicking the input opens; clicking an option chooses it and keeps focus in the input', async () => {
    const changed = vi.fn()
    render(<Controlled onChange={changed} />)
    const field = input()
    field.focus()
    fireEvent.click(field, { detail: 1 })
    await screen.findByRole('listbox')

    const date = screen.getAllByRole('option')[4]
    const pressed = fireEvent.mouseDown(date)
    assert.equal(pressed, false, 'a press on the list never moves focus')
    fireEvent.click(date)
    assert.deepEqual(changed.mock.calls, [['date', FRUITS[4]]])
    assert.ok(document.activeElement === field)
    assert.equal(field.value, 'Date')
  })

  test('a disabled option cannot be chosen', async () => {
    const changed = vi.fn()
    render(<Controlled onChange={changed} />)
    fireEvent.click(input(), { detail: 1 })
    await screen.findByRole('listbox')
    fireEvent.click(screen.getAllByRole('option')[3])
    assert.equal(changed.mock.calls.length, 0)
  })

  test('leaving the field closes the list', async () => {
    render(<Controlled />)
    await openWithArrow()
    fireEvent.blur(input())
    assert.equal(input().getAttribute('aria-expanded'), 'false')
  })

  test('controlled: the shown value changes only when the parent passes a new one', async () => {
    const changed = vi.fn()
    const { rerender } = render(<Combobox label="Fruit" options={FRUITS} value="apple" onChange={changed} />)
    await openWithArrow()
    fireEvent.click(screen.getAllByRole('option')[1])
    assert.deepEqual(changed.mock.calls, [['banana', FRUITS[1]]])
    assert.equal(input().value, 'Apple')

    rerender(<Combobox label="Fruit" options={FRUITS} value="banana" onChange={changed} />)
    assert.equal(input().value, 'Banana')
  })

  test('uncontrolled: starts from defaultValue and keeps its own choice', async () => {
    const changed = vi.fn()
    render(<Combobox label="Fruit" options={FRUITS} defaultValue="apple" onChange={changed} />)
    assert.equal(input().value, 'Apple')
    await openWithArrow()
    fireEvent.click(screen.getAllByRole('option')[2])
    assert.equal(input().value, 'Blueberry')
    assert.deepEqual(changed.mock.calls, [['blueberry', FRUITS[2]]])
  })

  test('clearable: a labelled clear button empties the value and returns focus', () => {
    const changed = vi.fn()
    render(<Controlled initial="apple" clearable onChange={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear Fruit' }))
    assert.deepEqual(changed.mock.calls, [[null, null]])
    assert.equal(input().value, '')
    assert.ok(document.activeElement === input())
    assert.equal(screen.queryByRole('button', { name: 'Clear Fruit' }), null)
  })

  test('disabled: no popup, no clear button, nothing changes', () => {
    render(<Controlled initial="apple" clearable disabled />)
    const field = input()
    assert.equal(field.disabled, true)
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.click(field)
    assert.equal(field.getAttribute('aria-expanded'), 'false')
    assert.equal(screen.queryByRole('listbox'), null)
    assert.equal(screen.queryByRole('button', { name: 'Clear Fruit' }), null)
  })

  test('wires required, help and error through FieldShell and forwards the input ref', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <Combobox
        ref={ref}
        label="Agent"
        options={FRUITS}
        value={null}
        onChange={() => undefined}
        required
        help="Search by username."
        error="Choose an agent"
      />,
    )
    const field = screen.getByRole('combobox', { name: /Agent/ }) as HTMLInputElement
    assert.ok(ref.current === field)
    assert.equal(field.getAttribute('aria-required'), 'true')
    assert.equal(field.getAttribute('aria-invalid'), 'true')
    const ids = (field.getAttribute('aria-describedby') ?? '').split(' ')
    assert.equal(document.getElementById(ids[0])?.textContent, 'Search by username.')
    assert.equal(document.getElementById(ids[1])?.textContent, 'Choose an agent')
    assert.equal(screen.getByRole('alert').textContent, 'Choose an agent')
  })

  test('name posts the value through a hidden input, not the visible label', () => {
    const { container } = render(<Controlled initial="banana" name="fruit" />)
    const hidden = container.querySelector('input[type="hidden"][name="fruit"]') as HTMLInputElement
    assert.equal(hidden.value, 'banana')
    assert.equal(input().getAttribute('name'), null)
  })

  test('select-only: read-only input, typeahead opens on a match, Home/End and Space work', async () => {
    const changed = vi.fn()
    render(<Controlled searchable={false} onChange={changed} />)
    const field = input()
    assert.equal(field.readOnly, true)
    assert.equal(field.getAttribute('aria-autocomplete'), 'none')

    fireEvent.keyDown(field, { key: 'b' })
    await screen.findByRole('listbox')
    await waitFor(() => assert.equal(activeLabel(), 'Banana'))

    fireEvent.keyDown(field, { key: 'End' })
    assert.equal(activeLabel(), 'Date')
    fireEvent.keyDown(field, { key: 'Home' })
    assert.equal(activeLabel(), 'Apple')

    await new Promise((resolve) => setTimeout(resolve, 800)) // let the typeahead string expire
    fireEvent.keyDown(field, { key: ' ' })
    assert.deepEqual(changed.mock.calls, [['apple', FRUITS[0]]])
    assert.equal(field.getAttribute('aria-expanded'), 'false')

    fireEvent.keyDown(field, { key: 'Enter' })
    assert.equal(field.getAttribute('aria-expanded'), 'true')
  })

  test('AutoComplete: nothing is active until an arrow key, so Enter keeps the text; a pick is reported', async () => {
    const picks = vi.fn()
    const changes = vi.fn()
    function Search() {
      const [text, setText] = useState('')
      return (
        <Combobox
          label="Search"
          options={FRUITS}
          value={null}
          inputValue={text}
          onInputChange={setText}
          onChange={changes}
          onSelect={picks}
        />
      )
    }
    render(<Search />)
    const field = input('Search')
    // An Enter in the closed field first: floating-ui keeps it as the last navigation key, which must not
    // make the first suggestion active once typing opens the list.
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.change(field, { target: { value: 'b' } })
    await screen.findByRole('listbox')
    assert.deepEqual(optionLabels(), ['Banana', 'Blueberry'])
    await new Promise((resolve) => setTimeout(resolve, 50)) // past floating-ui's microtask and frame sync
    assert.equal(field.getAttribute('aria-activedescendant'), null)

    fireEvent.keyDown(field, { key: 'Enter' })
    assert.equal(picks.mock.calls.length, 0)
    assert.equal(changes.mock.calls.length, 0)
    assert.equal(field.value, 'b', 'the typed text stays (antd AutoComplete)')
    assert.equal(field.getAttribute('aria-expanded'), 'false')

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    await screen.findByRole('listbox')
    await waitFor(() => assert.equal(activeLabel('Search'), 'Banana'))
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    assert.deepEqual(picks.mock.calls, [['blueberry', FRUITS[2]]])
    assert.deepEqual(changes.mock.calls, [['blueberry', FRUITS[2]]])
    assert.equal(field.value, 'b', 'the page owns the text')
  })
})
