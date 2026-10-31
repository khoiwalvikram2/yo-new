import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { WithdrawalRequestsStatsCards } from './WithdrawalRequestsStatsCards'

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  convert: vi.fn((value: number) => value * 10),
  formatAmount: vi.fn((value: number) => `AMT:${value}`),
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return { ...actual, useQuery: mocks.useQuery }
})

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: mocks.convert,
    formatAmount: mocks.formatAmount,
  }),
}))

const DATA = { adminWithdrawalRequestStats: { totalRequests: 7, pending: 2, processing: 1, completed: 2, failed: 1, totalAmount: 30.5, completionRate: 29, failureRate: 14 } }

function stat(label: string): HTMLElement {
  const labelNode = screen.getByText(label)
  const card = labelNode.parentElement?.parentElement
  assert.ok(card, `Expected a stat for ${label}`)
  return card
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQuery.mockReturnValue({ data: DATA, loading: false })
})

afterEach(cleanup)

describe('WithdrawalRequestsStatsCards', () => {
  test('refreshes aggregates after the parent queue is refreshed', () => {
    const refetch = vi.fn().mockResolvedValue({ data: DATA })
    mocks.useQuery.mockReturnValue({ data: DATA, loading: false, refetch })
    const view = render(<WithdrawalRequestsStatsCards />)
    assert.equal(refetch.mock.calls.length, 0)
    view.rerender(<WithdrawalRequestsStatsCards revision={1} />)
    assert.equal(refetch.mock.calls.length, 1)
    view.rerender(<WithdrawalRequestsStatsCards revision={1} />)
    assert.equal(refetch.mock.calls.length, 1)
  })

  test('reports an unavailable summary instead of presenting zero financial figures', () => {
    mocks.useQuery.mockReturnValue({ loading: false, error: { message: 'Read failed' }, refetch: vi.fn() })
    render(<WithdrawalRequestsStatsCards />)
    assert.ok(screen.getByText('Statistics unavailable'))
    assert.ok(screen.getByText('Read failed'))
    assert.ok(screen.getByText('Retry stats'))
  })

  test('keeps its independent all-requests document and options and renders full-scope server aggregates', () => {
    render(<WithdrawalRequestsStatsCards />)

    const [document, options] = mocks.useQuery.mock.calls[0]
    assert.equal(document.definitions[0].name.value, 'AdminWithdrawalRequestStats')
    assert.deepEqual(options, {
      errorPolicy: 'all', fetchPolicy: 'cache-and-network', pollInterval: 15000,
    })
    assert.deepEqual(Object.keys(options).sort(), ['errorPolicy', 'fetchPolicy', 'pollInterval'])

    assert.ok(screen.getByLabelText('Withdrawal request statistics'))
    assert.ok(within(stat('Pending')).getByText('2'))
    assert.ok(within(stat('Pending')).getByText('1 processing'))
    assert.ok(within(stat('Completed')).getByText('2'))
    assert.ok(within(stat('Completed')).getByText('AMT:305'))
    assert.ok(within(stat('Failed')).getByText('1'))
    assert.ok(within(stat('Failed')).getByText('14% of total'))
    assert.ok(within(stat('Completion Rate')).getByText('29%'))
    assert.ok(within(stat('Completion Rate')).getByText('2 of 7'))

    assert.deepEqual(mocks.convert.mock.calls, [[30.5]])
    assert.deepEqual(mocks.formatAmount.mock.calls, [[305]])
  })

  test('holds the four cards as placeholders until the first answer, then keeps stale figures through a refetch', () => {
    mocks.useQuery.mockReturnValue({ data: undefined, loading: true })
    const view = render(<WithdrawalRequestsStatsCards />)

    const grid = screen.getByLabelText('Withdrawal request statistics')
    assert.equal(grid.getAttribute('aria-busy'), 'true')
    for (const label of ['Pending', 'Completed', 'Failed', 'Completion Rate']) {
      assert.equal(stat(label).getAttribute('aria-busy'), 'true', `${label} is a placeholder`)
    }
    assert.equal(screen.queryByText('2 of 7'), null)

    mocks.useQuery.mockReturnValue({ data: DATA, loading: true })
    view.rerender(<WithdrawalRequestsStatsCards />)

    assert.equal(grid.getAttribute('aria-busy'), null)
    assert.equal(stat('Pending').getAttribute('aria-busy'), null)
    assert.ok(within(stat('Pending')).getByText('2'))
    assert.ok(within(stat('Completed')).getByText('AMT:305'))
    assert.ok(within(stat('Completion Rate')).getByText('2 of 7'))
  })

  test('keeps the empty-result copy and zero rates while still converting the completed-only zero once', () => {
    mocks.useQuery.mockReturnValue({
      data: { adminWithdrawalRequestStats: { totalRequests: 0, pending: 0, processing: 0, completed: 0, failed: 0, totalAmount: 0, completionRate: 0, failureRate: 0 } },
      loading: false,
    })
    render(<WithdrawalRequestsStatsCards />)

    assert.ok(screen.getByText('0 processing'))
    assert.ok(screen.getByText('—'))
    assert.ok(screen.getByText('0%'))
    assert.ok(screen.getByText('0 of 0'))
    assert.deepEqual(mocks.convert.mock.calls, [[0]])
    assert.deepEqual(mocks.formatAmount.mock.calls, [[0]])
  })
})
