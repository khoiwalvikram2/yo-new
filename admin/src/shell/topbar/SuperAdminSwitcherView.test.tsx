/**
 * The mode switcher decides which tenant every Super Admin query runs against. The rebuilt view must keep
 * today's contract exactly: nothing renders unless the hook says the user is an authenticated Super Admin;
 * the pill names the current mode; the switch carries a stable accessible name and asks for the NEXT mode;
 * the whitelabel select appears only in whitelabel mode, shows "Select Whitelabel" when nothing is chosen,
 * never pushes an empty id, and is disabled while the whitelabel list loads. The view takes props only, so
 * this test needs no Apollo, auth or uiStore mocks.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { WhitelabelWithCurrency } from '@/shared/core/useWhitelabels'
import type { SuperAdminModeState } from './useSuperAdminMode'
import { SuperAdminSwitcherView } from './SuperAdminSwitcherView'

const WHITELABELS: WhitelabelWithCurrency[] = [
  { id: 'wl-1', name: 'Royal Casino', domain: 'royal.example', baseCurrency: 'INR', region: 'India', timezone: 'Asia/Kolkata' },
  { id: 'wl-2', name: 'GoldBet77', domain: 'goldbet.example', baseCurrency: 'USD', region: 'United States', timezone: 'America/New_York' },
]

function makeState(overrides: Partial<SuperAdminModeState> = {}): SuperAdminModeState {
  return {
    visible: true,
    mode: 'core',
    selectedWhitelabelId: null,
    whitelabels: WHITELABELS,
    whitelabelsLoading: false,
    setMode: vi.fn(),
    selectWhitelabel: vi.fn(),
    ...overrides,
  }
}

function pillOf(text: 'Core' | 'Whitelabel'): HTMLElement {
  const label = screen.getByText(text, { selector: 'span' })
  const pill = label.parentElement
  assert.ok(pill, 'the mode text sits inside the pill')
  return pill
}

function whitelabelSelect(): HTMLSelectElement {
  const select = screen.getByRole('combobox', { name: 'Whitelabel' })
  assert.ok(select instanceof HTMLSelectElement)
  return select
}

describe('SuperAdminSwitcherView', () => {
  test('renders nothing when the user is not an authenticated Super Admin', () => {
    const { container } = render(<SuperAdminSwitcherView state={makeState({ visible: false })} compact={false} />)
    assert.equal(container.innerHTML, '')
    assert.equal(screen.queryByRole('switch'), null)
  })

  test('core mode: Core pill with the database icon, switch off, no whitelabel select', () => {
    render(<SuperAdminSwitcherView state={makeState()} compact={false} />)
    const pill = pillOf('Core')
    const icon = pill.querySelector('svg')
    assert.ok(icon, 'the pill shows an icon')
    assert.ok(icon.classList.contains('tabler-icon-database'))
    assert.equal(icon.getAttribute('aria-hidden'), 'true')

    const toggle = screen.getByRole('switch', { name: 'Whitelabel mode' })
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    assert.ok(pill.contains(toggle), 'the switch sits inside the pill, as today')

    assert.equal(screen.queryByText('Whitelabel', { selector: 'span' }), null)
    assert.equal(screen.queryByRole('combobox'), null)
  })

  test('turning the switch on in core mode asks for whitelabel mode', () => {
    const setMode = vi.fn()
    render(<SuperAdminSwitcherView state={makeState({ setMode })} compact={false} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Whitelabel mode' }))
    assert.deepEqual(setMode.mock.calls, [['whitelabel']])
  })

  test('whitelabel mode: Whitelabel pill with the users icon, switch on, and turning it off asks for core', () => {
    const setMode = vi.fn()
    render(<SuperAdminSwitcherView state={makeState({ mode: 'whitelabel', selectedWhitelabelId: 'wl-1', setMode })} compact={false} />)
    const pill = pillOf('Whitelabel')
    const icon = pill.querySelector('svg')
    assert.ok(icon, 'the pill shows an icon')
    assert.ok(icon.classList.contains('tabler-icon-users'))
    assert.equal(screen.queryByText('Core', { selector: 'span' }), null)

    const toggle = screen.getByRole('switch', { name: 'Whitelabel mode' })
    assert.equal(toggle.getAttribute('aria-checked'), 'true')
    fireEvent.click(toggle)
    assert.deepEqual(setMode.mock.calls, [['core']])
  })

  test('whitelabel mode with no selection shows the disabled "Select Whitelabel" placeholder first', () => {
    render(<SuperAdminSwitcherView state={makeState({ mode: 'whitelabel', selectedWhitelabelId: null })} compact={false} />)
    const select = whitelabelSelect()
    assert.equal(select.value, '')
    const options = Array.from(select.options).map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled }))
    assert.deepEqual(options, [
      { value: '', text: 'Select Whitelabel', disabled: true },
      { value: 'wl-1', text: 'Royal Casino', disabled: false },
      { value: 'wl-2', text: 'GoldBet77', disabled: false },
    ])
    assert.equal(select.disabled, false)
  })

  test('whitelabel mode shows the selected whitelabel', () => {
    render(<SuperAdminSwitcherView state={makeState({ mode: 'whitelabel', selectedWhitelabelId: 'wl-2' })} compact={false} />)
    assert.equal(whitelabelSelect().value, 'wl-2')
  })

  test('choosing a whitelabel passes its id to selectWhitelabel', () => {
    const selectWhitelabel = vi.fn()
    render(
      <SuperAdminSwitcherView
        state={makeState({ mode: 'whitelabel', selectedWhitelabelId: 'wl-1', selectWhitelabel })}
        compact={false}
      />,
    )
    fireEvent.change(whitelabelSelect(), { target: { value: 'wl-2' } })
    assert.deepEqual(selectWhitelabel.mock.calls, [['wl-2']])
  })

  test('the select is disabled and busy while whitelabels load', () => {
    render(
      <SuperAdminSwitcherView
        state={makeState({ mode: 'whitelabel', whitelabels: [], whitelabelsLoading: true })}
        compact={false}
      />,
    )
    const select = whitelabelSelect()
    assert.equal(select.disabled, true)
    assert.equal(select.getAttribute('aria-busy'), 'true')
  })
})

describe('SuperAdminSwitcherView compact', () => {
  test('compact + core mode renders an icon-only trigger; opening it reveals the switch', async () => {
    render(<SuperAdminSwitcherView state={makeState()} compact={true} />)

    assert.equal(screen.queryByRole('switch'), null)
    const trigger = screen.getByRole('button', { name: 'Super Admin mode: Core' })
    const icon = trigger.querySelector('svg')
    assert.ok(icon, 'the trigger shows an icon')
    assert.ok(icon.classList.contains('tabler-icon-database'))

    fireEvent.click(trigger)

    await waitFor(() => assert.ok(screen.getByRole('dialog', { name: 'Super Admin mode' })))
    assert.ok(screen.getByRole('switch', { name: 'Whitelabel mode' }))
  })

  test('compact + whitelabel mode: trigger shows the users icon and its own label, popover holds the whitelabel select', async () => {
    render(
      <SuperAdminSwitcherView
        state={makeState({ mode: 'whitelabel', selectedWhitelabelId: 'wl-1' })}
        compact={true}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Super Admin mode: Whitelabel' })
    const icon = trigger.querySelector('svg')
    assert.ok(icon, 'the trigger shows an icon')
    assert.ok(icon.classList.contains('tabler-icon-users'))

    fireEvent.click(trigger)

    await waitFor(() => assert.ok(screen.getByRole('dialog', { name: 'Super Admin mode' })))
    assert.ok(screen.getByRole('combobox', { name: 'Whitelabel' }))
  })

  test('the switch inside the popover still calls setMode', async () => {
    const setMode = vi.fn()
    render(<SuperAdminSwitcherView state={makeState({ setMode })} compact={true} />)

    fireEvent.click(screen.getByRole('button', { name: 'Super Admin mode: Core' }))
    await waitFor(() => assert.ok(screen.getByRole('dialog', { name: 'Super Admin mode' })))

    fireEvent.click(screen.getByRole('switch', { name: 'Whitelabel mode' }))
    assert.deepEqual(setMode.mock.calls, [['whitelabel']])
  })

  test('non-compact renders no trigger button and no dialog', () => {
    render(<SuperAdminSwitcherView state={makeState()} compact={false} />)
    assert.equal(screen.queryByRole('button', { name: /Super Admin mode/ }), null)
    assert.equal(screen.queryByRole('dialog'), null)
  })
})
