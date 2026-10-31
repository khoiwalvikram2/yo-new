/**
 * /referrals mounted against MockedProvider and a MemoryRouter: the three documents (program, earnings,
 * stats) exactly as written, their options and variables, the period's IST bounds, the RBAC requirement
 * and its denial, the no-program notice, the six figures, the configuration card, the earnings table's
 * cells, sorting and paging, Refresh, and the loading, empty and failed states. The guard and the period
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
import ReferralsOverviewPage from './ReferralsOverviewPage'

const PROGRAM_TEXT = 'query ReferralProgram { referralProgramByTenant { id name enabledModes maxDepth } }'
const EARNINGS_TEXT = 'query ReferralEarnings($fromDate: String, $toDate: String) { referralEarnings(fromDate: $fromDate, toDate: $toDate) { id referrerId refereeId tier ruleType grossAmount netAmount currency calculatedAt } }'
const STATS_TEXT = 'query ReferralStats($fromDate: String, $toDate: String) { referralStats(fromDate: $fromDate, toDate: $toDate) { totalClicks totalSignups totalAttributions totalEarnings totalSettled totalPending currency periodStart periodEnd } }'

interface Recorded {
  query: DocumentNode
  options: { variables?: Record<string, unknown>; errorPolicy?: string } | undefined
}

const apollo = vi.hoisted(() => ({ queries: [] as Recorded[] }))
const rbac = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ query: args[0] as DocumentNode, options: args[1] as Recorded['options'] })
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

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string, pattern?: string) => `formatted:${value}:${pattern}`,
  }),
}))

vi.mock('@/ui/components/DateRangeField', () => ({
  DateRangeField: ({
    label,
    presets,
    appliedPreset,
    appliedFrom,
    appliedTo,
    onApply,
    onReset,
  }: {
    label?: string
    presets: Array<{ value: string; label: string }>
    appliedPreset: string
    appliedFrom?: string
    appliedTo?: string
    onApply: (payload: { kind: 'preset'; preset: string } | { kind: 'custom'; from: string; to: string }) => void
    onReset: () => void
  }) => (
    <fieldset>
      <legend>{label}</legend>
      <output data-testid="period-state">
        {`${appliedPreset}|${appliedFrom ?? ''}|${appliedTo ?? ''}|${presets.map((preset) => preset.label).join(',')}`}
      </output>
      <button type="button" onClick={() => onApply({ kind: 'custom', from: '2026-10-01', to: '2026-10-05' })}>
        Apply custom range
      </button>
      <button type="button" onClick={() => onApply({ kind: 'preset', preset: 'all' })}>Apply all dates</button>
      <button type="button" onClick={onReset}>Reset period</button>
    </fieldset>
  ),
}))

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()
// The document's own source text, whitespace-normalised (what gate 10 compares).
const sourceOf = (document: DocumentNode) => normalise(document.loc?.source.body ?? '')
// What the link would send: undefined variables are dropped, as JSON drops them on the wire.
const sent = (variables: Record<string, unknown> | undefined) => JSON.parse(JSON.stringify(variables ?? {}))

interface Earning {
  __typename: 'ReferralEarning'
  id: string
  referrerId: number
  refereeId: number
  tier: number
  ruleType: string
  grossAmount: number
  netAmount: number
  currency: string
  calculatedAt: string
}

function earning(index: number, patch: Partial<Earning> = {}): Earning {
  return {
    __typename: 'ReferralEarning',
    id: `e${index}`,
    referrerId: 100 + index,
    refereeId: 500 + index,
    tier: (index % 3) + 1,
    ruleType: 'SIGNUP_CPA',
    grossAmount: index * 10,
    netAmount: index * 10,
    currency: 'INR',
    calculatedAt: `2026-10-${String(index).padStart(2, '0')}T10:00:00.000Z`,
    ...patch,
  }
}

interface ServerState {
  program: Record<string, unknown> | null
  earnings: Earning[]
  earningsError: string | null
  stats: Record<string, unknown>
  programCalls: number
  earningsCalls: Array<Record<string, unknown>>
  statsCalls: Array<Record<string, unknown>>
}

let server: ServerState

function mocks(): MockedResponse[] {
  return [
    {
      request: { query: parse(PROGRAM_TEXT) },
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: () => {
        server.programCalls += 1
        return { data: { referralProgramByTenant: server.program } }
      },
    },
    {
      request: { query: parse(EARNINGS_TEXT) },
      variableMatcher: () => true,
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: (variables: Record<string, unknown>) => {
        server.earningsCalls.push(variables)
        return server.earningsError
          ? { errors: [new GraphQLError(server.earningsError)] }
          : { data: { referralEarnings: server.earnings } }
      },
    },
    {
      request: { query: parse(STATS_TEXT) },
      variableMatcher: () => true,
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: (variables: Record<string, unknown>) => {
        server.statsCalls.push(variables)
        return { data: { referralStats: server.stats } }
      },
    },
  ]
}

function renderPage() {
  return render(
    <MockedProvider mocks={mocks()}>
      <MemoryRouter initialEntries={['/referrals']}>
        <PageEyebrowProvider value="Marketing">
          <ReferralsOverviewPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function recordedFor(operation: string): Recorded[] {
  return apollo.queries.filter((call) => normalise(print(call.query)).startsWith(`query ${operation}`))
}

function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table', { name: 'Recent earnings' })
  return within(table).getAllByRole('row').slice(1)
}

beforeEach(() => {
  apollo.queries.length = 0
  rbac.allowed = true
  rbac.calls.length = 0
  server = {
    program: {
      __typename: 'ReferralProgram',
      id: 'p1',
      name: 'Default Referral Program',
      enabledModes: ['REVSHARE', 'SIGNUP_CPA', 'FIRST_DEPOSIT_PCT'],
      maxDepth: 4,
    },
    earnings: [
      ...Array.from({ length: 12 }, (_, index) => earning(index + 1)),
      earning(13, { ruleType: 'REVSHARE' }),
    ],
    earningsError: null,
    stats: {
      __typename: 'ReferralStats',
      totalClicks: 12480,
      totalSignups: 312,
      totalAttributions: 290,
      totalEarnings: 482650.5,
      totalSettled: 300000,
      totalPending: 182650.5,
      currency: 'INR',
      periodStart: null,
      periodEnd: null,
    },
    programCalls: 0,
    earningsCalls: [],
    statsCalls: [],
  }
})

describe('ReferralsOverviewPage', () => {
  test('requires referrals.overview view, and a denied caller starts no query', () => {
    rbac.allowed = false
    renderPage()
    assert.equal(screen.getByRole('alert').textContent, 'Access denied')
    assert.deepEqual(rbac.calls[0], [{ domain: 'referrals.overview', actions: ['view'] }])
    assert.equal(apollo.queries.length, 0)
  })

  test('sends the three documents unchanged, unfiltered, with errorPolicy all', async () => {
    renderPage()
    await screen.findByText('Default Referral Program')

    const [program] = recordedFor('ReferralProgram')
    const [earnings] = recordedFor('ReferralEarnings')
    const [stats] = recordedFor('ReferralStats')
    assert.equal(sourceOf(program.query), PROGRAM_TEXT)
    assert.equal(sourceOf(earnings.query), EARNINGS_TEXT)
    assert.equal(sourceOf(stats.query), STATS_TEXT)
    assert.equal(print(earnings.query), print(parse(EARNINGS_TEXT)))
    assert.equal(print(stats.query), print(parse(STATS_TEXT)))
    assert.deepEqual(program.options, { errorPolicy: 'all' })
    assert.deepEqual(earnings.options, { variables: { fromDate: undefined, toDate: undefined }, errorPolicy: 'all' })
    assert.deepEqual(stats.options, { variables: { fromDate: undefined, toDate: undefined }, errorPolicy: 'all' })
    await waitFor(() => assert.equal(server.earningsCalls.length, 1))
    assert.deepEqual(sent(server.earningsCalls[0]), {})
    assert.deepEqual(sent(server.statsCalls[0]), {})
  })

  test('the header: one h1, the eyebrow, the period, and real links to the settings', async () => {
    renderPage()
    await screen.findByText('Default Referral Program')
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Referral Program')
    assert.ok(screen.queryByText('Manage referral programs, track performance, and configure rewards') === null)
    assert.ok(screen.queryByText('Marketing') === null)
    assert.equal(screen.getByTestId('period-state').textContent, 'all|||All dates,Custom range')
    assert.equal(screen.getByRole('link', { name: 'Program Settings' }).getAttribute('href'), '/referrals/program')
    assert.equal(screen.getByRole('link', { name: 'Edit Settings' }).getAttribute('href'), '/referrals/program')
    assert.equal(screen.getByRole('link', { name: 'View All' }).getAttribute('href'), '/referrals/earnings')
    assert.deepEqual(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
      ['Program Configuration', 'Recent Earnings'],
    )
  })

  test('the configuration card lists the program without revenue share; no notice while it loads or exists', async () => {
    renderPage()
    assert.ok(screen.queryByText('No Program Configured') === null)
    await screen.findByText('Default Referral Program')
    const card = within(screen.getByRole('region', { name: 'Program Configuration' }))
    assert.deepEqual(
      card.getAllByRole('term').map((term) => term.textContent),
      ['Program Name', 'Max Tier Depth', 'Reward Types'],
    )
    assert.deepEqual(
      card.getAllByRole('definition').map((value) => value.textContent),
      ['Default Referral Program', '4 tiers', 'SIGNUP CPAFIRST DEPOSIT PCT'],
    )
    assert.ok(screen.getByText('Current referral program settings'))
    assert.ok(screen.queryByText('REVSHARE') === null)
    assert.ok(screen.queryByText('No Program Configured') === null)
  })

  test('with no program the warning offers Configure Now, and the configuration card is gone', async () => {
    server.program = null
    renderPage()
    await screen.findByText('No Program Configured')
    assert.ok(screen.getByText('Please configure your referral program settings to start using referrals.'))
    assert.equal(screen.getByRole('link', { name: 'Configure Now' }).getAttribute('href'), '/referrals/program')
    assert.ok(screen.queryByText('Program Configuration') === null)
  })

  test('a program with only revenue share reads None enabled', async () => {
    server.program = { ...server.program, enabledModes: ['REVSHARE'] }
    renderPage()
    await screen.findByText('None enabled')
  })

  test('the six figures, in the stats currency, with signups over clicks', async () => {
    renderPage()
    const group = await screen.findByRole('group', { name: 'Referral statistics' })
    await waitFor(() => assert.equal(group.getAttribute('aria-busy'), null))
    const text = group.textContent ?? ''
    assert.ok(text.includes(`Total Clicks${(12480).toLocaleString()}`))
    assert.ok(text.includes(`Total Signups${(312).toLocaleString()}`))
    assert.ok(text.includes('Total EarningsINR 482650.50'))
    assert.ok(text.includes('Total SettledINR 300000.00'))
    assert.ok(text.includes('Conversion Rate2.50%'))
    assert.ok(text.includes('PendingINR 182650.50'))
  })

  test('the earnings table: revenue share left out, legacy cells, ten a page', async () => {
    renderPage()
    await screen.findByText('formatted:2026-10-01T10:00:00.000Z:MMM d, yyyy HH:mm')
    const rows = bodyRows()
    assert.equal(rows.length, 10)
    const first = within(rows[0]).getAllByRole('cell').map((cell) => cell.textContent)
    assert.deepEqual(first, ['101', '501', 'L2', 'SIGNUP CPA', 'INR 10.00', 'formatted:2026-10-01T10:00:00.000Z:MMM d, yyyy HH:mm'])
    assert.ok(screen.getByText((_, node) => node?.textContent === 'Showing 1–10 of 12 earnings'))

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(bodyRows().length, 2))
    assert.equal(within(bodyRows()[1]).getAllByRole('cell')[0].textContent, '112')
  })

  test('Amount sorts the whole list ascending, then descending, then back to the server order', async () => {
    server.earnings = [earning(1, { netAmount: 300 }), earning(2, { netAmount: 20 }), earning(3, { netAmount: 1000 })]
    renderPage()
    await screen.findByText('INR 300.00')
    const amounts = () => bodyRows().map((row) => within(row).getAllByRole('cell')[4].textContent)
    assert.deepEqual(amounts(), ['INR 300.00', 'INR 20.00', 'INR 1000.00'])

    fireEvent.click(screen.getByRole('button', { name: 'Amount' }))
    assert.deepEqual(amounts(), ['INR 20.00', 'INR 300.00', 'INR 1000.00'])
    assert.equal(screen.getByRole('columnheader', { name: 'Amount' }).getAttribute('aria-sort'), 'ascending')
    fireEvent.click(screen.getByRole('button', { name: 'Amount' }))
    assert.deepEqual(amounts(), ['INR 1000.00', 'INR 300.00', 'INR 20.00'])
    fireEvent.click(screen.getByRole('button', { name: 'Amount' }))
    assert.deepEqual(amounts(), ['INR 300.00', 'INR 20.00', 'INR 1000.00'])
  })

  test('a custom period sends IST day bounds to the earnings and the stats, back on page 1; Reset clears it', async () => {
    renderPage()
    await screen.findByText('formatted:2026-10-01T10:00:00.000Z:MMM d, yyyy HH:mm')
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(bodyRows().length, 2))

    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }))
    const bounds = { fromDate: '2026-09-30T18:30:00.000Z', toDate: '2026-10-05T18:29:59.999Z' }
    await waitFor(() => assert.deepEqual(sent(server.earningsCalls.at(-1)), bounds))
    await waitFor(() => assert.deepEqual(sent(server.statsCalls.at(-1)), bounds))
    assert.equal(screen.getByTestId('period-state').textContent, 'custom|2026-10-01|2026-10-05|All dates,Custom range')
    await waitFor(() => assert.equal(bodyRows().length, 10))
    assert.equal(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current'), 'page')

    fireEvent.click(screen.getByRole('button', { name: 'Reset period' }))
    await waitFor(() => assert.equal(screen.getByTestId('period-state').textContent, 'all|||All dates,Custom range'))
    const lastEarnings = recordedFor('ReferralEarnings').at(-1)
    assert.deepEqual(lastEarnings?.options?.variables, { fromDate: undefined, toDate: undefined })
  })

  test('Refresh refetches the program and the earnings, not the figures', async () => {
    renderPage()
    await screen.findByText('Default Referral Program')
    await waitFor(() => assert.equal(server.earningsCalls.length, 1))
    const before = { program: server.programCalls, earnings: server.earningsCalls.length, stats: server.statsCalls.length }

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(server.programCalls, before.program + 1))
    await waitFor(() => assert.equal(server.earningsCalls.length, before.earnings + 1))
    assert.equal(server.statsCalls.length, before.stats)
  })

  test('loading, then the empty earnings state', async () => {
    server.earnings = [earning(1, { ruleType: 'REVSHARE' })]
    renderPage()
    assert.ok(screen.getByText('Loading Recent earnings'))
    assert.equal(screen.getByRole('group', { name: 'Referral statistics' }).getAttribute('aria-busy'), 'true')
    await screen.findByText('No earnings data available')
  })

  test('a failed earnings request says so and Retry asks again', async () => {
    server.earningsError = 'Earnings failed'
    renderPage()
    await screen.findByText('Unable to load referral earnings.')
    server.earningsError = null
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.equal(bodyRows().length, 10))
  })
})
