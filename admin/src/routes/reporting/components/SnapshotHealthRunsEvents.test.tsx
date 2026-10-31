/**
 * The runs/events/pg-boss card of /reporting/snapshot-health against a mocked GraphQL server. The real
 * Apollo hooks run inside MockedProvider; they are wrapped so the options the card passes are recorded.
 * The Drawer is a light stand-in (the kit Drawer has its own suite); Tabs, DataTable and Tooltip are real.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import {
  SNAPSHOT_EVENTS_CONNECTION_QUERY,
  SNAPSHOT_PG_BOSS_OVERVIEW_QUERY,
  SNAPSHOT_RUNS_CONNECTION_QUERY,
} from '@/modules/reporting/graphql'
import { SnapshotHealthRunsEvents } from './SnapshotHealthRunsEvents'

interface HookCall {
  name: string
  document: unknown
  options: Record<string, unknown>
}

interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  sub?: ReactNode
  size?: string
  children: ReactNode
}

const apollo = vi.hoisted(() => ({ queries: [] as HookCall[] }))
const drawer = vi.hoisted(() => ({ sizes: [] as Array<string | undefined> }))

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
  }
})

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string, pattern?: string) => `at ${value}${pattern ? ` (${pattern})` : ''}`,
  }),
}))

vi.mock('@/ui/components/Drawer', () => ({
  Drawer: ({ open, onOpenChange, title, sub, size, children }: DrawerProps) => {
    drawer.sizes.push(size)
    if (!open) return null
    return (
      <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
        <h2>{title}</h2>
        {sub ? <p data-testid="drawer-sub">{sub}</p> : null}
        <button type="button" onClick={() => onOpenChange(false)}>Close dialog</button>
        {children}
      </div>
    )
  },
}))

function run(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    trigger: 'daily',
    status: 'completed',
    startedAt: `2026-10-0${id.slice(-1)}T20:30:00.000Z`,
    finishedAt: null,
    summaryJson: { days: 1 },
    errorMessage: null,
    ...overrides,
  }
}

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    runId: 'run-1',
    occurredAt: '2026-10-06T20:31:00.000Z',
    level: 'info',
    eventType: 'snapshot.day.complete',
    tenant: 'core',
    whitelabelId: 'wl-1',
    currency: 'INR',
    reportingDay: '2026-10-06',
    snapshotDateUtc: '2026-10-05T18:30:00.000Z',
    reportingDayLabel: '6 Oct (IST)',
    timezoneNote: 'Asia/Kolkata day, stored as 2026-10-05T18:30Z',
    domain: 'sports',
    pgBossJobId: null,
    singletonKey: null,
    message: 'Snapshot written',
    detailJson: null,
    ...overrides,
  }
}

interface PageInfo {
  startCursor: string | null
  endCursor: string | null
  hasNextPage: boolean
  hasPreviousPage: boolean
}

const PAGE_INFO: PageInfo = { startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false }

function runsMock(nodes: unknown[], pageInfo: PageInfo = PAGE_INFO, after: string | null = null): MockedResponse {
  return {
    request: { query: SNAPSHOT_RUNS_CONNECTION_QUERY, variables: { first: 25, after, trigger: null } },
    result: { data: { snapshotRunsConnection: { nodes, pageInfo } } },
    maxUsageCount: 5,
  }
}

function eventsMock(nodes: unknown[], variables: Record<string, unknown> = {}, pageInfo: PageInfo = PAGE_INFO): MockedResponse {
  return {
    request: {
      query: SNAPSHOT_EVENTS_CONNECTION_QUERY,
      variables: { first: 40, after: null, runId: null, errorsOnly: false, ...variables },
    },
    result: { data: { snapshotEventsConnection: { nodes, pageInfo } } },
    maxUsageCount: 5,
  }
}

function pgMock(overview: Record<string, unknown>): MockedResponse {
  return {
    request: { query: SNAPSHOT_PG_BOSS_OVERVIEW_QUERY },
    result: {
      data: {
        snapshotPgBossOverview: { jobCounts: [], schedules: [], readError: null, ...overview },
      },
    },
    maxUsageCount: 5,
  }
}

const BASE_MOCKS = () => [
  runsMock([run('run-1', { status: 'failed', trigger: 'manual' }), run('run-2', { summaryJson: null })]),
  eventsMock([event('ev-1')]),
  pgMock({}),
]

function renderCard(mocks: MockedResponse[]) {
  return render(
    <MockedProvider mocks={mocks} addTypename={false}>
      <SnapshotHealthRunsEvents />
    </MockedProvider>,
  )
}

/** Elements are checked by identity, never through a node:assert diff of a jsdom node. */
function absent(element: HTMLElement | null) {
  assert.ok(element === null, 'expected the element to be absent')
}

function bodyRows(tableName: string): HTMLElement[] {
  const table = screen.getByRole('table', { name: tableName })
  return within(table).getAllByRole('row').slice(1)
}

function cellsOf(row: HTMLElement): Array<string | null> {
  return within(row).getAllByRole('cell').map((cell) => cell.textContent)
}

beforeEach(() => {
  apollo.queries.length = 0
  drawer.sizes.length = 0
})

describe('SnapshotHealthRunsEvents', () => {
  test('sends the four legacy queries with their exact variables and options', async () => {
    renderCard(BASE_MOCKS())
    await screen.findByRole('button', { name: 'Events for manual run started at 2026-10-01T20:30:00.000Z' })

    const last = (predicate: (call: HookCall) => boolean) => [...apollo.queries].reverse().find(predicate)
    const runs = last((call) => call.name === 'SnapshotRunsConnection')
    assert.equal(runs?.document, SNAPSHOT_RUNS_CONNECTION_QUERY)
    assert.deepEqual(runs?.options, {
      variables: { first: 25, after: null, trigger: null },
      fetchPolicy: 'cache-and-network',
      notifyOnNetworkStatusChange: true,
    })
    const log = last((call) => call.name === 'SnapshotEventsConnection' && call.options.skip === undefined)
    assert.equal(log?.document, SNAPSHOT_EVENTS_CONNECTION_QUERY)
    assert.deepEqual(log?.options, {
      variables: { first: 40, after: null, runId: null, errorsOnly: false },
      fetchPolicy: 'cache-and-network',
      notifyOnNetworkStatusChange: true,
    })
    const runEvents = last((call) => call.name === 'SnapshotEventsConnection' && call.options.skip !== undefined)
    assert.deepEqual(runEvents?.options, {
      variables: { first: 200, after: null, runId: null, errorsOnly: false },
      skip: true,
      fetchPolicy: 'network-only',
    })
    const pg = last((call) => call.name === 'SnapshotPgBossOverview')
    assert.equal(pg?.document, SNAPSHOT_PG_BOSS_OVERVIEW_QUERY)
    assert.deepEqual(pg?.options, { fetchPolicy: 'cache-and-network' })

    screen.getByRole('heading', { level: 2, name: 'Pipeline runs & events' })
    assert.deepEqual(
      screen.getAllByRole('tab').map((tab) => [tab.textContent, tab.getAttribute('aria-selected')]),
      [['Pipeline runs', 'true'], ['Event log', 'false'], ['pg-boss', 'false']],
    )
  })

  test('runs: status pills, the summary JSON, and Load more merging the next page by id', async () => {
    renderCard([
      runsMock(
        [run('run-1', { status: 'failed', trigger: 'manual' }), run('run-2', { summaryJson: null })],
        { ...PAGE_INFO, endCursor: 'cursor-2', hasNextPage: true },
      ),
      runsMock(
        [run('run-2', { status: 'partial', summaryJson: null }), run('run-3', { status: 'running' })],
        PAGE_INFO,
        'cursor-2',
      ),
      eventsMock([]),
      pgMock({}),
    ])
    await screen.findByRole('button', { name: 'Load more runs' })

    assert.deepEqual(bodyRows('Pipeline runs').map(cellsOf), [
      ['at 2026-10-01T20:30:00.000Z', 'manual', 'failed', '{"days":1}', 'Events'],
      ['at 2026-10-02T20:30:00.000Z', 'daily', 'completed', '—', 'Events'],
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Load more runs' }))
    await waitFor(() => assert.equal(bodyRows('Pipeline runs').length, 3))
    assert.deepEqual(bodyRows('Pipeline runs').map((row) => cellsOf(row)[2]), ['failed', 'partial', 'running'])
    absent(screen.queryByRole('button', { name: 'Load more runs' }))
  })

  test('Events opens the run drawer with its own network-only query and the run tag', async () => {
    renderCard([
      ...BASE_MOCKS(),
      {
        request: {
          query: SNAPSHOT_EVENTS_CONNECTION_QUERY,
          variables: { first: 200, after: null, runId: 'run-1', errorsOnly: false },
        },
        result: {
          data: {
            snapshotEventsConnection: {
              nodes: [event('ev-9', { level: 'error', message: 'Rollup failed', reportingDay: null })],
              pageInfo: PAGE_INFO,
            },
          },
        },
      },
    ])
    const open = await screen.findByRole('button', { name: 'Events for manual run started at 2026-10-01T20:30:00.000Z' })
    fireEvent.click(open)

    const dialog = await screen.findByRole('dialog', { name: 'Run events' })
    assert.equal(within(dialog).getByTestId('drawer-sub').textContent, 'manual · failed')
    assert.equal(drawer.sizes.at(-1), 'lg')
    await within(dialog).findByText('Rollup failed')
    const row = within(within(dialog).getByRole('table', { name: 'Run events' })).getAllByRole('row')[1]
    assert.deepEqual(cellsOf(row), ['at 2026-10-06T20:31:00.000Z', 'error', 'snapshot.day.complete', 'sports', '—', 'Rollup failed'])
    const drawerCall = [...apollo.queries].reverse().find((call) => call.options.skip === false)
    assert.deepEqual(drawerCall?.options, {
      variables: { first: 200, after: null, runId: 'run-1', errorsOnly: false },
      skip: false,
      fetchPolicy: 'network-only',
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    absent(screen.queryByRole('dialog'))
  })

  test('event log: Errors only re-queries with errorsOnly, and the reporting day offers its note', async () => {
    renderCard([
      runsMock([]),
      eventsMock([
        event('ev-1'),
        event('ev-2', { level: 'warn', reportingDay: null, message: 'Late bet' }),
      ]),
      eventsMock([event('ev-3', { level: 'error', message: 'Only errors' })], { errorsOnly: true }),
      pgMock({}),
    ])
    await screen.findByText('No data')

    fireEvent.click(screen.getByRole('tab', { name: 'Event log' }))
    await screen.findByText('Snapshot written')
    assert.deepEqual(bodyRows('Event log').map(cellsOf), [
      ['at 2026-10-06T20:31:00.000Z', 'info', 'snapshot.day.complete', 'sports', '2026-10-06', 'Snapshot written'],
      ['at 2026-10-06T20:31:00.000Z', 'warn', 'snapshot.day.complete', 'sports', '—', 'Late bet'],
    ])

    const day = screen.getByText('2026-10-06')
    assert.equal(day.tabIndex, 0)
    // floating-ui opens a focus tooltip only after keyboard modality, as the kit Tooltip suite does
    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => day.focus())
    const tip = await screen.findByRole('tooltip')
    assert.equal(tip.textContent, 'Asia/Kolkata day, stored as 2026-10-05T18:30Z')

    const toggle = screen.getByRole('switch', { name: 'Errors only' })
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    fireEvent.click(toggle)
    await screen.findByText('Only errors')
    assert.equal(toggle.getAttribute('aria-checked'), 'true')
    const log = [...apollo.queries].reverse().find((call) => call.name === 'SnapshotEventsConnection' && call.options.skip === undefined)
    assert.deepEqual(log?.options.variables, { first: 40, after: null, runId: null, errorsOnly: true })
  })

  test('pg-boss: the read warning, the job counts and the schedules', async () => {
    renderCard([
      runsMock([]),
      eventsMock([]),
      pgMock({
        jobCounts: [{ name: 'reporting-snapshot-daily', state: 'completed', count: 12 }],
        schedules: [{ name: 'reporting-snapshot-daily', cron: '0 2 * * *', timezone: 'Asia/Kolkata' }],
        readError: 'relation "pgboss.archive" does not exist',
      }),
    ])
    await screen.findByText('No data')
    fireEvent.click(screen.getByRole('tab', { name: 'pg-boss' }))

    await screen.findByText('Could not read all pg-boss data')
    screen.getByText('relation "pgboss.archive" does not exist')
    screen.getByText('pgboss.job')
    screen.getByText('pgboss.schedule')
    assert.deepEqual(bodyRows('pg-boss job counts').map(cellsOf), [['reporting-snapshot-daily', 'completed', '12']])
    assert.deepEqual(bodyRows('pg-boss schedules').map(cellsOf), [['reporting-snapshot-daily', '0 2 * * *', 'Asia/Kolkata']])
  })

  test('tabs keep one tab stop and move with the arrow keys', async () => {
    renderCard(BASE_MOCKS())
    const runsTab = await screen.findByRole('tab', { name: 'Pipeline runs' })
    assert.equal(runsTab.tabIndex, 0)
    assert.equal(screen.getByRole('tab', { name: 'Event log' }).tabIndex, -1)
    act(() => runsTab.focus())
    fireEvent.keyDown(runsTab, { key: 'ArrowRight' })
    const eventsTab = screen.getByRole('tab', { name: 'Event log' })
    assert.equal(eventsTab.getAttribute('aria-selected'), 'true')
    assert.ok(document.activeElement === eventsTab, 'focus moves with the selection')
    assert.equal(screen.getByRole('tabpanel').getAttribute('aria-labelledby'), eventsTab.id)
  })

  test('a failed runs query says so and retries; an empty log says No data', async () => {
    renderCard([
      {
        request: { query: SNAPSHOT_RUNS_CONNECTION_QUERY, variables: { first: 25, after: null, trigger: null } },
        error: new Error('Runs offline'),
      },
      runsMock([run('run-1')]),
      eventsMock([]),
      pgMock({}),
    ])
    await screen.findByText('Runs offline')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: 'Events for daily run started at 2026-10-01T20:30:00.000Z' })
    absent(screen.queryByText('Runs offline'))

    fireEvent.click(screen.getByRole('tab', { name: 'Event log' }))
    await screen.findByText('No data')
  })
})
