/**
 * The currency form on its own: the legacy labels, placeholders and help, the code upper-cased as typed,
 * every rule's message with focus on the first invalid field, the exact create and update values (status
 * only on edit, a stored zero decimals kept, a cleared stored rate sent as null, the rate at six places even
 * when Enter submits before a blur), the single-flight submit and Cancel.
 */
import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Currency } from '@/shared/types/currency'
import { CurrencyForm } from './CurrencyForm'

const EUR: Currency = { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, isActive: true, exchangeRate: 0.92 }
const JPY: Currency = { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, isActive: false, exchangeRate: 149.5 }

function field(name: string): HTMLInputElement {
  return screen.getByRole('textbox', { name }) as HTMLInputElement
}

function type(name: string, value: string) {
  const input = field(name)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

function renderForm(props: Partial<Parameters<typeof CurrencyForm>[0]> = {}) {
  const onSubmit = vi.fn<(values: unknown) => void | Promise<void>>()
  const onCancel = vi.fn()
  const view = render(
    <CurrencyForm onSubmit={props.onSubmit ?? onSubmit} onCancel={onCancel} inModal {...props} />,
  )
  return { ...view, onSubmit, onCancel }
}

function submit(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('CurrencyForm', () => {
  test('shows the legacy fields, copy and create defaults, and upper-cases the code as it is typed', () => {
    renderForm()

    const code = field('Currency Code')
    assert.equal(code.value, '')
    assert.equal(code.placeholder, 'e.g., USD, EUR, INR')
    assert.equal(code.disabled, false)
    assert.equal(code.getAttribute('aria-required'), 'true')
    assert.equal(field('Currency Name').placeholder, 'e.g., US Dollar, Euro, Indian Rupee')
    assert.equal(field('Currency Symbol').placeholder, 'e.g., $, €, ₹')
    assert.equal(field('Decimal Places').value, '2')
    assert.equal(field('Decimal Places').placeholder, '2')
    assert.equal(field('Exchange Rate (vs USD)').value, '')
    assert.equal(field('Exchange Rate (vs USD)').placeholder, 'e.g., 83.0 for INR')
    assert.equal(field('Exchange Rate (vs USD)').getAttribute('aria-required'), null)
    for (const help of [
      'Three-letter ISO code, e.g., USD, EUR, INR',
      'Human-friendly name, e.g., US Dollar, Euro',
      'Symbol used for display, e.g., $, €, ₹',
    ]) {
      assert.ok(screen.getByText(help), help)
    }
    assert.ok(screen.getByText(/Number of fraction digits to display \(0–8\)/))
    assert.ok(screen.getByText(/Relative to USD\. Used for conversions\./))
    // Create has no status control.
    assert.ok(screen.queryByRole('switch') === null, 'expected nothing')
    assert.ok(screen.getByRole('button', { name: 'Create Currency' }))
    assert.ok(screen.getByRole('button', { name: 'Cancel' }))

    type('Currency Code', 'gbp')
    assert.equal(field('Currency Code').value, 'GBP')
  })

  test('refuses an empty form with the legacy messages and focuses the first invalid field', async () => {
    const { onSubmit } = renderForm()
    type('Decimal Places', '')

    submit('Create Currency')

    await screen.findByText('Please enter currency code')
    assert.ok(screen.getByText('Please enter currency name'))
    assert.ok(screen.getByText('Please enter currency symbol'))
    assert.ok(screen.getByText('Please enter decimal places'))
    await waitFor(() => assert.ok(document.activeElement === field('Currency Code'), 'Currency Code has focus'))
    assert.equal(field('Currency Code').getAttribute('aria-invalid'), 'true')
    assert.equal(onSubmit.mock.calls.length, 0)
  })

  test('names a short code, a non-letter code, a fractional or out-of-range decimals and a tiny rate', async () => {
    const { onSubmit } = renderForm()
    type('Currency Name', 'Pound Sterling')
    type('Currency Symbol', '£')

    type('Currency Code', 'gb')
    submit('Create Currency')
    await screen.findByText('Currency code must be exactly 3 characters')

    type('Currency Code', 'g1p')
    await screen.findByText('Currency code must be 3 uppercase letters')

    type('Currency Code', 'gbp')
    // Enter skips NumberField's blur clamp, so the raw values reach the rules.
    fireEvent.change(field('Decimal Places'), { target: { value: '2.5' } })
    fireEvent.change(field('Exchange Rate (vs USD)'), { target: { value: '0.0000001' } })
    submit('Create Currency')
    await screen.findByText('Enter a whole number')
    assert.ok(screen.getByText('Exchange rate must be positive'))

    fireEvent.change(field('Decimal Places'), { target: { value: '9' } })
    submit('Create Currency')
    await screen.findByText('Decimal places must be between 0 and 8')
    assert.equal(onSubmit.mock.calls.length, 0)
  })

  test('submits the create values: the mounted fields only, no status, an empty rate left out', async () => {
    const { onSubmit } = renderForm()
    type('Currency Code', 'gbp')
    type('Currency Name', 'Pound Sterling')
    type('Currency Symbol', '£')
    type('Decimal Places', '0')

    submit('Create Currency')

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1))
    const sent = onSubmit.mock.calls[0][0] as Record<string, unknown>
    assert.deepEqual(sent, { code: 'GBP', name: 'Pound Sterling', symbol: '£', decimals: 0 })
    assert.deepEqual(Object.keys(sent), ['code', 'name', 'symbol', 'decimals'])
  })

  test('seeds an edit from its record, locks the code, and submits the status and rate', async () => {
    const { onSubmit } = renderForm({ currency: EUR })

    assert.equal(field('Currency Code').value, 'EUR')
    assert.equal(field('Currency Code').disabled, true)
    assert.equal(field('Currency Name').value, 'Euro')
    assert.equal(field('Currency Symbol').value, '€')
    assert.equal(field('Decimal Places').value, '2')
    assert.equal(field('Exchange Rate (vs USD)').value, '0.920000')
    const active = screen.getByRole('switch', { name: 'Active Status' })
    assert.equal(active.getAttribute('aria-checked'), 'true')

    type('Currency Name', 'Euro (EU)')
    fireEvent.click(active)
    submit('Update Currency')

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1))
    const sent = onSubmit.mock.calls[0][0] as Record<string, unknown>
    assert.deepEqual(sent, {
      code: 'EUR',
      name: 'Euro (EU)',
      symbol: '€',
      decimals: 2,
      exchangeRate: 0.92,
      isActive: false,
    })
    assert.deepEqual(Object.keys(sent), ['code', 'name', 'symbol', 'decimals', 'exchangeRate', 'isActive'])
  })

  test('a rate with more than six places submitted with Enter, before any blur, is sent at six places', async () => {
    const { onSubmit } = renderForm({ currency: EUR })
    const rate = field('Exchange Rate (vs USD)')
    fireEvent.focus(rate)
    fireEvent.change(rate, { target: { value: '1.1234567' } })
    // Enter submits the form from inside the field; the kit NumberField rounds only on blur.
    fireEvent.submit(rate.closest('form') as HTMLFormElement)

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1))
    assert.equal((onSubmit.mock.calls[0][0] as { exchangeRate?: number }).exchangeRate, 1.123457)
  })

  test('keeps a stored zero decimals and sends a cleared stored rate as null', async () => {
    const { onSubmit } = renderForm({ currency: JPY })
    assert.equal(field('Decimal Places').value, '0')
    assert.equal(screen.getByRole('switch', { name: 'Active Status' }).getAttribute('aria-checked'), 'false')

    type('Exchange Rate (vs USD)', '')
    submit('Update Currency')

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1))
    assert.deepEqual(onSubmit.mock.calls[0][0], {
      code: 'JPY',
      name: 'Japanese Yen',
      symbol: '¥',
      decimals: 0,
      exchangeRate: null,
      isActive: false,
    })
  })

  test('stays busy while the save runs and ignores a second submit; Cancel calls back', async () => {
    let finish: () => void = () => undefined
    const pending = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const { onCancel } = renderForm({ currency: EUR, onSubmit: pending })

    submit('Update Currency')
    await waitFor(() => assert.equal(pending.mock.calls.length, 1))
    const button = screen.getByRole('button', { name: 'Update Currency' })
    await waitFor(() => assert.equal(button.getAttribute('aria-busy'), 'true'))
    fireEvent.click(button)
    fireEvent.submit(button.closest('form') as HTMLFormElement)
    assert.equal(pending.mock.calls.length, 1)

    await act(async () => {
      finish()
    })
    await waitFor(() => assert.equal(button.getAttribute('aria-busy'), null))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(onCancel.mock.calls.length, 1)
  })

  test('the busy flag from the page also marks the submit', () => {
    renderForm({ loading: true })
    assert.equal(screen.getByRole('button', { name: 'Create Currency' }).getAttribute('aria-busy'), 'true')
  })
})
