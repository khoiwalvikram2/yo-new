/**
 * The currency converter against a mocked ConvertCurrency query: the legacy defaults, the exact variables,
 * the figures in each currency's decimals and the six-place rate, Swap, the reason Convert is unavailable
 * (the legacy warnings), a stale result cleared by an input change, and the error message.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { CONVERT_CURRENCY } from '@/lib/graphql/currency'
import type { Currency } from '@/shared/types/currency'
import { CurrencyConverter } from './CurrencyConverter'

const feedback = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => () => undefined),
}))

vi.mock('@/shared/services/notification', () => ({ notify: feedback }))

const USD: Currency = { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, isActive: true, exchangeRate: 1 }
const INR: Currency = { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 83.12 }
const JPY: Currency = { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, isActive: false, exchangeRate: 149.5 }
const EUR: Currency = { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, isActive: true, exchangeRate: 0.92 }

interface ConvertInput {
  amount: number
  from: string
  to: string
}

let sent: ConvertInput[] = []

function convertMock(rate: number): MockedResponse {
  return {
    request: { query: CONVERT_CURRENCY },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      const input = variables.input as ConvertInput
      sent.push(input)
      return {
        data: {
          convertCurrency: {
            __typename: 'CurrencyConversion',
            convertedAmount: input.amount * rate,
            rate,
            timestamp: '2026-10-07T00:00:00.000Z',
          },
        },
      }
    },
  }
}

function failingMock(): MockedResponse {
  return {
    request: { query: CONVERT_CURRENCY },
    variableMatcher: () => true,
    error: new Error('Network down'),
  }
}

function renderConverter(currencies: Currency[], mocks: MockedResponse[] = [convertMock(83.12)]) {
  return render(
    <MockedProvider mocks={mocks}>
      <CurrencyConverter currencies={currencies} />
    </MockedProvider>,
  )
}

const amountField = () => screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement
const fromField = () => screen.getByRole('combobox', { name: 'From' }) as HTMLInputElement
const toField = () => screen.getByRole('combobox', { name: 'To' }) as HTMLInputElement
const convertButton = () => screen.getByRole('button', { name: 'Convert' })

beforeEach(() => {
  sent = []
  feedback.error.mockReset()
  feedback.warning.mockReset()
})

describe('CurrencyConverter', () => {
  test('defaults to USD to INR with 1, converts with the exact variables and shows the legacy figures', async () => {
    renderConverter([EUR, USD, JPY, INR])

    await waitFor(() => assert.equal(fromField().value, 'USD - US Dollar'))
    assert.equal(toField().value, 'INR - Indian Rupee')
    assert.equal(amountField().value, '1')
    assert.equal(amountField().placeholder, 'Enter amount')
    assert.equal(convertButton().getAttribute('aria-disabled'), null)

    fireEvent.click(convertButton())

    await screen.findByText('1 USD = 83.120000 INR')
    assert.deepEqual(sent, [{ amount: 1, from: 'USD', to: 'INR' }])
    assert.ok(screen.getByText('$1.00'))
    assert.ok(screen.getByText('₹83.12'))
    assert.equal(feedback.error.mock.calls.length, 0)
  })

  test('falls back to the first two currencies and formats each side in its own decimals', async () => {
    renderConverter([JPY, EUR], [convertMock(0.0061)])

    await waitFor(() => assert.equal(fromField().value, 'JPY - Japanese Yen'))
    assert.equal(toField().value, 'EUR - Euro')

    fireEvent.change(amountField(), { target: { value: '1500' } })
    fireEvent.click(convertButton())

    await screen.findByText('1 JPY = 0.006100 EUR')
    assert.deepEqual(sent, [{ amount: 1500, from: 'JPY', to: 'EUR' }])
    assert.ok(screen.getByText('¥1500'))
    assert.ok(screen.getByText('€9.15'))
  })

  test('Swap exchanges the currencies and clears the result; changing the amount clears it too', async () => {
    renderConverter([USD, INR])
    await waitFor(() => assert.equal(fromField().value, 'USD - US Dollar'))

    fireEvent.click(convertButton())
    await screen.findByText('1 USD = 83.120000 INR')

    fireEvent.click(screen.getByRole('button', { name: 'Swap currencies' }))
    assert.equal(fromField().value, 'INR - Indian Rupee')
    assert.equal(toField().value, 'USD - US Dollar')
    assert.ok(screen.queryByText(/^1 USD =/) === null, 'expected nothing')

    fireEvent.click(convertButton())
    await screen.findByText('1 INR = 83.120000 USD')
    assert.deepEqual(sent.at(-1), { amount: 1, from: 'INR', to: 'USD' })

    fireEvent.change(amountField(), { target: { value: '2' } })
    assert.ok(screen.queryByText(/^1 INR =/) === null, 'expected nothing')
  })

  test('says why Convert is unavailable, in the legacy warnings, and runs nothing', async () => {
    renderConverter([USD, INR])
    await waitFor(() => assert.equal(fromField().value, 'USD - US Dollar'))

    fireEvent.change(amountField(), { target: { value: '' } })
    assert.equal(convertButton().getAttribute('aria-disabled'), 'true')
    const hint = screen.getByText('Please enter amount and select both currencies')
    assert.ok(convertButton().getAttribute('aria-describedby')?.includes(hint.id))
    fireEvent.click(convertButton())
    assert.equal(sent.length, 0)

    fireEvent.change(amountField(), { target: { value: '5' } })
    fireEvent.click(toField(), { detail: 1 })
    fireEvent.click(screen.getByRole('option', { name: 'USD - US Dollar' }))
    await waitFor(() => assert.equal(toField().value, 'USD - US Dollar'))
    assert.ok(screen.getByText('Please select different currencies for conversion'))
    assert.equal(convertButton().getAttribute('aria-disabled'), 'true')
  })

  test('reports a failed conversion with the legacy message', async () => {
    renderConverter([USD, INR], [failingMock()])
    await waitFor(() => assert.equal(fromField().value, 'USD - US Dollar'))

    fireEvent.click(convertButton())

    await waitFor(() => assert.equal(feedback.error.mock.calls.length, 1))
    assert.deepEqual(feedback.error.mock.calls[0], ['Failed to convert currency. Please try again.'])
    assert.ok(screen.queryByText(/^1 USD =/) === null, 'expected nothing')
  })

  test('offers nothing to convert without currencies, and Swap stays unavailable', () => {
    renderConverter([])
    assert.equal(fromField().value, '')
    assert.equal(screen.getByRole('button', { name: 'Swap currencies' }).getAttribute('aria-disabled'), 'true')
    assert.equal(convertButton().getAttribute('aria-disabled'), 'true')
  })
})
