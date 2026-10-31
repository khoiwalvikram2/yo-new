import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { ADMIN_PAYOUT_ACCOUNT_STATS } from '@/lib/graphql/payoutAccounts'
import { PayoutAccountsStatsCards } from './PayoutAccountsStatsCards'

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return { ...actual, useQuery: mocks.useQuery }
})

const DATA = { adminPayoutAccountStats: { total: 7, pending: 3, approved: 3, rejected: 1, approvalRate: 43, rejectionRate: 14 } }

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

describe('PayoutAccountsStatsCards', () => {
  test('refreshes aggregates after the parent queue is refreshed', () => {
    const refetch = vi.fn().mockResolvedValue({ data: DATA })
    mocks.useQuery.mockReturnValue({ data: DATA, loading: false, refetch })
    const view = render(<PayoutAccountsStatsCards />)
    assert.equal(refetch.mock.calls.length, 0)
    view.rerender(<PayoutAccountsStatsCards revision={1} />)
    assert.equal(refetch.mock.calls.length, 1)
    view.rerender(<PayoutAccountsStatsCards revision={1} />)
    assert.equal(refetch.mock.calls.length, 1)
  })

  test('reports an unavailable summary instead of presenting zero financial figures', () => {
    mocks.useQuery.mockReturnValue({ loading: false, error: { message: 'Read failed' }, refetch: vi.fn() })
    render(<PayoutAccountsStatsCards />)
    assert.ok(screen.getByText('Statistics unavailable'))
    assert.ok(screen.getByText('Read failed'))
    assert.ok(screen.getByText('Retry stats'))
  })

  test('keeps its independent all-accounts query and renders full-scope server aggregates', () => {
    render(<PayoutAccountsStatsCards />)

    const [document, options] = mocks.useQuery.mock.calls[0]
    assert.ok(document === ADMIN_PAYOUT_ACCOUNT_STATS)
    assert.deepEqual(options, {
      errorPolicy: 'all', fetchPolicy: 'cache-and-network', pollInterval: 15000,
    })
    assert.deepEqual(Object.keys(options).sort(), ['errorPolicy', 'fetchPolicy', 'pollInterval'])

    assert.ok(screen.getByRole('group', { name: 'Payout account statistics' }))
    assert.ok(within(stat('Pending')).getByText('3'))
    assert.ok(within(stat('Pending')).getByText('Awaiting review'))
    assert.ok(within(stat('Approved')).getByText('3'))
    assert.ok(within(stat('Approved')).getByText('43% rate'))
    assert.ok(within(stat('Rejected')).getByText('1'))
    assert.ok(within(stat('Rejected')).getByText('14%'))
    assert.ok(within(stat('Approval Rate')).getByText('43%'))
    assert.ok(within(stat('Approval Rate')).getByText('3 of 7'), 'the denominator is the complete aggregate total')
  })

  test('holds the four cards as placeholders until the first answer, then keeps stale figures through a refetch', () => {
    mocks.useQuery.mockReturnValue({ data: undefined, loading: true })
    const view = render(<PayoutAccountsStatsCards />)

    const group = screen.getByRole('group', { name: 'Payout account statistics' })
    assert.equal(group.getAttribute('aria-busy'), 'true')
    for (const label of ['Pending', 'Approved', 'Rejected', 'Approval Rate']) {
      assert.equal(stat(label).getAttribute('aria-busy'), 'true', `${label} is a placeholder`)
    }
    assert.equal(screen.queryByText('3 of 7'), null)

    mocks.useQuery.mockReturnValue({ data: DATA, loading: true })
    view.rerender(<PayoutAccountsStatsCards />)

    assert.equal(group.getAttribute('aria-busy'), null)
    assert.equal(stat('Pending').getAttribute('aria-busy'), null)
    assert.ok(within(stat('Pending')).getByText('3'))
    assert.ok(within(stat('Approval Rate')).getByText('3 of 7'))
  })

  test('keeps the empty-result copy and zero rates', () => {
    mocks.useQuery.mockReturnValue({ data: { adminPayoutAccountStats: { total: 0, pending: 0, approved: 0, rejected: 0, approvalRate: 0, rejectionRate: 0 } }, loading: false })
    render(<PayoutAccountsStatsCards />)

    assert.equal(screen.getAllByText('—').length, 2, 'Pending and Rejected show a dash')
    assert.ok(screen.getByText('0% rate'))
    assert.ok(screen.getByText('0%'))
    assert.ok(screen.getByText('0 of 0'))
  })

  test('renders zeros when the query returned no data at all', () => {
    mocks.useQuery.mockReturnValue({ data: undefined, loading: false })
    render(<PayoutAccountsStatsCards />)

    assert.ok(within(stat('Pending')).getByText('0'))
    assert.ok(within(stat('Approval Rate')).getByText('0 of 0'))
  })
})
