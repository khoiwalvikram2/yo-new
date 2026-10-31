/**
 * TenantCurrencyControlsView renders the tenant/currency selects directly at desktop widths and behind a
 * "Filters" popover below 1024px (decision 3, S "Filters below 1024px"). The popover holds both selects
 * with visible labels and drops the old "Search..." entry — the search field is always visible now.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TenantCurrencyControlsView } from './TenantCurrencyControlsView'
import type { TenantCurrencyState } from './useTenantCurrency'

function makeState(overrides: Partial<TenantCurrencyState> = {}): TenantCurrencyState {
  return {
    tenant: 'wl-1',
    onTenantChange: vi.fn(),
    tenantOptions: [
      { value: 'wl-1', label: 'GameDash' },
      { value: 'wl-2', label: 'ZZ Shell Test' },
    ],
    tenantsLoading: false,
    currency: 'INR',
    onCurrencyChange: vi.fn(),
    currencyOptions: [
      { value: 'INR', label: '₹ INR' },
      { value: 'USD', label: '$ USD' },
    ],
    currencyLoading: false,
    currencyTitle: 'Display currency (Whitelabel base: INR)',
    ...overrides,
  }
}

describe('TenantCurrencyControlsView', () => {
  test('non-compact renders two labelled selects with no popover', () => {
    render(<TenantCurrencyControlsView state={makeState()} compact={false} />)

    assert.ok(screen.getByRole('combobox', { name: 'Tenant' }))
    assert.ok(screen.getByRole('combobox', { name: 'Currency' }))
    assert.equal(screen.queryByRole('dialog'), null)
    assert.equal(screen.queryByRole('button', { name: 'Filters' }), null)
  })

  test('compact renders a Filters popover holding both selects, no Search entry', async () => {
    render(<TenantCurrencyControlsView state={makeState()} compact={true} />)

    assert.equal(screen.queryByRole('combobox'), null)
    const trigger = screen.getByRole('button', { name: 'Filters' })

    fireEvent.click(trigger)

    await waitFor(() => assert.ok(screen.getByRole('dialog', { name: 'Filters' })))
    assert.ok(screen.getByRole('combobox', { name: 'Tenant' }))
    assert.ok(screen.getByRole('combobox', { name: 'Currency' }))
    assert.equal(screen.queryByText(/search/i), null)
  })

  test('selecting a tenant calls onTenantChange with the chosen id', () => {
    const onTenantChange = vi.fn()
    render(<TenantCurrencyControlsView state={makeState({ onTenantChange })} compact={false} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Tenant' }), { target: { value: 'wl-2' } })

    assert.equal(onTenantChange.mock.calls.length, 1)
    assert.equal(onTenantChange.mock.calls[0][0], 'wl-2')
  })

  test('tenantsLoading/currencyLoading are forwarded to each select as disabled and busy', () => {
    render(
      <TenantCurrencyControlsView
        state={makeState({ tenantsLoading: true, currencyLoading: true })}
        compact={false}
      />,
    )
    const tenant = screen.getByRole('combobox', { name: 'Tenant' })
    const currency = screen.getByRole('combobox', { name: 'Currency' })
    assert.equal(tenant.hasAttribute('disabled'), true)
    assert.equal(tenant.getAttribute('aria-busy'), 'true')
    assert.equal(currency.hasAttribute('disabled'), true)
    assert.equal(currency.getAttribute('aria-busy'), 'true')
  })
})
