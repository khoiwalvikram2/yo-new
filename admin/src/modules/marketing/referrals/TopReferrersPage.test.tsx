/**
 * /referrals/top-referrers mounted against MockedProvider and a MemoryRouter: the document exactly as
 * written, its options and the variables each filter sends (key order, IST day bounds), the RBAC
 * requirement and its denial, the totals, the table's cells, the server rank across pages and sorts, the
 * filter count and Clear all, Refresh, and the loading, empty and failed states. The guard and the period
 * field are stubs (the kit field has its own suite); everything else is real.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError, parse, print, type DocumentNode } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import TopReferrersPage from './TopReferrersPage'

const TOP_TEXT = 'query TopReferrers($limit: Int, $sortBy: String, $fromDate: String, $toDate: String) { topReferrers(limit: $limit, sortBy: $sortBy, fromDate: $fromDate, toDate: $toDate) { referrerId referrerName referrerPhone totalEarnings totalReferrals activeReferrals totalTransactions totalClicks conversionRate } }'

const apollo = vi.hoisted(() => ({ queries: [] as Array<{ query: unknown; options: unknown }> }))
const rbac = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ query: args[0], options: args[1] })
      return actual.useQuery(...args)
    },
  }
})

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: Array<{ domain: string; actions: string[] }>; children: ReactNode }) => {
    rbac.calls.push(required)
    return rbac.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency?: string) => `${currency} ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/ui/components/DateRangeField', () => ({
  DateRangeField: ({
    label,
    appliedPreset,
    appliedFrom,
    appliedTo,
    onApply,
    onReset,
  }: {
    label?: string
    appliedPreset: string
    appliedFrom?: string
    appliedTo?: string
    onApply: (payload: { kind: 'preset'; preset: string } | { kind: 'custom'; from: string; to: string }) => void
    onReset: () => void
  }) => (
    <fieldset>
      <legend>{label}</legend>
      <output data-testid="period-state">{`${appliedPreset}|${appliedFrom ?? ''}|${appliedTo ?? ''}`}</output>
      <button type="button" onClick={() => onApply({ kind: 'custom', from: '2026-10-01', to: '2026-10-05' })}>
        Apply custom range
      </button>
      <button type="button" onClick={onReset}>Reset period</button>
    </fieldset>
  ),
}))

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()
// The document's own source text, whitespace-normalised (what gate 10 compares), and its parsed form.
const sourceOf = (document: unknown) => normalise((document as DocumentNode).loc?.source.body ?? '')
const sent = (variables: unknown) => JSON.parse(JSON.stringify(variables ?? {}))

interface Referrer {
  __typename: 'TopReferrer'
  referrerId: number
  referrerName: string | null
  referrerPhone: string | null
  totalEarnings: number
  totalReferrals: number
  activeReferrals: number
  totalTransactions: number | null
  totalClicks: number | null
  conversionRate: number | null
}

function referrer(index: number, patch: Partial<Referrer> = {}): Referrer {
  return {
    __typename: 'TopReferrer',
    referrerId: 100 + index,
    referrerName: `Referrer ${index}`,
    referrerPhone: `98765${String(index).padStart(5, '0')}`,
    totalEarnings: 10000 - index * 100,
    totalReferrals: 60 - index,
    activeReferrals: 30 - index,
    totalTransactions: 1000 + index,
    totalClicks: 2000 + index,
    conversionRate: 15 - index * 0.5,
    ...patch,
  }
}

interface ServerState {
  rows: Referrer[]
  error: string | null
  calls: Array<Record<string, unknown>>
}

let server: ServerState

function mocks(): MockedResponse[] {
  return [{
    request: { query: parse(TOP_TEXT) },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.calls.push(sent(variables))
      return server.error
        ? { errors: [new GraphQLError(server.error)] }
        : { data: { topReferrers: server.rows } }
    },
  }]
}

function renderPage() {
  return render(
    <MockedProvider mocks={mocks()}>
      <MemoryRouter initialEntries={['/referrals/top-referrers']}>
        <PageEyebrowProvider value="Marketing">
          <TopReferrersPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table', { name: 'top referrers' })).getAllByRole('row').slice(1)
}

const cellTexts = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent)

beforeEach(() => {
  apollo.queries.length = 0
  rbac.allowed = true
  rbac.calls.length = 0
  server = {
    rows: Array.from({ length: 25 }, (_, index) => referrer(index + 1)),
    error: null,
    calls: [],
  }
})

describe('TopReferrersPage', () => {
  test('requires referrals.top-referrers view, and a denied caller starts no query', () => {
    rbac.allowed = false
    renderPage()
    assert.equal(screen.getByRole('alert').textContent, 'Access denied')
    assert.deepEqual(rbac.calls[0], [{ domain: 'referrals.top-referrers', actions: ['view'] }])
    assert.equal(apollo.queries.length, 0)
  })

  test('the document unchanged, errorPolicy all, top 50 by earnings over every date', async () => {
    renderPage()
    assert.ok(screen.getByText('Loading top referrers'))
    await screen.findByText('Referrer 1')
    const call = apollo.queries[0]
    assert.equal(sourceOf(call.query), TOP_TEXT)
    assert.equal(print(call.query as DocumentNode), print(parse(TOP_TEXT)))
    assert.deepEqual(call.options, {
      variables: { limit: 50, sortBy: 'earnings', fromDate: undefined, toDate: undefined },
      errorPolicy: 'all',
    })
    assert.deepEqual(server.calls, [{ limit: 50, sortBy: 'earnings' }])
  })

  test('the header, the totals and the card head', async () => {
    renderPage()
    await screen.findByText('Referrer 1')
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Top Referrers')
    assert.ok(screen.queryByText('Track top performing referrers and their statistics') === null)
    assert.ok(screen.queryByText('Marketing') === null)
    assert.equal(screen.getByRole('link', { name: 'Back to Referrals' }).getAttribute('href'), '/referrals')
    assert.equal(screen.getByRole('heading', { level: 2 }).textContent, 'Top Referrers (25)')
    const earnings = server.rows.reduce((sum, row) => sum + row.totalEarnings, 0)
    const referrals = server.rows.reduce((sum, row) => sum + row.totalReferrals, 0)
    assert.ok(screen.getByText(`Total earnings: INR ${earnings.toFixed(2)}`))
    const totals = screen.getByRole('group', { name: 'Top referrer totals' }).textContent ?? ''
    assert.ok(totals.includes(`Total EarningsINR ${earnings.toFixed(2)}`))
    assert.ok(totals.includes(`Total Referrals${referrals}`))
    assert.ok(totals.includes('Referrers25'))
  })

  test('the cells, twenty a page, and the rank continuing on page 2', async () => {
    renderPage()
    await screen.findByText('Referrer 1')
    const rows = bodyRows()
    assert.equal(rows.length, 20)
    assert.deepEqual(cellTexts(rows[0]), [
      '#1',
      `Referrer 19876500001ID: 101 · View stats`,
      '59',
      '29/ 59',
      'INR 9900.00',
      (2001).toLocaleString(),
      '14.50%',
      (1001).toLocaleString(),
    ])
    assert.equal(within(rows[0]).getByRole('link', { name: 'ID: 101 · View stats' }).getAttribute('href'), '/referrals/referrers/101')
    assert.ok(screen.getByText('Total 25 referrers'))

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(bodyRows().length, 5))
    assert.equal(cellTexts(bodyRows()[0])[0], '#21')
  })

  test('a column sort reorders every row and each keeps its rank; Total Earnings ascending', async () => {
    renderPage()
    await screen.findByText('Referrer 1')
    fireEvent.click(screen.getByRole('button', { name: 'Total Earnings' }))
    assert.equal(screen.getByRole('columnheader', { name: 'Total Earnings' }).getAttribute('aria-sort'), 'ascending')
    assert.deepEqual(cellTexts(bodyRows()[0]).slice(0, 1), ['#25'])
    assert.equal(cellTexts(bodyRows()[0])[4], 'INR 7500.00')
  })

  test('Sort By and Limit send their values, count as filters, and Clear all restores the defaults', async () => {
    renderPage()
    await screen.findByText('Referrer 1')
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort By' }), { target: { value: 'conversion' } })
    await waitFor(() => assert.deepEqual(server.calls.at(-1), { limit: 50, sortBy: 'conversion' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Limit' }), { target: { value: '100' } })
    await waitFor(() => assert.deepEqual(server.calls.at(-1), { limit: 100, sortBy: 'conversion' }))
    assert.ok(screen.getByText('2 filters applied'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.ok(screen.getByText('0 filters applied')))
    assert.equal((screen.getByRole('combobox', { name: 'Sort By' }) as HTMLSelectElement).value, 'earnings')
    assert.equal((screen.getByRole('combobox', { name: 'Limit' }) as HTMLSelectElement).value, '50')
  })

  test('a custom period sends IST day bounds and returns the table to page 1 with no sort', async () => {
    renderPage()
    await screen.findByText('Referrer 1')
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Total Referrals' }))

    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }))
    await waitFor(() => assert.deepEqual(server.calls.at(-1), {
      limit: 50,
      sortBy: 'earnings',
      fromDate: '2026-09-30T18:30:00.000Z',
      toDate: '2026-10-05T18:29:59.999Z',
    }))
    assert.equal(screen.getByTestId('period-state').textContent, 'custom|2026-10-01|2026-10-05')
    await waitFor(() => assert.equal(bodyRows().length, 20))
    assert.equal(cellTexts(bodyRows()[0])[0], '#1')
    assert.equal(screen.getByRole('columnheader', { name: 'Total Referrals' }).getAttribute('aria-sort'), 'none')
    assert.ok(screen.getByText('1 filter applied'))
  })

  test('empty: the unfiltered and the filtered text, with no totals and no pager', async () => {
    server.rows = []
    renderPage()
    await screen.findByText('No referrers data available')
    assert.equal(screen.queryByRole('group', { name: 'Top referrer totals' }), null)
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)
    assert.equal(screen.getByRole('heading', { level: 2 }).textContent, 'Top Referrers (0)')

    fireEvent.change(screen.getByRole('combobox', { name: 'Limit' }), { target: { value: '25' } })
    await screen.findByText('No referrers match your filters')
  })

  test('a failed request shows the error notice, and Close dismisses it', async () => {
    server.error = 'Referral service unavailable'
    renderPage()
    await screen.findByText('Could not load top referrers')
    assert.ok(screen.getByText('Referral service unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    assert.ok(screen.queryByText('Could not load top referrers') === null)
  })

  test('Refresh asks the server again', async () => {
    renderPage()
    await screen.findByText('Referrer 1')
    const before = server.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(server.calls.length, before + 1))
  })
})
