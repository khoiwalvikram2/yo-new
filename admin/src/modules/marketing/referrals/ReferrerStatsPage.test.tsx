/**
 * /referrals/referrers/:referrerId mounted against MockedProvider and a MemoryRouter: both documents
 * exactly as written with their options and variables (the route id, the period's IST bounds), the RBAC
 * requirement and its denial, the header during loading, the referrer facts, the four figures, the rule
 * table, Refresh, and the not-found, failed and empty states. The guard and the period field are stubs
 * (the kit field has its own suite); everything else is real.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError, parse, print, type DocumentNode } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import cardStyles from '@/ui/components/Card.module.css'
import ReferrerStatsPage from './ReferrerStatsPage'
import styles from './ReferrerStatsPage.module.css'

const STATS_TEXT = 'query ReferrerStats($referrerId: ID!, $fromDate: String, $toDate: String) { referrerStats(referrerId: $referrerId, fromDate: $fromDate, toDate: $toDate) { referrerId totalEarnings grossEarnings totalReferrals activeReferrals totalTransactions totalClicks totalAttributions conversionRate earningsByRuleType { ruleType totalEarnings count } } }'
const USER_TEXT = 'query User($id: ID!) { user(id: $id) { id name email phone username } }'

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
// The document's own source text, whitespace-normalised (what gate 10 compares).
const sourceOf = (document: unknown) => normalise((document as DocumentNode).loc?.source.body ?? '')
const sent = (variables: unknown) => JSON.parse(JSON.stringify(variables ?? {}))

interface ServerState {
  stats: Record<string, unknown> | null
  user: Record<string, unknown> | null
  statsError: string | null
  statsCalls: Array<Record<string, unknown>>
  userCalls: Array<Record<string, unknown>>
}

let server: ServerState

function mocks(): MockedResponse[] {
  return [
    {
      request: { query: parse(STATS_TEXT) },
      variableMatcher: () => true,
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: (variables: Record<string, unknown>) => {
        server.statsCalls.push(sent(variables))
        return server.statsError
          ? { errors: [new GraphQLError(server.statsError)] }
          : { data: { referrerStats: server.stats } }
      },
    },
    {
      request: { query: parse(USER_TEXT) },
      variableMatcher: () => true,
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: (variables: Record<string, unknown>) => {
        server.userCalls.push(sent(variables))
        return { data: { user: server.user } }
      },
    },
  ]
}

function renderPage() {
  return render(
    <MockedProvider mocks={mocks()}>
      <MemoryRouter initialEntries={['/referrals/referrers/42']}>
        <PageEyebrowProvider value="Marketing">
          <Routes>
            <Route path="/referrals/referrers/:referrerId" element={<ReferrerStatsPage />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

beforeEach(() => {
  apollo.queries.length = 0
  rbac.allowed = true
  rbac.calls.length = 0
  server = {
    stats: {
      __typename: 'ReferrerStats',
      referrerId: 42,
      totalEarnings: 9300,
      grossEarnings: 10250.5,
      totalReferrals: 42,
      activeReferrals: 31,
      totalTransactions: 180,
      totalClicks: 420,
      totalAttributions: 38,
      conversionRate: 9.047,
      earningsByRuleType: [
        { __typename: 'ReferrerEarningsByRule', ruleType: 'SIGNUP_CPA', totalEarnings: 6300, count: 21 },
        { __typename: 'ReferrerEarningsByRule', ruleType: 'REVSHARE', totalEarnings: 100, count: 1 },
        { __typename: 'ReferrerEarningsByRule', ruleType: 'FIRST_DEPOSIT_PCT', totalEarnings: 3000, count: 1250 },
      ],
    },
    user: {
      __typename: 'User',
      id: '42',
      name: 'Vijay Kumar',
      email: null,
      phone: '9876543210',
      username: 'vjy_2401',
    },
    statsError: null,
    statsCalls: [],
    userCalls: [],
  }
})

describe('ReferrerStatsPage', () => {
  test('requires referrals.earnings view, and a denied caller starts no query', () => {
    rbac.allowed = false
    renderPage()
    assert.equal(screen.getByRole('alert').textContent, 'Access denied')
    assert.deepEqual(rbac.calls[0], [{ domain: 'referrals.earnings', actions: ['view'] }])
    assert.equal(apollo.queries.length, 0)
  })

  test('both documents unchanged, for the route id over every date; the header stays while they load', async () => {
    renderPage()
    assert.ok(screen.getByText('Loading referrer statistics'))
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Referrer Statistics')
    assert.ok(screen.getByText('Referrer #42'))
    assert.ok(screen.queryByText('Detailed performance metrics for referrer #42') === null)
    assert.equal(screen.getByRole('link', { name: 'Back' }).getAttribute('href'), '/referrals/top-referrers')
    assert.ok(screen.queryByText('Marketing') === null)

    await screen.findByText('Vijay Kumar')
    const stats = apollo.queries.find((call) => sourceOf(call.query) === STATS_TEXT)
    const user = apollo.queries.find((call) => sourceOf(call.query) === USER_TEXT)
    assert.ok(stats && user)
    assert.equal(print(stats.query as DocumentNode), print(parse(STATS_TEXT)))
    assert.deepEqual(stats.options, {
      variables: { referrerId: '42', fromDate: undefined, toDate: undefined },
      skip: false,
      errorPolicy: 'all',
    })
    assert.deepEqual(user.options, { variables: { id: '42' }, skip: false, errorPolicy: 'all' })
    assert.deepEqual(server.statsCalls, [{ referrerId: '42' }])
    assert.deepEqual(server.userCalls, [{ id: '42' }])
  })

  test('the referrer facts, the four figures and the rule table', async () => {
    renderPage()
    await screen.findByText('Vijay Kumar')
    assert.deepEqual(screen.getAllByRole('term').map((term) => term.textContent), ['Referrer ID', 'Name', 'Email', 'Phone', 'Username'])
    assert.deepEqual(
      screen.getAllByRole('definition').map((value) => value.textContent),
      ['42', 'Vijay Kumar', 'N/A', '9876543210', 'vjy_2401'],
    )
    const figures = screen.getByRole('group', { name: 'Referrer statistics' }).textContent ?? ''
    assert.ok(figures.includes('Total EarningsINR 9300.00Gross: INR 10250.50'))
    assert.ok(figures.includes('Total Referrals4231 active'))
    assert.ok(figures.includes('Conversion Rate9.05%38 / 420 signups/clicks'))
    assert.ok(figures.includes('Total Transactions180420 clicks'))

    assert.equal(screen.getByRole('heading', { level: 2 }).textContent, 'Earnings by Rule Type')
    assert.ok(screen.getByText('2 rules'))
    const rows = within(screen.getByRole('table', { name: 'Earnings by rule type' })).getAllByRole('row').slice(1)
    assert.deepEqual(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent)), [
      ['SIGNUP CPA', 'INR 6300.00', (21).toLocaleString()],
      ['FIRST DEPOSIT PCT', 'INR 3000.00', (1250).toLocaleString()],
    ])
  })

  test('the untitled facts card has a flush body, so the facts row carries the card inset', async () => {
    renderPage()
    await screen.findByText('Vijay Kumar')
    const facts = screen.getAllByRole('term')[0].closest('dl')
    assert.ok(facts)
    assert.ok(facts.classList.contains(styles.facts))
    const body = facts.parentElement
    assert.ok(body)
    assert.ok(body.classList.contains(cardStyles.flush))
    assert.equal(body.classList.contains(cardStyles.padded), false)
  })

  test('without a username the fact is left out', async () => {
    server.user = { ...server.user, username: null }
    renderPage()
    await screen.findByText('Vijay Kumar')
    assert.ok(screen.queryByText('Username') === null)
  })

  test('a custom period re-asks the stats with IST day bounds (not the user); Reset clears it', async () => {
    renderPage()
    await screen.findByText('Vijay Kumar')
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }))
    await waitFor(() => assert.deepEqual(server.statsCalls.at(-1), {
      referrerId: '42',
      fromDate: '2026-09-30T18:30:00.000Z',
      toDate: '2026-10-05T18:29:59.999Z',
    }))
    assert.equal(screen.getByTestId('period-state').textContent, 'custom|2026-10-01|2026-10-05')
    await screen.findByText('Vijay Kumar')
    assert.equal(server.userCalls.length, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Reset period' }))
    await waitFor(() => assert.equal(screen.getByTestId('period-state').textContent, 'all||'))
  })

  test('Refresh re-asks the stats only', async () => {
    renderPage()
    await screen.findByText('Vijay Kumar')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(server.statsCalls.length, 2))
    assert.equal(server.userCalls.length, 1)
  })

  test('an unknown referrer reads Referrer not found under the header', async () => {
    server.user = null
    renderPage()
    await screen.findByText('Referrer not found')
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Referrer Statistics')
    // The untitled card's body is flush: the EmptyState's own card inset is the only padding.
    const body = screen.getByText('Referrer not found').closest('section')?.firstElementChild
    assert.ok(body)
    assert.ok(body.classList.contains(cardStyles.flush))
    assert.equal(body.classList.contains(cardStyles.padded), false)
  })

  test('a failed request says so, and Retry asks both again', async () => {
    server.statsError = 'Stats unavailable'
    renderPage()
    await screen.findByText('Failed to load referrer statistics')
    assert.ok(screen.getByText('Stats unavailable'))
    assert.ok(screen.queryByText('Referrer not found') === null)

    server.statsError = null
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Vijay Kumar')
    assert.equal(server.userCalls.length, 2)
  })

  test('no rule earnings: the empty text and 0 rules', async () => {
    server.stats = { ...server.stats, earningsByRuleType: [] }
    renderPage()
    await screen.findByText('No earnings data by rule type')
    assert.ok(screen.getByText('0 rules'))
  })
})
