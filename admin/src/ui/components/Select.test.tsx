/**
 * Select is the topbar's whitelabel, tenant and currency picker. Those selects hide their labels, so the
 * select must still get its name from a real <label>. A placeholder must never push '' into mode or
 * tenant state. While whitelabels load the select must be unusable and say it is busy, without a
 * second "Loading" announcement from the spinner.
 *
 * The themed list: a mouse or pen press opens the kit list in place of the native popup (touch keeps the
 * native picker), the native select stays the control that change events drive, and the open list's keys
 * never reach an enclosing Dialog or change the native select underneath it. DOM elements are compared
 * with assert.ok(a === b), never assert.equal (see Combobox.test.tsx).
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { createRef } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Select } from './Select'
import type { SelectOption } from './Select'
import styles from './Select.module.css'

const currencies: readonly SelectOption[] = [
  { value: 'INR', label: '₹ INR' },
  { value: 'USD', label: '$ USD' },
  { value: 'EUR', label: '€ EUR', disabled: true },
]

const whitelabels: readonly SelectOption[] = [
  { value: 'wl-1', label: 'GoldBet77' },
  { value: 'wl-2', label: 'Royal Casino' },
]

function combobox(name: string): HTMLSelectElement {
  return screen.getByRole('combobox', { name }) as HTMLSelectElement
}

const countries: readonly SelectOption[] = [
  { value: 'AU', label: 'Australia' },
  { value: 'BD', label: 'Bangladesh' },
  { value: 'IN', label: 'India' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'NP', label: 'Nepal' },
  { value: 'LK', label: 'Sri Lanka' },
  { value: 'AE', label: 'United Arab Emirates' },
]

/** Returns false when the press was cancelled, i.e. the native popup was kept shut. */
const press = (element: Element, pointerType = 'mouse') => fireEvent.pointerDown(element, { pointerType, button: 0 })

/** The label of the option the focused field points at with aria-activedescendant. */
function activeLabel(field: Element): string | null {
  const id = field.getAttribute('aria-activedescendant')
  const node = id ? document.getElementById(id) : null
  return node?.querySelector('span:not([aria-hidden])')?.textContent ?? null
}

const labels = (list: HTMLElement) =>
  within(list)
    .queryAllByRole('option')
    .map((option) => option.querySelector('span:not([aria-hidden])')?.textContent)

describe('Select', () => {
  test('names the select with its visible label', () => {
    render(<Select label="Currency" options={currencies} value="INR" onChange={() => {}} />)
    const select = combobox('Currency')
    const label = screen.getByText('Currency')
    assert.equal(label.tagName, 'LABEL')
    assert.ok(select.id.length > 0)
    assert.equal(label.getAttribute('for'), select.id)
    assert.equal(select.getAttribute('aria-label'), null)
  })

  test('a hidden label still names the select and stays in the DOM as a label', () => {
    render(<Select label="Whitelabel" hideLabel options={whitelabels} value="wl-1" onChange={() => {}} />)
    const select = combobox('Whitelabel')
    const label = screen.getByText('Whitelabel')
    assert.equal(label.tagName, 'LABEL')
    assert.equal(label.getAttribute('for'), select.id)
    assert.equal(select.getAttribute('aria-label'), null)
  })

  test('uses a given id for the select and its label', () => {
    render(<Select id="currency-select" label="Currency" options={currencies} value="INR" onChange={() => {}} />)
    const select = combobox('Currency')
    assert.equal(select.id, 'currency-select')
    assert.equal(screen.getByText('Currency').getAttribute('for'), 'currency-select')
  })

  test('two selects get distinct generated ids', () => {
    render(
      <>
        <Select label="Tenant" hideLabel options={whitelabels} value="wl-1" onChange={() => {}} />
        <Select label="Currency" hideLabel options={currencies} value="INR" onChange={() => {}} />
      </>,
    )
    const tenant = combobox('Tenant')
    const currency = combobox('Currency')
    assert.notEqual(tenant.id, currency.id)
    assert.equal(screen.getByText('Tenant').getAttribute('for'), tenant.id)
    assert.equal(screen.getByText('Currency').getAttribute('for'), currency.id)
  })

  test('renders the options in order and selects the controlled value', () => {
    render(<Select label="Currency" options={currencies} value="USD" onChange={() => {}} />)
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    assert.deepEqual(
      options.map((option) => [option.value, option.textContent, option.disabled]),
      [
        ['INR', '₹ INR', false],
        ['USD', '$ USD', false],
        ['EUR', '€ EUR', true],
      ],
    )
    assert.equal(combobox('Currency').value, 'USD')
  })

  test('calls onChange with the chosen option value', () => {
    const calls: string[] = []
    render(<Select label="Currency" options={currencies} value="USD" onChange={(value) => calls.push(value)} />)
    fireEvent.change(combobox('Currency'), { target: { value: 'INR' } })
    assert.deepEqual(calls, ['INR'])
  })

  test('shows the placeholder first as a disabled empty option and selects it for an empty value', () => {
    render(
      <Select label="Whitelabel" hideLabel placeholder="Select Whitelabel" options={whitelabels} value="" onChange={() => {}} />,
    )
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    assert.equal(options.length, 3)
    assert.equal(options[0].value, '')
    assert.equal(options[0].textContent, 'Select Whitelabel')
    assert.equal(options[0].disabled, true)
    assert.equal(combobox('Whitelabel').value, '')
  })

  test('never calls onChange with an empty value while a placeholder is set', () => {
    const calls: string[] = []
    render(
      <Select
        label="Whitelabel"
        hideLabel
        placeholder="Select Whitelabel"
        options={whitelabels}
        value="wl-1"
        onChange={(value) => calls.push(value)}
      />,
    )
    const select = combobox('Whitelabel')
    fireEvent.change(select, { target: { value: '' } })
    assert.deepEqual(calls, [])
    fireEvent.change(select, { target: { value: 'wl-2' } })
    assert.deepEqual(calls, ['wl-2'])
  })

  test('passes an empty option value through when there is no placeholder', () => {
    const calls: string[] = []
    const withAll: readonly SelectOption[] = [{ value: '', label: 'All tenants' }, ...whitelabels]
    render(<Select label="Tenant" options={withAll} value="wl-1" onChange={(value) => calls.push(value)} />)
    fireEvent.change(combobox('Tenant'), { target: { value: '' } })
    assert.deepEqual(calls, [''])
  })

  test('loading disables the select, marks it busy and swaps the chevron for a hidden spinner', () => {
    const { container } = render(
      <Select label="Whitelabel" hideLabel loading options={whitelabels} value="wl-1" onChange={() => {}} />,
    )
    const select = combobox('Whitelabel')
    assert.equal(select.disabled, true)
    assert.equal(select.getAttribute('aria-busy'), 'true')
    assert.equal(container.querySelector('svg.tabler-icon-chevron-down'), null)
    assert.equal(screen.queryByRole('img', { name: 'Loading', hidden: true }), null)
    assert.ok(container.querySelector('[aria-hidden="true"] > span[aria-hidden="true"]'))
  })

  test('is enabled with a hidden chevron and no aria-busy when not loading', () => {
    const { container } = render(<Select label="Currency" options={currencies} value="INR" onChange={() => {}} />)
    const select = combobox('Currency')
    assert.equal(select.disabled, false)
    assert.equal(select.getAttribute('aria-busy'), null)
    const chevron = container.querySelector('svg.tabler-icon-chevron-down')
    assert.ok(chevron)
    assert.ok(chevron.closest('[aria-hidden="true"]'))
  })

  test('disabled disables the select without marking it busy', () => {
    render(<Select label="Currency" disabled options={currencies} value="INR" onChange={() => {}} />)
    const select = combobox('Currency')
    assert.equal(select.disabled, true)
    assert.equal(select.getAttribute('aria-busy'), null)
  })

  test('forwards its ref to the select element', () => {
    const ref = createRef<HTMLSelectElement>()
    render(<Select ref={ref} label="Currency" options={currencies} value="INR" onChange={() => {}} />)
    assert.equal(ref.current, combobox('Currency'))
  })

  test('puts className on the root and other attributes on the select', () => {
    const { container } = render(
      <Select
        className="wide"
        title="Display currency"
        name="currency"
        label="Currency"
        hideLabel
        size="sm"
        options={currencies}
        value="INR"
        onChange={() => {}}
      />,
    )
    const select = combobox('Currency')
    const root = container.firstElementChild
    assert.ok(root)
    assert.equal(root.tagName, 'SPAN')
    assert.ok(root.classList.contains('wide'))
    assert.ok(root.contains(select))
    assert.equal(select.classList.contains('wide'), false)
    assert.equal(select.title, 'Display currency')
    assert.equal(select.name, 'currency')
  })

  test('adds stacked form layout with required, help and error wiring without changing the native select', () => {
    const { container } = render(
      <Select
        id="bonus-type"
        label="Bonus type"
        layout="stacked"
        required
        help="Choose how the campaign is released."
        error="Bonus type is required."
        options={whitelabels}
        value=""
        onChange={() => {}}
      />,
    )
    const select = combobox('Bonus type')
    const root = container.firstElementChild
    const help = screen.getByText('Choose how the campaign is released.')
    const error = screen.getByRole('alert')

    assert.ok(root?.classList.contains(styles.stacked))
    assert.equal(select.required, true)
    assert.equal(select.getAttribute('aria-required'), 'true')
    assert.equal(select.getAttribute('aria-invalid'), 'true')
    assert.deepEqual(select.getAttribute('aria-describedby')?.split(' '), [help.id, error.id])
    assert.equal(error.textContent, 'Bonus type is required.')
  })

  test('retains caller descriptions and keeps the established inline layout as the default', () => {
    const { container } = render(
      <>
        <span id="currency-context">Used for display.</span>
        <Select
          label="Currency"
          aria-describedby="currency-context"
          aria-invalid="false"
          aria-required="false"
          options={currencies}
          value="INR"
          onChange={() => {}}
        />
      </>,
    )
    const select = combobox('Currency')
    const root = container.querySelector(`.${styles.root}`)
    assert.equal(select.getAttribute('aria-describedby'), 'currency-context')
    assert.equal(select.getAttribute('aria-invalid'), 'false')
    assert.equal(select.getAttribute('aria-required'), 'false')
    assert.ok(root?.classList.contains(styles.inline))
    assert.equal(root?.classList.contains(styles.stacked), false)
  })
})

describe('Select themed list', () => {
  test('a mouse press opens the themed list instead of the native popup; clicking an option chooses it', async () => {
    const calls: string[] = []
    render(<Select label="Currency" options={currencies} value="INR" onChange={(value) => calls.push(value)} />)
    const select = combobox('Currency')
    assert.equal(select.getAttribute('aria-expanded'), null, 'closed, the select has no popup state of its own')

    assert.equal(press(select), false, 'the native popup is cancelled')
    const list = await screen.findByRole('listbox', { name: 'Currency' })
    assert.ok(document.activeElement === select)
    assert.equal(select.getAttribute('aria-expanded'), 'true')
    assert.equal(select.getAttribute('aria-controls'), list.id)
    assert.deepEqual(labels(list), ['₹ INR', '$ USD', '€ EUR'])
    assert.equal(within(list).getByRole('option', { selected: true }).textContent, '₹ INR')
    assert.equal(screen.queryByRole('textbox'), null, 'six or fewer options get no search box')

    fireEvent.click(within(list).getByRole('option', { name: '$ USD' }))
    assert.deepEqual(calls, ['USD'])
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
    assert.equal(select.getAttribute('aria-expanded'), null)
    assert.ok(document.activeElement === select)
  })

  test('a pen press opens it too; a second press on the field and a press outside close it', async () => {
    render(
      <>
        <p>Page text</p>
        <Select label="Currency" options={currencies} value="INR" onChange={() => {}} />
      </>,
    )
    const select = combobox('Currency')
    press(select, 'pen')
    await screen.findByRole('listbox', { name: 'Currency' })
    assert.equal(press(select), false, 'the closing press does not open the native popup either')
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))

    press(select)
    await screen.findByRole('listbox', { name: 'Currency' })
    fireEvent.pointerDown(screen.getByText('Page text'))
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
  })

  test('a touch press keeps the native picker', () => {
    render(<Select label="Currency" options={currencies} value="INR" onChange={() => {}} />)
    const select = combobox('Currency')
    assert.equal(press(select, 'touch'), true, 'the press is left to the browser')
    assert.equal(select.getAttribute('aria-expanded'), null)
    assert.equal(screen.queryByRole('listbox'), null)
  })

  test('disabled and loading selects never open it', () => {
    const { rerender } = render(<Select label="Currency" disabled options={currencies} value="INR" onChange={() => {}} />)
    assert.equal(press(combobox('Currency')), true)
    assert.equal(screen.queryByRole('listbox'), null)

    rerender(<Select label="Currency" loading options={currencies} value="INR" onChange={() => {}} />)
    assert.equal(press(combobox('Currency')), true)
    assert.equal(screen.queryByRole('listbox'), null)
    assert.equal(combobox('Currency').getAttribute('aria-expanded'), null)
  })

  test('Escape closes without choosing and never reaches an enclosing handler such as a Dialog', async () => {
    const calls: string[] = []
    const outer: string[] = []
    render(
      <div onKeyDown={(event) => outer.push(event.key)}>
        <Select label="Currency" options={currencies} value="INR" onChange={(value) => calls.push(value)} />
      </div>,
    )
    const select = combobox('Currency')
    press(select)
    await screen.findByRole('listbox', { name: 'Currency' })
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    assert.equal(fireEvent.keyDown(select, { key: 'Escape' }), false)
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
    assert.deepEqual(calls, [])
    assert.deepEqual(outer, [])

    // Closed, the keys are the native select's again.
    assert.equal(fireEvent.keyDown(select, { key: 'Escape' }), true)
    assert.deepEqual(outer, ['Escape'])
  })

  test('the arrows skip disabled options and stop at the ends; Home, End and Enter; keys are prevented', async () => {
    const calls: string[] = []
    const withPound: readonly SelectOption[] = [...currencies, { value: 'GBP', label: '£ GBP' }]
    render(<Select label="Currency" options={withPound} value="INR" onChange={(value) => calls.push(value)} />)
    const select = combobox('Currency')
    press(select)
    await screen.findByRole('listbox', { name: 'Currency' })
    assert.equal(activeLabel(select), '₹ INR', 'opens on the chosen option')

    assert.equal(fireEvent.keyDown(select, { key: 'ArrowDown' }), false, 'the native select does not move too')
    assert.equal(activeLabel(select), '$ USD')
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    assert.equal(activeLabel(select), '£ GBP', 'the disabled EUR is skipped')
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    assert.equal(activeLabel(select), '£ GBP', 'no wrap past the end')
    fireEvent.keyDown(select, { key: 'Home' })
    assert.equal(activeLabel(select), '₹ INR')
    fireEvent.keyDown(select, { key: 'End' })
    assert.equal(activeLabel(select), '£ GBP')
    fireEvent.keyDown(select, { key: 'ArrowUp' })
    assert.equal(activeLabel(select), '$ USD')

    assert.equal(fireEvent.keyDown(select, { key: 'Enter' }), false)
    assert.deepEqual(calls, ['USD'])
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
  })

  test('letters jump by typeahead, Tab closes without choosing, and choosing the shown option is no change', async () => {
    const calls: string[] = []
    render(<Select label="Currency" options={currencies} value="INR" onChange={(value) => calls.push(value)} />)
    const select = combobox('Currency')
    press(select)
    await screen.findByRole('listbox', { name: 'Currency' })
    assert.equal(fireEvent.keyDown(select, { key: '$' }), false)
    assert.equal(activeLabel(select), '$ USD')
    fireEvent.keyDown(select, { key: 'Tab' })
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
    assert.deepEqual(calls, [])

    press(select)
    const list = await screen.findByRole('listbox', { name: 'Currency' })
    fireEvent.click(within(list).getByRole('option', { name: '₹ INR' }))
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
    assert.deepEqual(calls, [], 'as a native select, re-choosing the shown option fires no change')
  })

  test('the placeholder rule holds in the themed list too', async () => {
    const calls: string[] = []
    const withAll: readonly SelectOption[] = [{ value: '', label: 'All tenants' }, ...whitelabels]
    render(
      <Select label="Tenant" placeholder="Pick one" options={withAll} value="wl-1" onChange={(value) => calls.push(value)} />,
    )
    press(combobox('Tenant'))
    const list = await screen.findByRole('listbox', { name: 'Tenant' })
    assert.deepEqual(labels(list), ['All tenants', 'GoldBet77', 'Royal Casino'], 'the placeholder is not a row')
    fireEvent.click(within(list).getByRole('option', { name: 'All tenants' }))
    assert.deepEqual(calls, [])
  })

  test('more than six options: a focused search box filters by label, the first match active', async () => {
    const calls: string[] = []
    render(<Select label="Country" options={countries} value="NP" onChange={(value) => calls.push(value)} />)
    press(combobox('Country'))
    const search = await screen.findByRole('textbox', { name: 'Search Country' })
    await waitFor(() => assert.ok(document.activeElement === search))
    const list = screen.getByRole('listbox', { name: 'Country' })
    assert.equal(labels(list).length, 7)
    assert.equal(activeLabel(search), 'Nepal')

    fireEvent.change(search, { target: { value: 'IND' } })
    assert.deepEqual(labels(list), ['India', 'Indonesia'])
    assert.equal(activeLabel(search), 'India')
    assert.equal(fireEvent.keyDown(search, { key: 'ArrowDown' }), false)
    assert.equal(activeLabel(search), 'Indonesia')

    fireEvent.change(search, { target: { value: 'zz' } })
    assert.equal(labels(screen.getByRole('listbox', { name: 'Country' })).length, 0)
    assert.ok(screen.getByText('No matches'))

    fireEvent.change(search, { target: { value: 'lanka' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    assert.deepEqual(calls, ['LK'])
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
    assert.ok(document.activeElement === combobox('Country'), 'focus returns to the select')
  })

  test('Escape from the search box closes the list and returns focus to the select', async () => {
    const outer: string[] = []
    render(
      <div onKeyDown={(event) => outer.push(event.key)}>
        <Select label="Country" options={countries} value="NP" onChange={() => {}} />
      </div>,
    )
    press(combobox('Country'))
    const search = await screen.findByRole('textbox', { name: 'Search Country' })
    fireEvent.keyDown(search, { key: 'Escape' })
    await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
    assert.ok(document.activeElement === combobox('Country'))
    assert.deepEqual(outer, [])
  })

  test('groups and descriptions: optgroups in the native select, headed groups and counts in the themed list', async () => {
    const calls: string[] = []
    const markets: readonly SelectOption[] = [
      { value: 'cricket', label: 'Cricket', group: 'Sports', description: '128' },
      { value: 'soccer', label: 'Soccer', group: 'Sports', description: '64' },
      { value: 'roulette', label: 'Roulette', group: 'Casino' },
    ]
    const { container } = render(
      <Select label="Market" options={markets} value="cricket" onChange={(value) => calls.push(value)} />,
    )
    const groups = Array.from(container.querySelectorAll('optgroup'))
    assert.deepEqual(
      groups.map((group) => [group.label, group.querySelectorAll('option').length]),
      [
        ['Sports', 2],
        ['Casino', 1],
      ],
    )
    assert.equal(container.querySelector('option[value="soccer"]')?.textContent, 'Soccer', 'the native option shows the label only')

    // The native change path is untouched.
    fireEvent.change(combobox('Market'), { target: { value: 'roulette' } })
    assert.deepEqual(calls, ['roulette'])

    press(combobox('Market'))
    const list = await screen.findByRole('listbox', { name: 'Market' })
    const sports = within(list).getByRole('group', { name: 'Sports' })
    assert.equal(within(sports).getAllByRole('option').length, 2)
    assert.ok(within(sports).getByText('128'))
    assert.ok(within(list).getByRole('group', { name: 'Casino' }))
  })
})
