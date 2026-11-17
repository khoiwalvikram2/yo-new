/**
 * The currency mutations refetch the panel's own currency list as well as the management page's. CurrencyContext's
 * `Currencies` drives the topbar's currency choice and every formatAmount / convertAmount; after a rate change or an
 * activation it stayed as it was until a reload, because only the page's `GetCurrencies` was refetched.
 */
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { describe, test } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { gql, useQuery, type DocumentNode } from '@apollo/client'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { ACTIVATE_CURRENCY, UPDATE_EXCHANGE_RATES } from '@/lib/graphql/currency'
import { useCurrencyActions } from './useCurrency'

/** The two lists, by operation name: the management page's (routes/currency/currencyQueries.ts) and CurrencyContext's. */
const PAGE_LIST = gql`query GetCurrencies { currencies(includeInactive: true) { code isActive exchangeRate } }`
const PANEL_LIST = gql`query Currencies { currencies { code isActive exchangeRate } }`

const LIST = [
  { __typename: 'Currency', code: 'INR', isActive: true, exchangeRate: 1 },
  { __typename: 'Currency', code: 'USD', isActive: true, exchangeRate: 0.012 },
]

function counted(query: DocumentNode, counter: { n: number }): MockedResponse {
  return {
    request: { query },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      counter.n += 1
      return { data: { currencies: LIST } }
    },
  }
}

function renderActions(extra: MockedResponse[]) {
  const page = { n: 0 }
  const panel = { n: 0 }
  const mocks = [counted(PAGE_LIST, page), counted(PANEL_LIST, panel), ...extra]
  const wrapper = ({ children }: { children: ReactNode }) => <MockedProvider mocks={mocks}>{children}</MockedProvider>
  const view = renderHook(() => {
    useQuery(PAGE_LIST)
    useQuery(PANEL_LIST)
    return useCurrencyActions()
  }, { wrapper })
  return { ...view, page, panel }
}

describe('useCurrencyActions', () => {
  test('activating a currency refetches the page list and the panel list', async () => {
    const { result, page, panel } = renderActions([{
      request: { query: ACTIVATE_CURRENCY, variables: { code: 'USD' } },
      result: { data: { activateCurrency: { __typename: 'CurrencyOperationResult', success: true, message: 'Activated', currency: { __typename: 'Currency', code: 'USD', isActive: true } } } },
    }])
    await waitFor(() => assert.ok(page.n === 1 && panel.n === 1, 'both lists load once'))

    await act(async () => { await result.current.activateCurrency('USD') })

    await waitFor(() => assert.equal(panel.n, 2, 'the panel list (CurrencyContext) was not refetched'))
    assert.equal(page.n, 2, 'the page list was not refetched')
  })

  test('a rate update refetches the panel list, so display conversions use the new rate', async () => {
    const input = { rates: [{ currency: 'USD', rate: 0.013 }] }
    const { result, page, panel } = renderActions([{
      request: { query: UPDATE_EXCHANGE_RATES, variables: { input } },
      result: { data: { updateExchangeRates: { __typename: 'ExchangeRateUpdateResult', success: true, message: 'Updated', updatedRates: [{ __typename: 'Currency', code: 'USD', name: 'US Dollar', exchangeRate: 0.013 }] } } },
    }])
    await waitFor(() => assert.ok(page.n === 1 && panel.n === 1, 'both lists load once'))

    await act(async () => { await result.current.updateExchangeRates(input) })

    await waitFor(() => assert.equal(panel.n, 2, 'the panel list (CurrencyContext) was not refetched'))
    assert.equal(page.n, 2)
  })
})
