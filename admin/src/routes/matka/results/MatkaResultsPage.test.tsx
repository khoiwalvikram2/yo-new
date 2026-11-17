/**
 * /matka/results against a mocked GraphQL server: MockedProvider with a link that answers by operation name
 * and records every variable set it is sent; the hooks are the real ones (wrapped only to record their
 * options), so the documents stay in modules/matka/results/graphql.ts, untouched. Covers the list, the
 * statistics, the matka list and the result-events subscription (document, options and the legacy handling
 * of its events), the RBAC requirement and its denial, the filters and their variables, paging, Refresh,
 * the pending-bets notice and View All, the rollback dialog end to end, and the loading, empty and error
 * states. The declare drawer's form has its own file.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  ApolloLink,
  Observable,
  type FetchResult,
  type Observer,
  type Operation,
} from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { istToday } from '@/ui/components/istDate'
import {
  MATKA_RESULTS_QUERY,
  MATKA_RESULT_EVENTS_SUBSCRIPTION,
  ROLLBACK_MATKA_RESULT_MUTATION,
  CREATE_MATKA_RESULT_MUTATION,
} from '@/modules/matka/results'
import { MATKA_CATALOG_QUERY as MATKAS_QUERY } from '@/lib/graphql/matka'
import MatkaResultsPage from './MatkaResultsPage'

interface HookCall {
  document: unknown
  options: Record<string, unknown> | undefined
}

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
}

type Handler = (operation: Operation) => FetchResult | Promise<FetchResult>

const apollo = vi.hoisted(() => ({
  queries: [] as HookCall[],
  mutations: [] as HookCall[],
  subscriptions: [] as HookCall[],
  mutateCalls: [] as Array<Record<string, unknown> | undefined>,
}))
const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))
const feedback = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ document: args[0], options: args[1] as Record<string, unknown> | undefined })
      return actual.useQuery(...args)
    },
    useSubscription: (...args: Parameters<typeof actual.useSubscription>) => {
      apollo.subscriptions.push({ document: args[0], options: args[1] as Record<string, unknown> | undefined })
      return actual.useSubscription(...args)
    },
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({ document: args[0], options: args[1] as Record<string, unknown> | undefined })
      const [mutate, result] = actual.useMutation(...args)
      const recorded = ((options?: Record<string, unknown>) => {
        apollo.mutateCalls.push(options)
        return mutate(options)
      }) as typeof mutate
      return [recorded, result] as const
    },
  }
})

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    children: ReactNode
  }) => {
    guard.calls.push(required)
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/useFormatDate', async () => {
  const { formatInTimeZone } = await import('@/shared/utils/date')
  return {
    useFormatDate: () => ({
      formatDate: (value: string, pattern = 'dd MMM yyyy') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
      formatTime: (value: string, pattern = 'HH:mm') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
    }),
  }
})

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

/* ---------- the mocked server ---------- */

const MATKAS = [
  { __typename: 'Matka', id: 'm1', name: 'Kalyan', code: 'KLN' },
  { __typename: 'Matka', id: 'm2', name: 'Milan Day', code: 'MLD' },
].map((matka) => ({
  ...matka,
  description: null,
  timezone: 'Asia/Kolkata',
  status: 'ACTIVE',
  priority: 1,
  schedule: null,
  limits: null,
  settings: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}))

function row(id: string, patch: Record<string, unknown> = {}) {
  return {
    __typename: 'MatkaResult',
    id,
    tenant: 't1',
    matkaId: 'm1',
    date: '2026-10-05',
    type: 'open',
    result: '45',
    declaredBy: 'u-1',
    declaredByName: 'Ravi Admin',
    declaredAt: '2026-10-05T04:00:00.000Z',
    rolledBackAt: null,
    rolledBackBy: null,
    rolledBackByName: null,
    rollbackReason: null,
    rollbackTag: null,
    createdAt: '2026-10-05T04:00:00.000Z',
    pendingBetsCount: 0,
    ...patch,
  }
}

function defaultRows() {
  return [
    row('r1', { date: istToday(), result: '45', pendingBetsCount: 3, declaredAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() }),
    row('r2', { matkaId: 'm2', type: 'close', result: '456', declaredByName: null, declaredBy: 'u-2', pendingBetsCount: 1 }),
    row('r3', { matkaId: 'm9', date: '2026-10-04', result: '12', rolledBackAt: '2026-10-04T12:00:00.000Z' }),
  ]
}

interface ServerState {
  calls: ServerCall[]
  rows: ReturnType<typeof row>[]
  total: number
  listError: Error | null
  rollback: { success: boolean; message: string }
  subscribers: Array<Observer<FetchResult>>
}

let server: ServerState

function calls(operationName: string) {
  return server.calls.filter((call) => call.operationName === operationName)
}

/** Variables as they travel: undefined keys dropped. */
function sent(call: ServerCall | undefined) {
  return JSON.parse(JSON.stringify(call?.variables ?? null)) as Record<string, unknown>
}

/** The page's own list: the statistics ask the same operation with `{ limit: 1000 }` and no sort. */
function listCalls() {
  return calls('MatkaResults').filter((call) => {
    const filters = (call.variables as { filters?: { sort?: string } }).filters
    return Boolean(filters?.sort)
  })
}

function lastList() {
  const list = listCalls()
  return sent(list[list.length - 1])
}

const handler: Handler = (operation) => {
  switch (operation.operationName) {
    case 'MatkaResults': {
      const filters = (operation.variables as { filters?: { sort?: string } }).filters
      if (filters?.sort && server.listError) throw server.listError
      return {
        data: {
          matkaResults: { __typename: 'MatkaResultPage', items: server.rows, total: server.total },
        },
      }
    }
    case 'MatkaCatalog':
      return { data: { matkas: { __typename: 'MatkaPage', items: MATKAS, total: MATKAS.length } } }
    case 'RollbackMatkaResult':
      return {
        data: {
          rollbackMatkaResult: {
            __typename: 'MatkaResultPayload',
            success: server.rollback.success,
            message: server.rollback.message,
            result: null,
            impact: null,
          },
        },
      }
    default:
      throw new Error(`unexpected operation ${operation.operationName}`)
  }
}

function serverLink() {
  return new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
    server.calls.push({ operationName: operation.operationName, variables: { ...operation.variables } })
    if (operation.operationName === 'MatkaResultEvents') {
      server.subscribers.push(observer)
      return
    }
    Promise.resolve()
      .then(() => handler(operation))
      .then(
        (result) => {
          observer.next(result)
          observer.complete()
        },
        (error: unknown) => observer.error(error),
      )
  }))
}

function renderPage() {
  return render(
    <MockedProvider link={serverLink()}>
      <MemoryRouter initialEntries={['/matka/results']}>
        <PageEyebrowProvider value="Trading">
          <MatkaResultsPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded() {
  const view = renderPage()
  await screen.findByRole('table', { name: 'Matka results' })
  await waitFor(() => assert.ok(screen.queryByText('Loading Matka results') === null))
  await waitFor(() => assert.equal(screen.getByRole('group', { name: 'Matka result statistics' }).getAttribute('aria-busy'), null))
  return view
}

function table() {
  return screen.getByRole('table', { name: 'Matka results' })
}

function bodyRows() {
  const [, ...rows] = within(table()).getAllByRole('row')
  return rows
}

beforeEach(() => {
  server = {
    calls: [],
    rows: defaultRows(),
    total: 3,
    listError: null,
    rollback: { success: true, message: 'Rolled back' },
    subscribers: [],
  }
  apollo.queries.length = 0
  apollo.mutations.length = 0
  apollo.subscriptions.length = 0
  apollo.mutateCalls.length = 0
  guard.allowed = true
  guard.calls.length = 0
  feedback.toast.mockReset()
})

describe('MatkaResultsPage', () => {
  test('loads the list, statistics, matkas and the subscription with their exact documents and options', async () => {
    renderPage()
    await renderLoadedAfterMount()

    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Matka Results')
    assert.ok(screen.queryByText('Trading') === null)
    assert.ok(screen.queryByText('Manage and declare Matka results') === null)
    assert.deepEqual(guard.calls[0], [{ domain: 'matka.results', actions: ['view', 'create', 'rollback'] }])

    const list = apollo.queries.find((call) => call.document === MATKA_RESULTS_QUERY
      && (call.options?.variables as { filters?: { sort?: string } })?.filters?.sort)
    assert.ok(list)
    assert.equal(list.options?.errorPolicy, 'all')
    assert.equal(list.options?.fetchPolicy, 'cache-and-network')
    assert.deepEqual(lastList(), { filters: { page: 1, limit: 20, sort: 'createdAt:desc' } })

    const stats = calls('MatkaResults').find((call) => !sent(call).filters || !(sent(call).filters as { sort?: string }).sort)
    assert.deepEqual(sent(stats), { filters: { limit: 1000 } })
    assert.deepEqual(sent(calls('MatkaCatalog')[0]), { filters: { page: 1, limit: 1000 } })
    assert.ok(apollo.queries.some((call) => call.document === MATKAS_QUERY))

    assert.equal(apollo.subscriptions.length > 0, true)
    assert.ok(apollo.subscriptions.every((call) => call.document === MATKA_RESULT_EVENTS_SUBSCRIPTION))
    assert.deepEqual(apollo.subscriptions[0].options, { errorPolicy: 'all' })
    assert.equal(calls('MatkaResultEvents').length, 1)

    const rollbackHook = apollo.mutations.find((call) => call.document === ROLLBACK_MATKA_RESULT_MUTATION)
    assert.deepEqual(rollbackHook?.options, { refetchQueries: [{ query: MATKA_RESULTS_QUERY }], errorPolicy: 'all' })
    assert.equal(apollo.mutations.some((call) => call.document === CREATE_MATKA_RESULT_MUTATION), false,
      'the declare form mounts only with its drawer')
  })

  test('shows the statistics, the headers and every cell rule', async () => {
    await renderLoaded()

    const stats = screen.getByRole('group', { name: 'Matka result statistics' })
    assert.ok(within(stats).getByText('Total Results'))
    assert.ok(within(stats).getByText('1 today'))
    assert.ok(within(stats).getByText('0 pending close'))
    assert.ok(within(stats).getByText('100% completion'))
    assert.ok(within(stats).getByText('33%'))

    assert.equal(screen.getByRole('heading', { level: 2, name: 'Results' }).textContent, 'Results')
    assert.ok(screen.getByText('3 results'))
    assert.deepEqual(
      within(table()).getAllByRole('columnheader').map((header) => header.textContent),
      ['Market', 'Date', 'Type', 'Result', 'Status', 'Declared By', 'Declared At', 'Actions'],
    )

    const [first, second, third] = bodyRows()
    assert.ok(within(first).getByText('Kalyan'))
    assert.equal(within(first).getAllByText('Today').length, 2, 'day line and Today chip, as before')
    assert.ok(within(first).getByText('3 bets'))
    assert.ok(within(first).getByText('3 pending bets waiting for result'))
    assert.ok(within(first).getByText('3 pending bets need settlement'))
    assert.ok(within(first).getByText('OPEN'))
    assert.ok(within(first).getByText('45'))
    assert.ok(within(first).getByText('Open'))
    assert.ok(within(first).getByText('Ravi Admin'))
    assert.ok(within(first).getByRole('img', { name: 'Declared within the last hour' }))
    assert.ok(within(first).getByRole('button', { name: 'Copy Matka ID' }))
    assert.ok(within(first).getByRole('button', { name: `Rollback Kalyan ${istToday()} OPEN result` }))

    assert.ok(within(second).getByText('Milan Day'))
    assert.ok(within(second).getByText('Oct 5'))
    assert.ok(within(second).getByText('2026-10-05'))
    assert.ok(within(second).getByText('Mon'))
    assert.ok(within(second).getByText('CLOSE'))
    assert.ok(within(second).getByText('Closed'))
    assert.ok(within(second).getByText('u-2'), 'the declarer id when no name was resolved')
    assert.ok(within(second).getByText('1 bet'))
    assert.ok(within(second).getByText('Oct 5, 2026'))
    assert.ok(within(second).getByText('9:30 AM'))
    assert.ok(within(second).queryByRole('img', { name: 'Declared within the last hour' }) === null)

    assert.ok(within(third).getByText('m9'), 'an unknown matka shows its id')
    assert.ok(within(third).getByText('Rolled Back'))
    assert.ok(within(third).getByText('RB'))
    assert.ok(within(third).queryByRole('button', { name: /^Rollback / }) === null)
  })

  test('a denied caller sees the guard and starts no query and no subscription', async () => {
    guard.allowed = false
    renderPage()

    assert.ok(screen.getByRole('alert'))
    await act(async () => {
      await Promise.resolve()
    })
    assert.equal(server.calls.length, 0)
    assert.equal(apollo.queries.length, 0)
    assert.equal(apollo.subscriptions.length, 0)
  })

  test('the pending-bets notice lists three results, the rest as "and N more...", and View All asks for active ones', async () => {
    server.rows = [
      row('a', { matkaId: 'm1', date: '2026-10-01', pendingBetsCount: 2 }),
      row('b', { matkaId: 'm2', date: '2026-10-02', pendingBetsCount: 1 }),
      row('c', { matkaId: 'm9', date: '2026-10-03', pendingBetsCount: 5 }),
      row('d', { matkaId: 'm1', date: '2026-10-04', pendingBetsCount: 1 }),
      row('e', { matkaId: 'm1', date: '2026-10-05', pendingBetsCount: 0 }),
    ]
    server.total = 5
    await renderLoaded()

    assert.ok(screen.getByText('9 pending bets waiting for settlement'))
    assert.ok(screen.getByText('across 4 results'))
    assert.ok(screen.getByText(
      'Kalyan (KLN) - 2026-10-01 (2 bets), Milan Day (MLD) - 2026-10-02 (1 bet), 2026-10-03 - 2026-10-03 (5 bets) and 1 more...',
    ))

    fireEvent.click(screen.getByRole('button', { name: 'View All' }))
    await waitFor(() => assert.equal((lastList().filters as { rolledBack?: boolean }).rolledBack, false))
    assert.equal(screen.getByText(/filters? applied/).textContent, '1 filter applied')
  })

  test('no notice without pending bets', async () => {
    server.rows = [row('x', { pendingBetsCount: 0 })]
    server.total = 1
    await renderLoaded()
    assert.ok(screen.queryByText(/waiting for settlement/) === null)
    assert.ok(screen.getByText('1 result'))
  })

  test('search, market, type, date and status reach the list query, count, and Clear all restores the defaults', async () => {
    await renderLoaded()
    assert.equal(screen.getByText(/filters? applied/).textContent, '0 filters applied')

    const search = screen.getByRole('searchbox', { name: 'Search results' })
    assert.equal(search.getAttribute('placeholder'), 'Search result, declared by...')
    fireEvent.change(search, { target: { value: '4' } })
    assert.equal(screen.getByText(/filters? applied/).textContent, '1 filter applied', 'one character counts')
    fireEvent.change(search, { target: { value: ' 45 ' } })
    await waitFor(() => assert.equal((lastList().filters as { search?: string }).search, '45'))

    const market = screen.getByRole('combobox', { name: 'Market' })
    assert.equal(market.getAttribute('placeholder'), 'All Markets')
    fireEvent.keyDown(market, { key: 'ArrowDown' })
    const marketList = screen.getByRole('listbox', { name: 'Market' })
    assert.deepEqual(within(marketList).getAllByRole('option').map((option) => option.textContent),
      ['Kalyan (KLN)', 'Milan Day (MLD)'])
    fireEvent.click(within(marketList).getByRole('option', { name: 'Milan Day (MLD)' }))
    await waitFor(() => assert.equal((lastList().filters as { matkaId?: string }).matkaId, 'm2'))

    const type = screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement
    assert.deepEqual([...type.options].map((option) => option.textContent), ['All Types', 'Open', 'Close'])
    fireEvent.change(type, { target: { value: 'close' } })
    await waitFor(() => assert.equal((lastList().filters as { type?: string }).type, 'close'))

    const status = screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement
    assert.deepEqual([...status.options].map((option) => option.textContent), ['All Status', 'Active', 'Rolled Back'])
    fireEvent.change(status, { target: { value: 'rolledBack' } })
    await waitFor(() => assert.equal((lastList().filters as { rolledBack?: boolean }).rolledBack, true))
    fireEvent.change(status, { target: { value: '' } })
    await waitFor(() => assert.ok(!('rolledBack' in (lastList().filters as object))))

    fireEvent.click(screen.getByRole('button', { name: 'Date range: All dates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.deepEqual(lastList(), {
      filters: {
        matkaId: 'm2',
        type: 'close',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-15',
        search: '45',
        page: 1,
        limit: 20,
        sort: 'createdAt:desc',
      },
    }))
    assert.equal(screen.getByText(/filters? applied/).textContent, '4 filters applied')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.deepEqual(lastList(), { filters: { page: 1, limit: 20, sort: 'createdAt:desc' } }))
    assert.equal(screen.getByText(/filters? applied/).textContent, '0 filters applied')
  })

  test('pages through the server total, a page size returns to page 1, and Clear all restores 20 rows', async () => {
    server.total = 45
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => assert.deepEqual(lastList(), { filters: { page: 2, limit: 20, sort: 'createdAt:desc' } }))

    const size = screen.getByRole('combobox', { name: /rows per page/i }) as HTMLSelectElement
    assert.deepEqual([...size.options].map((option) => option.value), ['10', '20', '50', '100'])
    fireEvent.change(size, { target: { value: '50' } })
    await waitFor(() => assert.deepEqual(lastList(), { filters: { page: 1, limit: 50, sort: 'createdAt:desc' } }))

    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'open' } })
    await waitFor(() => assert.equal((lastList().filters as { type?: string }).type, 'open'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.deepEqual(lastList(), { filters: { page: 1, limit: 20, sort: 'createdAt:desc' } }))
  })

  test('Refresh asks for the same list again, with no extra variables', async () => {
    await renderLoaded()
    const before = listCalls().length

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(listCalls().length, before + 1))
    assert.deepEqual(lastList(), { filters: { page: 1, limit: 20, sort: 'createdAt:desc' } })
  })

  test('a result event arrives and, as before, the page does not refetch (its handler reads data.data)', async () => {
    await renderLoaded()
    const before = listCalls().length
    assert.equal(server.subscribers.length, 1)

    await act(async () => {
      server.subscribers[0].next?.({
        data: {
          matkaResultEvents: {
            __typename: 'MatkaResultEvent',
            id: 'r9',
            matkaId: 'm1',
            date: istToday(),
            type: 'open',
            result: '77',
            declaredBy: 'u-1',
            declaredAt: new Date().toISOString(),
            rolledBackAt: null,
            rolledBackBy: null,
          },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    assert.equal(listCalls().length, before)
  })

  test('loading, then an empty list with its Adjust Filters notice', async () => {
    server.rows = []
    server.total = 0
    renderPage()
    assert.ok(screen.getByText('Loading Matka results'))
    assert.ok(screen.getByText('Loading...'))
    assert.equal(screen.getByRole('group', { name: 'Matka result statistics' }).getAttribute('aria-busy'), 'true')

    assert.ok(await screen.findByText('No results found'))
    assert.ok(screen.getByText('Adjust your filters to see results'))
    assert.ok(screen.getByText('0 results'))
    fireEvent.click(screen.getByRole('button', { name: 'Adjust Filters' }))
    assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Info',
      message: 'Adjust filters',
      tone: 'info',
      duration: 4500,
    })
  })

  test('a failed list says so with Retry, which asks again', async () => {
    server.listError = new Error('Network down')
    renderPage()
    assert.ok(await screen.findByText('Failed to load results: Network down'))

    server.listError = null
    const before = listCalls().length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.equal(listCalls().length, before + 1))
    assert.ok(await screen.findByText('Kalyan'))
  })

  test('rollback: typed confirmation, required reason, exact input and context, then close and refetch', async () => {
    await renderLoaded()

    const trigger = screen.getByRole('button', { name: `Rollback Kalyan ${istToday()} OPEN result` })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('alertdialog', { name: 'Rollback Result' })
    assert.ok(within(dialog).getByText('Warning'))
    assert.ok(within(dialog).getByText(/Rolling back a result will mark it as invalid/))
    const facts = within(dialog).getAllByRole('term').map((term) => term.textContent)
    assert.deepEqual(facts, ['Market', 'Date', 'Type', 'Result'])
    // The market by its name, as its row shows it (the dialog used to show the raw id "m1").
    assert.deepEqual(within(dialog).getAllByRole('definition').map((value) => value.textContent),
      ['Kalyan', istToday(), 'OPEN', '45'])

    const reason = within(dialog).getByRole('textbox', { name: /Rollback Reason/ })
    await waitFor(() => assert.ok(document.activeElement === reason))
    const confirmButton = within(dialog).getByRole('button', { name: 'Confirm Rollback' })
    assert.equal(confirmButton.getAttribute('aria-disabled'), 'true')
    assert.equal(confirmButton.getAttribute('aria-describedby') !== null, true)

    const confirmation = within(dialog).getByRole('textbox', { name: 'Confirmation' })
    assert.equal(confirmation.getAttribute('placeholder'), "Type 'ROLLBACK' to confirm")
    fireEvent.change(confirmation, { target: { value: 'rollback' } })
    assert.equal(confirmButton.getAttribute('aria-disabled'), 'true', 'the word is case-sensitive')
    fireEvent.change(confirmation, { target: { value: 'ROLLBACK' } })
    assert.equal(confirmButton.getAttribute('aria-disabled'), null)

    fireEvent.click(confirmButton)
    assert.ok(within(dialog).getByText('Please provide a reason for rollback'))
    assert.ok(document.activeElement === reason)
    assert.equal(calls('RollbackMatkaResult').length, 0)

    fireEvent.change(reason, { target: { value: 'Wrong digit' } })
    assert.ok(within(dialog).queryByText('Please provide a reason for rollback') === null)
    const category = within(dialog).getByRole('combobox', { name: 'Category' }) as HTMLSelectElement
    assert.deepEqual([...category.options].map((option) => option.textContent),
      ['Select category', 'Error', 'Correction', 'Fraud', 'Other'])
    fireEvent.change(category, { target: { value: 'correction' } })

    const before = listCalls().length
    fireEvent.click(confirmButton)
    await waitFor(() => assert.equal(calls('RollbackMatkaResult').length, 1))
    assert.deepEqual(sent(calls('RollbackMatkaResult')[0]), {
      input: { id: 'r1', reason: 'Wrong digit', tag: 'correction' },
    })
    const mutateOptions = apollo.mutateCalls[apollo.mutateCalls.length - 1]
    assert.deepEqual(mutateOptions?.context, { uiToast: 'notification' })

    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null))
    await waitFor(() => assert.ok(listCalls().length > before))
  })

  test('rollback without a category sends no tag; a refused rollback keeps the dialog open', async () => {
    server.rollback = { success: false, message: 'Already settled' }
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: `Rollback Kalyan ${istToday()} OPEN result` }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Rollback Result' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Rollback Reason/ }), { target: { value: '  ' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Confirmation' }), { target: { value: 'ROLLBACK' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Rollback' }))

    await waitFor(() => assert.equal(calls('RollbackMatkaResult').length, 1))
    assert.deepEqual(sent(calls('RollbackMatkaResult')[0]), { input: { id: 'r1', reason: '  ' } },
      'whitespace counts as a reason (antd required rule), and no category is left out')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    assert.ok(screen.getByRole('alertdialog', { name: 'Rollback Result' }))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null))
  })

  test('Declare Result opens the declare drawer and Cancel closes it', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Declare Result' }))
    const drawer = await screen.findByRole('dialog', { name: 'Declare Matka Result' })
    assert.ok(within(drawer).getByText('Declare open or close result for a Matka market'))
    assert.ok(apollo.mutations.some((call) => call.document === CREATE_MATKA_RESULT_MUTATION))

    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog', { name: 'Declare Matka Result' }) === null))
  })

  test('a Super Admin in core mode is asked to select a whitelabel: no query, no subscription, no Declare Result', async () => {
    // Core mode read the platform's own tenant, which has no results: TOTAL RESULTS 0 and an empty table.
    const auth = useAuthStore.getState(), ui = useUIStore.getState()
    useAuthStore.setState({ roles: ['Super Admin'] }); useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    try {
      const core = renderPage()
      assert.ok(await screen.findByText('Select a whitelabel'))
      assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Matka Results')
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      assert.equal(server.calls.length, 0)
      assert.equal(apollo.queries.length, 0)
      assert.equal(apollo.subscriptions.length, 0)
      assert.ok(screen.queryByRole('button', { name: 'Declare Result' }) === null)
      assert.ok(screen.queryByRole('table', { name: 'Matka results' }) === null)
      core.unmount()
      // With a site selected the same admin gets the page, as a whitelabel admin always does.
      useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'grandwinn-com' })
      await renderLoaded()
      assert.ok(screen.queryByText('Select a whitelabel') === null)
      assert.equal(calls('MatkaResultEvents').length, 1)
    } finally {
      useAuthStore.setState({ roles: auth.roles }); useUIStore.setState({ directorMode: ui.directorMode, selectedWhitelabelId: ui.selectedWhitelabelId })
    }
  })
})

async function renderLoadedAfterMount() {
  await screen.findByRole('table', { name: 'Matka results' })
  await waitFor(() => assert.ok(screen.queryByText('Loading Matka results') === null))
  await waitFor(() => assert.equal(screen.getByRole('group', { name: 'Matka result statistics' }).getAttribute('aria-busy'), null))
}
