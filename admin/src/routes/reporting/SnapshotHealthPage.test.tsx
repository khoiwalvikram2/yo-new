/**
 * /reporting/snapshot-health against a mocked GraphQL server (MockedProvider + MemoryRouter). The real
 * page, its summary, gaps and stale components and the kit render; the runs/events card has its own
 * suite and is stubbed here. useQuery/useMutation are wrapped, not replaced, so every option the page
 * passes is recorded while the real Apollo hooks run against the mocks.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useApolloClient } from '@apollo/client'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import {
  ENQUEUE_SNAPSHOT_BACKFILL_RANGE_MUTATION,
  ENQUEUE_SNAPSHOT_FOR_REPORTING_DAY_MUTATION,
  REGENERATE_STALE_SNAPSHOT_MUTATION,
  SNAPSHOT_HEALTH_SUMMARY_QUERY,
  SNAPSHOT_MISSING_DAYS_QUERY,
  SNAPSHOT_STALE_DAYS_QUERY,
} from '@/modules/reporting/graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import SnapshotHealthPage from './SnapshotHealthPage'
import type { MissingRow, SnapshotHealthSummary, StaleSnapshotRow } from './snapshotHealthModel'

interface HookCall {
  name: string
  document: unknown
  options: Record<string, unknown>
}

interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: string
  onConfirm?: () => void | Promise<void>
}

const apollo = vi.hoisted(() => ({
  queries: [] as HookCall[],
  mutations: [] as HookCall[],
}))

const auth = vi.hoisted(() => ({
  roles: [] as unknown[],
  permissions: [] as Array<{ domain: string; actions: string[] }>,
  directorMode: 'core',
}))

const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as unknown[],
}))

const feedback = vi.hoisted(() => ({ confirm: vi.fn() }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const nameOf = (document: unknown) =>
    (document as { definitions?: Array<{ name?: { value?: string } }> }).definitions?.[0]?.name?.value ?? ''
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({
        name: nameOf(args[0]),
        document: args[0],
        options: (args[1] ?? {}) as Record<string, unknown>,
      })
      return actual.useQuery(...args)
    },
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({
        name: nameOf(args[0]),
        document: args[0],
        options: (args[1] ?? {}) as Record<string, unknown>,
      })
      return actual.useMutation(...args)
    },
  }
})

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { roles: unknown[]; permissions: unknown[] }) => unknown) =>
    selector({ roles: auth.roles, permissions: auth.permissions }),
}))

vi.mock('@/shared/core/uiStore', () => ({
  useUIStore: (selector: (state: { directorMode: string }) => unknown) =>
    selector({ directorMode: auth.directorMode }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: unknown; children: ReactNode }) => {
    guard.calls.push(required)
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))

vi.mock('./components/SnapshotHealthRunsEvents', () => ({
  SnapshotHealthRunsEvents: () => <section aria-label="Pipeline runs and events (stub)" />,
}))

const REFETCH_AFTER_MUTATION = [
  'SnapshotHealthSummary',
  'SnapshotMissingDays',
  'SnapshotStaleDays',
  'SnapshotRuns',
  'SnapshotEvents',
  'SnapshotRunsConnection',
  'SnapshotEventsConnection',
  'SnapshotPgBossOverview',
]

const SUMMARY: SnapshotHealthSummary = {
  nextRunAtIso: '2026-10-07T20:30:00.000Z',
  snapshotTimezone: 'Asia/Kolkata',
  runAtLocalTime: '02:00',
  healthCheckCron: '15 * * * *',
  dailyLookbackDays: 3,
  backfillLookbackDays: 30,
  errorsLast24h: 0,
  backfillGapWarningsLast24h: 2,
  missingDaysCount: 2,
  lastSchedulePublishAt: null,
  lastScheduleFailureAt: null,
  lastScheduleFailureMessage: null,
  lastJobCompleteAt: null,
  lastDailyScheduleRunAt: null,
  lastDailyScheduleRunStatus: null,
  lastHealthBackfillRunAt: null,
  lastHealthBackfillRunStatus: null,
}

function gap(reportingDay: string, overrides: Partial<MissingRow> = {}): MissingRow {
  return {
    tenant: 'core',
    whitelabelId: 'wl-1',
    currency: 'INR',
    reportingDay,
    timezone: 'Asia/Kolkata',
    ...overrides,
  }
}

function staleDay(reportingDay: string, overrides: Partial<StaleSnapshotRow> = {}): StaleSnapshotRow {
  return {
    tenant: 'core',
    whitelabelId: 'wl-1',
    currency: 'INR',
    reportingDay,
    timezone: 'Asia/Kolkata',
    staleBetCount: 4,
    snapshotCreatedAt: `${reportingDay}T18:31:00.000Z`,
    latestSettledAt: `${reportingDay}T21:02:45.120Z`,
    ...overrides,
  }
}

const GAPS = [gap('2026-10-01'), gap('2026-10-02', { tenant: 'tenant-b', whitelabelId: 'wl-2', currency: 'USD' })]
const STALE = [staleDay('2026-09-28'), staleDay('2026-09-29', { staleBetCount: 11 })]

function summaryMock(data: SnapshotHealthSummary = SUMMARY): MockedResponse {
  return {
    request: { query: SNAPSHOT_HEALTH_SUMMARY_QUERY },
    result: { data: { snapshotHealthSummary: data } },
    maxUsageCount: 10,
  }
}

function missingMock(rows: MissingRow[], lookbackDays = 30): MockedResponse {
  return {
    request: { query: SNAPSHOT_MISSING_DAYS_QUERY, variables: { lookbackDays } },
    result: { data: { snapshotMissingDays: rows } },
    maxUsageCount: 10,
  }
}

function staleMock(rows: StaleSnapshotRow[], lookbackDays = 30): MockedResponse {
  return {
    request: { query: SNAPSHOT_STALE_DAYS_QUERY, variables: { lookbackDays } },
    result: { data: { snapshotStaleDays: rows } },
    maxUsageCount: 10,
  }
}

const mutationResult = (field: string) => ({ data: { [field]: { success: true, message: 'Queued' } } })

let client: ReturnType<typeof useApolloClient> | null = null

function ClientProbe() {
  client = useApolloClient()
  return null
}

function renderPage(mocks: MockedResponse[]) {
  return render(
    <MockedProvider mocks={mocks} addTypename={false}>
      <MemoryRouter initialEntries={['/reporting/snapshot-health']}>
        <PageEyebrowProvider value="Reporting">
          <ClientProbe />
          <Routes>
            <Route path="/reporting/snapshot-health" element={<SnapshotHealthPage />} />
            <Route path="/overview" element={<p>Overview landing</p>} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function latest(calls: HookCall[], name: string): HookCall {
  const call = [...calls].reverse().find((candidate) => candidate.name === name)
  assert.ok(call, `Expected a hook call for ${name}`)
  return call
}

function confirmCopy(index = 0) {
  const options = feedback.confirm.mock.calls[index]?.[0] as ConfirmOptions
  return {
    title: options.title,
    description: options.description,
    confirmLabel: options.confirmLabel,
    cancelLabel: options.cancelLabel,
    tone: options.tone,
  }
}

/** Elements are checked by identity, never through a node:assert diff of a jsdom node. */
function absent(element: HTMLElement | null) {
  assert.ok(element === null, 'expected the element to be absent')
}

function bodyRows(tableName: string): HTMLElement[] {
  const table = screen.getByRole('table', { name: tableName })
  return within(table).getAllByRole('row').slice(1)
}

async function loaded() {
  await screen.findByText('Next daily run (local)')
  await screen.findByRole('button', { name: 'Fix 2026-10-01 · core · INR' })
  await screen.findByRole('button', { name: 'Fix 2026-09-28 · core · INR' })
}

beforeEach(() => {
  apollo.queries.length = 0
  apollo.mutations.length = 0
  guard.calls.length = 0
  guard.allowed = true
  auth.roles = ['Super Admin']
  auth.permissions = [{ domain: 'reporting.snapshot-health', actions: ['view', 'trigger'] }]
  auth.directorMode = 'core'
  client = null
  feedback.confirm.mockReset()
  // Runs the action as the kit's confirm() does; a rejected action keeps the dialog open (resolves false).
  feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
    try {
      await options.onConfirm?.()
      return true
    } catch {
      return false
    }
  })
})

describe('SnapshotHealthPage', () => {
  test('renders the guarded page and sends the legacy documents, variables and options', async () => {
    renderPage([summaryMock(), missingMock(GAPS), staleMock(STALE)])
    await loaded()

    assert.deepEqual(guard.calls.at(-1), [{ domain: 'reporting.snapshot-health', actions: ['view'] }])
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Snapshot health')
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.ok(screen.queryByText('Reporting') === null)
    assert.ok(screen.queryByText('Daily reporting snapshot pipeline (pg-boss) observability') === null)
    assert.deepEqual(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
      ['Pipeline status', 'Missing snapshot days', 'Stale sports snapshots'],
    )
    for (const label of ['Overview', 'Gaps & backfill', 'Stale snapshots', 'Pipeline & logs']) screen.getByText(label)
    screen.getByRole('region', { name: 'Pipeline runs and events (stub)' })

    const summaryCall = latest(apollo.queries, 'SnapshotHealthSummary')
    assert.equal(summaryCall.document, SNAPSHOT_HEALTH_SUMMARY_QUERY)
    assert.deepEqual(summaryCall.options, { fetchPolicy: 'cache-and-network' })
    const missingCall = latest(apollo.queries, 'SnapshotMissingDays')
    assert.equal(missingCall.document, SNAPSHOT_MISSING_DAYS_QUERY)
    assert.deepEqual(missingCall.options, { variables: { lookbackDays: 30 }, fetchPolicy: 'cache-and-network' })
    const staleCall = latest(apollo.queries, 'SnapshotStaleDays')
    assert.equal(staleCall.document, SNAPSHOT_STALE_DAYS_QUERY)
    assert.deepEqual(staleCall.options, {
      variables: { lookbackDays: 30 },
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'all',
    })

    const documents = new Map<string, unknown>([
      ['EnqueueSnapshotForReportingDay', ENQUEUE_SNAPSHOT_FOR_REPORTING_DAY_MUTATION],
      ['EnqueueSnapshotBackfillRange', ENQUEUE_SNAPSHOT_BACKFILL_RANGE_MUTATION],
      ['RegenerateStaleSnapshot', REGENERATE_STALE_SNAPSHOT_MUTATION],
    ])
    for (const [name, document] of documents) {
      const call = latest(apollo.mutations, name)
      assert.equal(call.document, document)
      assert.deepEqual(call.options, { refetchQueries: REFETCH_AFTER_MUTATION })
    }
  })

  test('shows the pipeline status and the four figures with the legacy notes', async () => {
    renderPage([summaryMock(), missingMock(GAPS), staleMock(STALE)])
    await loaded()

    const card = screen.getByRole('region', { name: 'Pipeline status' })
    within(card).getByText('Attention needed')
    const figure = (label: string) => within(card).getByText(label).parentElement?.textContent
    assert.equal(figure('Next daily run (local)'), 'Next daily run (local)2026-10-08 02:00TZ Asia/Kolkata · cron local 02:00')
    assert.equal(figure('Errors (24h)'), 'Errors (24h)0Scoped to your tenant / whitelabel where applicable')
    assert.equal(
      figure('Missing snapshot days'),
      'Missing snapshot days2Lookback 30d · daily window 3d · 2 backfill gap warning(s) 24h',
    )
    assert.equal(figure('Last job complete'), 'Last job complete—Health cron: 15 * * * *')
  })

  test('the gap and stale lookbacks follow the summary once it answers', async () => {
    renderPage([
      summaryMock({ ...SUMMARY, backfillLookbackDays: 45 }),
      missingMock([gap('2026-08-01')], 30),
      missingMock([gap('2026-08-20', { tenant: 'deep' })], 45),
      staleMock([], 30),
      staleMock([staleDay('2026-08-25', { tenant: 'deep' })], 45),
    ])

    await screen.findByRole('button', { name: 'Fix 2026-08-20 · deep · INR' })
    await screen.findByRole('button', { name: 'Fix 2026-08-25 · deep · INR' })
    assert.deepEqual(latest(apollo.queries, 'SnapshotMissingDays').options.variables, { lookbackDays: 45 })
    assert.deepEqual(latest(apollo.queries, 'SnapshotStaleDays').options.variables, { lookbackDays: 45 })
  })

  test('a denied caller sees the guard and starts no query or mutation hook', () => {
    guard.allowed = false
    renderPage([])
    screen.getByRole('alert')
    assert.equal(screen.getByText('Access denied').textContent, 'Access denied')
    assert.equal(apollo.queries.length, 0)
    assert.equal(apollo.mutations.length, 0)
  })

  test('a Super Admin in whitelabel mode is sent to /overview; other roles stay', async () => {
    auth.directorMode = 'whitelabel'
    const view = renderPage([summaryMock(), missingMock(GAPS), staleMock(STALE)])
    await screen.findByText('Overview landing')
    absent(screen.queryByRole('heading', { level: 1 }))
    assert.equal(apollo.queries.length, 0)
    view.unmount()

    auth.roles = ['Admin']
    renderPage([summaryMock(), missingMock(GAPS), staleMock(STALE)])
    await loaded()
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Snapshot health')
  })

  test('Fix on a gap confirms with the legacy copy and enqueues that reporting day', async () => {
    const sent = vi.fn(() => mutationResult('enqueueSnapshotForReportingDay'))
    renderPage([
      summaryMock(),
      missingMock(GAPS),
      staleMock(STALE),
      {
        request: {
          query: ENQUEUE_SNAPSHOT_FOR_REPORTING_DAY_MUTATION,
          variables: { tenant: 'tenant-b', whitelabelId: 'wl-2', reportingDay: '2026-10-02', currency: 'USD' },
        },
        result: sent,
      },
    ])
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Fix 2026-10-02 · tenant-b · USD' }))
    assert.deepEqual(confirmCopy(), {
      title: 'Generate snapshot for this reporting day?',
      description: 'Runs immediately. May take a few seconds.',
      confirmLabel: 'Fix',
      cancelLabel: 'Cancel',
      tone: undefined,
    })
    await waitFor(() => assert.equal(sent.mock.calls.length, 1))
    assert.equal(await feedback.confirm.mock.results[0]?.value, true)
  })

  test('Backfill range requires both days, orders them, sends the first gap and then resets', async () => {
    const sent = vi.fn(() => mutationResult('enqueueSnapshotBackfillRange'))
    renderPage([
      summaryMock(),
      missingMock(GAPS),
      staleMock(STALE),
      {
        request: {
          query: ENQUEUE_SNAPSHOT_BACKFILL_RANGE_MUTATION,
          variables: { tenant: 'core', whitelabelId: 'wl-1', dateFrom: '2026-09-10', dateTo: '2026-09-20', currency: 'INR' },
        },
        result: sent,
      },
    ])
    await loaded()

    const form = screen.getByRole('form', { name: 'Backfill range' })
    const start = within(form).getByLabelText('Start date') as HTMLInputElement
    const end = within(form).getByLabelText('End date') as HTMLInputElement
    fireEvent.click(within(form).getByRole('button', { name: 'Backfill range' }))
    assert.equal(within(form).getByRole('alert').textContent, 'Pick a range')
    assert.equal(sent.mock.calls.length, 0)

    fireEvent.change(start, { target: { value: '2026-09-20' } })
    assert.equal(within(form).getByRole('alert').textContent, 'Pick a range')
    fireEvent.change(end, { target: { value: '2026-09-10' } })
    absent(within(form).queryByRole('alert'))

    fireEvent.click(within(form).getByRole('button', { name: 'Backfill range' }))
    await waitFor(() => assert.equal(sent.mock.calls.length, 1))
    await waitFor(() => assert.equal(start.value, ''))
    assert.equal(end.value, '')
    // the range form never asked for a confirmation, and still does not
    assert.equal(feedback.confirm.mock.calls.length, 0)
  })

  test('a backfill the server refuses shows its reason in the form and keeps the range (F-REP-11)', async () => {
    renderPage([
      summaryMock(),
      missingMock(GAPS),
      staleMock(STALE),
      {
        request: {
          query: ENQUEUE_SNAPSHOT_BACKFILL_RANGE_MUTATION,
          variables: { tenant: 'core', whitelabelId: 'wl-1', dateFrom: '2026-07-01', dateTo: '2026-10-31', currency: 'INR' },
        },
        result: { errors: [new GraphQLError('Range too large (max 31 days)')] },
      },
    ])
    await loaded()

    const form = screen.getByRole('form', { name: 'Backfill range' })
    // the form says which book it backfills, since it has no tenant picker
    within(form).getByText(/^Backfills core \/ wl-1 \(INR\), the first tenant listed below; at most 31 days at a time\.$/)
    const start = within(form).getByLabelText('Start date') as HTMLInputElement
    const end = within(form).getByLabelText('End date') as HTMLInputElement
    fireEvent.change(start, { target: { value: '2026-10-31' } })
    fireEvent.change(end, { target: { value: '2026-07-01' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Backfill range' }))

    await waitFor(() => assert.equal(within(form).getByRole('alert').textContent, 'Range too large (max 31 days)'))
    assert.equal(start.value, '2026-10-31')
    assert.equal(end.value, '2026-07-01')
  })

  test('Reset clears the range and its message', async () => {
    renderPage([summaryMock(), missingMock(GAPS), staleMock(STALE)])
    await loaded()

    const form = screen.getByRole('form', { name: 'Backfill range' })
    const start = within(form).getByLabelText('Start date') as HTMLInputElement
    fireEvent.change(start, { target: { value: '2026-09-01' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Backfill range' }))
    within(form).getByRole('alert')
    fireEvent.click(within(form).getByRole('button', { name: 'Reset' }))
    assert.equal(start.value, '')
    absent(within(form).queryByRole('alert'))
  })

  test('without the trigger permission every action is disabled or absent', async () => {
    auth.permissions = [{ domain: 'reporting.snapshot-health', actions: ['view'] }]
    renderPage([summaryMock(), missingMock(GAPS), staleMock(STALE)])
    await loaded()

    for (const button of screen.getAllByRole('button', { name: /^Fix / })) {
      assert.equal((button as HTMLButtonElement).disabled, true)
    }
    absent(screen.queryByRole('form', { name: 'Backfill range' }))
    absent(screen.queryByRole('button', { name: 'Fix all' }))
  })

  test('stale days: one Fix regenerates that day; Fix all confirms once and runs every day in order', async () => {
    const order: string[] = []
    const regenerated = (day: string) => vi.fn(() => {
      order.push(day)
      return mutationResult('regenerateStaleSnapshot')
    })
    const first = regenerated('2026-09-28')
    const second = regenerated('2026-09-29')
    renderPage([
      summaryMock(),
      missingMock(GAPS),
      staleMock(STALE),
      {
        request: {
          query: REGENERATE_STALE_SNAPSHOT_MUTATION,
          variables: { tenant: 'core', whitelabelId: 'wl-1', reportingDay: '2026-09-28', currency: 'INR' },
        },
        result: first,
        maxUsageCount: 2,
      },
      {
        request: {
          query: REGENERATE_STALE_SNAPSHOT_MUTATION,
          variables: { tenant: 'core', whitelabelId: 'wl-1', reportingDay: '2026-09-29', currency: 'INR' },
        },
        result: second,
      },
    ])
    await loaded()

    const card = screen.getByRole('region', { name: 'Stale sports snapshots' })
    const cells = within(bodyRows('Stale sports snapshots')[1]).getAllByRole('cell').map((cell) => cell.textContent)
    assert.deepEqual(cells, [
      'core', 'wl-1', 'INR', '2026-09-29', 'Asia/Kolkata', '11', '2026-09-29 18:31:00', '2026-09-29 21:02:45', 'Fix',
    ])

    fireEvent.click(within(card).getByRole('button', { name: 'Fix 2026-09-28 · core · INR' }))
    assert.deepEqual(confirmCopy(0), {
      title: 'Regenerate sports snapshot for this day?',
      description:
        'Deletes sports + global rows for this reporting day and rebuilds the full global snapshot (may take a few seconds).',
      confirmLabel: 'Regenerate',
      cancelLabel: 'Cancel',
      tone: undefined,
    })
    await waitFor(() => assert.deepEqual(order, ['2026-09-28']))

    await waitFor(() => assert.equal(
      (within(card).getByRole('button', { name: 'Fix all' }) as HTMLButtonElement).getAttribute('aria-busy'),
      null,
    ))
    fireEvent.click(within(card).getByRole('button', { name: 'Fix all' }))
    assert.deepEqual(confirmCopy(1), {
      title: 'Regenerate all 2 stale day(s)?',
      description: 'Runs sequentially. Each day deletes sports + global snapshot rows and rebuilds.',
      confirmLabel: 'Fix all',
      cancelLabel: 'Cancel',
      tone: undefined,
    })
    await waitFor(() => assert.deepEqual(order, ['2026-09-28', '2026-09-28', '2026-09-29']))
    assert.equal(feedback.confirm.mock.calls.length, 2)
  })

  test('first load: the summary and both tables say they are loading', () => {
    renderPage([
      { ...summaryMock(), delay: Infinity },
      { ...missingMock(GAPS), delay: Infinity },
      { ...staleMock(STALE), delay: Infinity },
    ])
    const pipeline = screen.getByRole('region', { name: 'Pipeline status' })
    assert.equal(pipeline.getAttribute('aria-busy'), 'true')
    assert.equal(within(pipeline).getAllByText('Loading').length, 4)
    screen.getByText('Loading Missing snapshot days')
    screen.getByText('Loading Stale sports snapshots')
    assert.equal(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy'), 'true')
  })

  test('empty: both tables show the legacy all-clear copy, with no pager and no Fix all', async () => {
    renderPage([summaryMock({ ...SUMMARY, missingDaysCount: 0 }), missingMock([]), staleMock([])])
    await screen.findByText('No gaps in the selected lookback window')
    await screen.findByText('No stale sports snapshots in the selected lookback window')
    within(screen.getByRole('region', { name: 'Pipeline status' })).getByText('Healthy')
    absent(screen.queryByRole('navigation', { name: 'Pagination' }))
    absent(screen.queryByRole('button', { name: 'Fix all' }))
    absent(screen.queryByRole('form', { name: 'Backfill range' }))
  })

  test('errors: the summary says it failed, and a failed gaps query offers Retry', async () => {
    renderPage([
      { request: { query: SNAPSHOT_HEALTH_SUMMARY_QUERY }, error: new Error('Summary offline') },
      { request: { query: SNAPSHOT_MISSING_DAYS_QUERY, variables: { lookbackDays: 30 } }, error: new Error('Gaps offline') },
      missingMock(GAPS),
      staleMock(STALE),
    ])

    await screen.findByText('Pipeline status could not be loaded')
    screen.getByText('Summary offline')
    await screen.findByText('Gaps offline')
    const card = screen.getByRole('region', { name: 'Missing snapshot days' })
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' }))
    await within(card).findByRole('button', { name: 'Fix 2026-10-01 · core · INR' })
    absent(within(card).queryByText('Gaps offline'))
  })

  test('Refresh asks Apollo to refetch the legacy list of snapshot queries', async () => {
    renderPage([summaryMock(), missingMock(GAPS), staleMock(STALE)])
    await loaded()
    assert.ok(client)
    const refetch = vi.spyOn(client, 'refetchQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    assert.deepEqual(refetch.mock.calls[0]?.[0], {
      include: [
        'SnapshotHealthSummary',
        'SnapshotMissingDays',
        'SnapshotRunsConnection',
        'SnapshotEventsConnection',
        'SnapshotPgBossOverview',
        'SnapshotStaleDays',
      ],
    })
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy'), null))
  })

  test('gaps page twenty at a time with the legacy total', async () => {
    const many = Array.from({ length: 25 }, (_, index) => gap(`2026-08-${String(index + 1).padStart(2, '0')}`))
    renderPage([summaryMock(), missingMock(many), staleMock(STALE)])
    await screen.findByRole('button', { name: 'Fix 2026-08-01 · core · INR' })

    const card = screen.getByRole('region', { name: 'Missing snapshot days' })
    assert.equal(bodyRows('Missing snapshot days').length, 20)
    within(card).getByText('25 gap(s)')
    fireEvent.click(within(card).getByRole('button', { name: 'Page 2' }))
    assert.equal(bodyRows('Missing snapshot days').length, 5)
    within(card).getByRole('button', { name: 'Fix 2026-08-25 · core · INR' })
  })

  test('the timezone note can be dismissed', async () => {
    renderPage([summaryMock(), missingMock(GAPS), staleMock(STALE)])
    await loaded()
    screen.getByText('Timezone & storage')
    screen.getByText('snapshot_date')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss timezone note' }))
    absent(screen.queryByText('Timezone & storage'))
  })
})
