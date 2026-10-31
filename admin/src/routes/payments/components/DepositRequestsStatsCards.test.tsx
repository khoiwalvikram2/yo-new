import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DepositRequestsStatsCards } from './DepositRequestsStatsCards'

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

const DATA = { adminDepositRequestStats: { totalRequests: 6, pending: 1, approved: 2, rejected: 2, totalAmount: 30.5, approvalRate: 33, rejectionRate: 33 } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQuery.mockReturnValue({ data: DATA, loading: false })
})

afterEach(cleanup)

describe('DepositRequestsStatsCards', () => {
  test('refreshes aggregates after the parent queue is refreshed', () => {
    const refetch = vi.fn().mockResolvedValue({ data: DATA })
    mocks.useQuery.mockReturnValue({ data: DATA, loading: false, refetch })
    const view = render(<DepositRequestsStatsCards />)
    assert.equal(refetch.mock.calls.length, 0)
    view.rerender(<DepositRequestsStatsCards revision={1} />)
    assert.equal(refetch.mock.calls.length, 1)
    view.rerender(<DepositRequestsStatsCards revision={1} />)
    assert.equal(refetch.mock.calls.length, 1)
  })

  test('reports an unavailable summary instead of presenting zero financial figures', () => {
    mocks.useQuery.mockReturnValue({ loading: false, error: { message: 'Read failed' }, refetch: vi.fn() })
    render(<DepositRequestsStatsCards />)
    assert.ok(screen.getByText('Statistics unavailable'))
    assert.ok(screen.getByText('Read failed'))
    assert.ok(screen.getByText('Retry stats'))
  })

  test('renders a complete total above the old 1000-row cap', () => {
    mocks.useQuery.mockReturnValue({ data: { adminDepositRequestStats: { totalRequests: 2256, pending: 24, approved: 2000, rejected: 200, totalAmount: 50000, approvalRate: 89, rejectionRate: 9 } }, loading: false })
    render(<DepositRequestsStatsCards />)
    assert.ok(screen.getByText('2256 total requests'))
    assert.ok(screen.getByText('2000 of 2256'))
  })

  test('keeps its independent all-requests document/options and renders full-scope server aggregates', () => {
    render(<DepositRequestsStatsCards />)

    const [document, options] = mocks.useQuery.mock.calls[0]
    assert.equal(document.definitions[0].name.value, 'AdminDepositRequestStats')
    assert.deepEqual(options, {
      errorPolicy: 'all', fetchPolicy: 'cache-and-network', pollInterval: 15000,
    })
    assert.deepEqual(Object.keys(options).sort(), ['errorPolicy', 'fetchPolicy', 'pollInterval'])

    assert.ok(screen.getByLabelText('Deposit request statistics'))
    assert.ok(screen.getByText('Pending'))
    assert.ok(screen.getByText('1'))
    assert.ok(screen.getByText('6 total requests'))
    assert.ok(screen.getByText('Approved'))
    assert.equal(screen.getAllByText('2').length, 2)
    assert.ok(screen.getByText('AMT:305'))
    assert.ok(screen.getByText('Rejected'))
    assert.ok(screen.getByText('33% of total'))
    assert.ok(screen.getByText('Approval Rate'))
    assert.ok(screen.getByText('33%'))
    assert.ok(screen.getByText('2 of 6'))

    assert.deepEqual(mocks.convert.mock.calls, [[30.5]])
    assert.deepEqual(mocks.formatAmount.mock.calls, [[305]])
  })

  test('holds the four cards as placeholders until the first answer, then keeps stale figures through a refetch', () => {
    mocks.useQuery.mockReturnValue({ data: undefined, loading: true })
    const view = render(<DepositRequestsStatsCards />)

    const grid = screen.getByLabelText('Deposit request statistics')
    assert.equal(grid.getAttribute('aria-busy'), 'true')
    assert.equal(grid.querySelectorAll('[aria-busy="true"]').length, 4, 'every card is a placeholder')
    assert.ok(screen.getByText('Approval Rate'))
    assert.equal(screen.queryByText('6 total requests'), null)

    mocks.useQuery.mockReturnValue({ data: DATA, loading: true })
    view.rerender(<DepositRequestsStatsCards />)

    assert.equal(grid.getAttribute('aria-busy'), null)
    assert.equal(grid.querySelectorAll('[aria-busy="true"]').length, 0)
    assert.ok(screen.getByText('6 total requests'))
    assert.ok(screen.getByText('AMT:305'))
    assert.ok(screen.getByText('2 of 6'))
  })

  test('keeps empty-result copy and zero rates while still converting the approved-only zero once', () => {
    mocks.useQuery.mockReturnValue({
      data: { adminDepositRequestStats: { totalRequests: 0, pending: 0, approved: 0, rejected: 0, totalAmount: 0, approvalRate: 0, rejectionRate: 0 } },
      loading: false,
    })
    render(<DepositRequestsStatsCards />)

    assert.ok(screen.getByText('0 total requests'))
    assert.ok(screen.getByText('—'))
    assert.ok(screen.getByText('0%'))
    assert.ok(screen.getByText('0 of 0'))
    assert.deepEqual(mocks.convert.mock.calls, [[0]])
    assert.deepEqual(mocks.formatAmount.mock.calls, [[0]])
  })
})
