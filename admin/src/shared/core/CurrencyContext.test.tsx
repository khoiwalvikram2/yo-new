/**
 * formatAmount takes an optional third argument, { fractionDigits }, so one caller (the dashboard's
 * "Exposure by market" card, which prints whole units) can override the currency's decimals without
 * changing what any other caller gets. These pin both halves: the override applies in every branch
 * (a known currency, an unknown code, and the null/NaN fallback), and without it nothing changes.
 * The provider runs signed out, so the currencies query is skipped and it falls back to INR (₹, two
 * decimals); the whitelabel locale is stubbed per test.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { CurrencyProvider, useCurrency } from './CurrencyContext'

const appConfig = vi.hoisted(() => ({ defaultLocale: 'en_US' }))

vi.mock('./AppConfigProvider', () => ({
  useAppConfig: () => ({
    baseCurrency: 'INR',
    timeZone: 'Asia/Kolkata',
    defaultLocale: appConfig.defaultLocale,
    loading: false,
    appConfig: null,
  }),
}))

function renderCurrency(): ReturnType<typeof useCurrency> {
  let captured: ReturnType<typeof useCurrency> | undefined
  function Capture() {
    captured = useCurrency()
    return null
  }
  render(
    <MockedProvider mocks={[]}>
      <CurrencyProvider>
        <Capture />
      </CurrencyProvider>
    </MockedProvider>
  )
  assert.ok(captured)
  return captured
}

describe('CurrencyContext formatAmount', () => {
  beforeEach(() => {
    appConfig.defaultLocale = 'en_US'
  })

  test('without options, prints the currency decimals as before', () => {
    const { formatAmount } = renderCurrency()
    assert.equal(formatAmount(1234567.891), '₹1,234,567.89')
    assert.equal(formatAmount(1234567.891, 'XYZ'), '1,234,567.89')
    assert.equal(formatAmount(Number.NaN), '₹0.00')
    assert.equal(formatAmount(null as unknown as number), '₹0.00')
  })

  test('fractionDigits: 0 prints whole units in every branch', () => {
    const { formatAmount } = renderCurrency()
    const whole = { fractionDigits: 0 }
    assert.equal(formatAmount(1234567.891, undefined, whole), '₹1,234,568')
    assert.equal(formatAmount(1234567.891, 'INR', whole), '₹1,234,568')
    // an unknown code keeps its no-symbol fallback, in whole units
    assert.equal(formatAmount(1234567.891, 'XYZ', whole), '1,234,568')
    // null and NaN print the symbol and a bare 0, with no decimal part
    assert.equal(formatAmount(Number.NaN, undefined, whole), '₹0')
    assert.equal(formatAmount(undefined as unknown as number, undefined, whole), '₹0')
  })

  test('fractionDigits overrides the currency decimals the other way too', () => {
    const { formatAmount } = renderCurrency()
    assert.equal(formatAmount(1234.5678, undefined, { fractionDigits: 3 }), '₹1,234.568')
    assert.equal(formatAmount(Number.NaN, undefined, { fractionDigits: 1 }), '₹0.0')
    // an empty options object changes nothing
    assert.equal(formatAmount(1234.5678, undefined, {}), '₹1,234.57')
  })

  test('whole units follow the whitelabel locale, lakh grouping included', () => {
    appConfig.defaultLocale = 'en_IN'
    const { formatAmount } = renderCurrency()
    assert.equal(formatAmount(999999999, undefined, { fractionDigits: 0 }), '₹99,99,99,999')
    assert.equal(formatAmount(43710300.4, undefined, { fractionDigits: 0 }), '₹4,37,10,300')
    assert.equal(formatAmount(43710300.4), '₹4,37,10,300.40')
  })
})
