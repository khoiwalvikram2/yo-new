/**
 * /matka/worli/:id mounted against MockedProvider and a MemoryRouter: the WorliInstance lookup (route id,
 * 5-second poll switched by Auto-refresh, skipped for a bad id), its two subscriptions (instance updates
 * refetch, new bets fill the live feed and raise one replacing toast), the redirects (a bad id at once, a
 * missing or failed session after two seconds), the matka.worli guards (page view/update, controls update),
 * every operator action with its reason prompt and payload (and a failed Resume, Set Message and Void keeping
 * their dialogs open, the suspend prompt's focus target), and the four tabs: the overview from WorliBook,
 * the book's filters, the bets with their search, bid-type variable, export notice and void, and the activity
 * log. The guards, formatters, toast, Dialog shell and the client's subscribe are stubs; the rest is real.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { DocumentNode } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  ADJUST_SUSPEND_WORLI,
  PAUSE_WORLI,
  RESUME_WORLI,
  SET_MESSAGE_WORLI,
  VOID_BET,
  WORLI_ACTIVITY,
  WORLI_BETS,
  WORLI_BET_CREATED,
  WORLI_BOOK,
  WORLI_INSTANCE,
  WORLI_INSTANCE_UPDATED,
} from './gql'
import RunningMarketDetailPage from './RunningMarketDetailPage'

interface SubscriptionCall {
  query: unknown
  variables: Record<string, unknown>
  observer?: { next: (value: unknown) => void }
  closed: boolean
}

const apollo = vi.hoisted(() => ({
  queries: [] as Array<{ query: unknown; options: Record<string, unknown> }>,
  subscriptions: [] as SubscriptionCall[],
}))

const rbac = vi.hoisted(() => ({
  denied: new Set<string>(),
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

const feedback = vi.hoisted(() => ({
  toasts: [] as Array<Record<string, unknown>>,
  dismissed: [] as number[],
  next: 1,
}))

const server = vi.hoisted(() => ({ lookups: 0, bets: [] as Array<Record<string, unknown>>, sent: [] as Array<Record<string, unknown>> }))

/* The restoreFocusTo each open Dialog was given, by title: the stub cannot move focus, so the tests check the
   trigger the real Overlay would return focus to. */
const dialogs = vi.hoisted(() => ({ restoreFocusTo: new Map<string, { readonly current: HTMLElement | null } | undefined>() }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const client = {
    subscribe: ({ query, variables }: { query: unknown; variables: Record<string, unknown> }) => {
      const call: SubscriptionCall = { query, variables, closed: false }
      apollo.subscriptions.push(call)
      return {
        subscribe: (observer: { next: (value: unknown) => void }) => {
          call.observer = observer
          return {
            unsubscribe: () => {
              call.closed = true
            },
          }
        },
      }
    },
  }
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ query: args[0], options: args[1] as Record<string, unknown> })
      return actual.useQuery(...args)
    },
    useApolloClient: () => client,
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
    rbac.calls.push(required)
    const allowed = required.every((req) => req.actions.some((action) => !rbac.denied.has(`${req.domain}:${action}`)))
    return allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `₹${amount.toFixed(2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount,
    getCurrencySymbol: () => '₹',
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDate: (value: string, pattern = 'default') => `${pattern}|${value}`,
    formatTime: (value: string, pattern = 'default') => `${pattern}@${value}`,
    formatDateTime: (value: string, pattern = 'default') => `${pattern}#${value}`,
  }),
}))

vi.mock('@/ui/components/toast', () => ({
  toast: Object.assign(
    (options: Record<string, unknown>) => {
      feedback.toasts.push(options)
      return feedback.next++
    },
    {
      dismiss: (id: number) => {
        feedback.dismissed.push(id)
      },
    },
  ),
}))

vi.mock('@/ui/components/Dialog', () => ({
  Dialog: ({
    open,
    onOpenChange,
    title,
    children,
    footer,
    restoreFocusTo,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: ReactNode
    children: ReactNode
    footer?: ReactNode
    restoreFocusTo?: { readonly current: HTMLElement | null }
  }) => {
    if (!open) return null
    if (typeof title === 'string') dialogs.restoreFocusTo.set(title, restoreFocusTo)
    return (
      <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
        <h2>{title}</h2>
        <button type="button" onClick={() => onOpenChange(false)}>Close dialog</button>
        {children}
        {footer ? <footer>{footer}</footer> : null}
      </div>
    )
  },
}))

const ID = '3f2b8c1e-9a4d-4e6b-8c2f-1a2b3c4d5e6f'

const INSTANCE = {
  id: ID,
  marketId: 'mkt-kalyan-0001',
  marketName: 'Kalyan Worli',
  runDate: '2026-10-07',
  side: 'OPEN',
  status: 'OPEN',
  scheduledOpenAt: '2026-10-07T04:00:00.000Z',
  scheduledLockAt: '2099-10-07T05:30:00.000Z',
  scheduledCloseAt: '2099-10-07T06:00:00.000Z',
  operatorMessage: null as string | null,
  counters: {
    betCount: 1234,
    totalStakeMinor: 1234560,
    exposureTotalMinor: 12000000,
    worstOutcomeKey: '128',
    worstOutcomePlMinor: -250050,
  },
  bidRulesVersionId: 'rules-v2-abcdef',
}

const BOOK = {
  totalStakeMinor: 500000,
  groups: [
    {
      bidType: 'SINGLE',
      items: [
        { selection: '1', betCount: 2, plMinor: -5000 },
        { selection: '2', betCount: 120, plMinor: 300 },
        { selection: '12', betCount: 1, plMinor: -90000 },
      ],
    },
    {
      bidType: 'JODI',
      items: [
        { selection: '21', betCount: 4, plMinor: 0 },
        { selection: '67', betCount: 5, plMinor: -60000 },
      ],
    },
  ],
}

const bet = (patch: Record<string, unknown>) => ({
  id: 'bet-1',
  userId: 'user-abcdefghijkl',
  bidType: 'SP',
  betNumbers: '128',
  betAmount: 100,
  payoutMultiplier: 9.5,
  potentialWin: 950,
  status: 'ACTIVE',
  currency: 'INR',
  createdAt: '2026-10-07T05:00:00.000Z',
  ...patch,
})

const BETS = [
  bet({}),
  bet({ id: 'bet-2', userId: 'user-zzzzzzzz', bidType: 'JODI', betNumbers: '45', status: 'VOID' }),
]

function instanceMock(patch: Partial<typeof INSTANCE> = {}): MockedResponse {
  return {
    request: { query: WORLI_INSTANCE, variables: { id: ID } },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.lookups += 1
      return { data: { worliInstance: { ...INSTANCE, ...patch } } }
    },
  }
}

const bookMock: MockedResponse = {
  request: { query: WORLI_BOOK, variables: { instanceId: ID, side: 'OPEN' } },
  maxUsageCount: Number.POSITIVE_INFINITY,
  result: { data: { worliBook: BOOK } },
}

function betsMock(filters?: Record<string, unknown>, items = BETS): MockedResponse {
  const variables = { instanceId: ID, filters: { bidType: filters?.bidType, search: undefined }, page: 1, limit: 20 }
  return {
    request: { query: WORLI_BETS },
    variableMatcher: value => value.instanceId === ID && value.filters?.bidType === filters?.bidType,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (value) => {
      server.bets.push(value)
      const matching = items.filter(row => !value.filters?.search || [row.userId,row.betNumbers].some(v => String(v).toLowerCase().includes(value.filters.search.toLowerCase())))
      return { data: { worliBets: { total: matching.length, items: matching } } }
    },
  }
}

const activityMock: MockedResponse = {
  request: { query: WORLI_ACTIVITY, variables: { instanceId: ID } },
  maxUsageCount: Number.POSITIVE_INFINITY,
  result: {
    data: {
      worliActivity: [
        { id: 'a2', action: 'LOCK', reason: 'Exposure too high', actorId: 'admin-7', createdAt: '2026-10-07T05:10:00.000Z' },
        { id: 'a1', action: 'MESSAGE', reason: null, actorId: 'admin-3', createdAt: '2026-10-07T05:00:00.000Z' },
      ],
    },
  },
}

function mutationMock(query: DocumentNode, field: string, variables: Record<string, unknown>): MockedResponse {
  return {
    request: { query, variables },
    result: () => {
      server.sent.push({ field, ...variables })
      return { data: { [field]: { success: true, message: 'Done' } } }
    },
  }
}

function renderPage(mocks: MockedResponse[], id = ID) {
  return render(
    <MemoryRouter initialEntries={[`/matka/worli/${id}`]}>
      <MockedProvider mocks={mocks} addTypename={false}>
        <PageEyebrowProvider value="Trading">
          <Routes>
            <Route path="/matka/worli/:id" element={<RunningMarketDetailPage />} />
            <Route path="/matka/worli" element={<p>Worli list route</p>} />
          </Routes>
        </PageEyebrowProvider>
      </MockedProvider>
    </MemoryRouter>,
  )
}

const BASE_MOCKS = () => [instanceMock(), bookMock, betsMock(), activityMock]

function optionsFor(query: unknown) {
  const calls = apollo.queries.filter((call) => call.query === query)
  return calls[calls.length - 1]?.options
}

function statValue(label: string) {
  const group = within(screen.getByRole('group', { name: 'Session statistics' }))
  return (group.getByText(label).nextElementSibling as HTMLElement).textContent
}

function statNote(label: string) {
  const group = within(screen.getByRole('group', { name: 'Session statistics' }))
  return (group.getByText(label).parentElement as HTMLElement).lastElementChild?.textContent
}

async function ready() {
  await screen.findByRole('heading', { level: 1, name: 'Kalyan Worli' })
}

/* Elements are compared by identity: a node:assert diff of a jsdom element can exhaust the worker. */
function assertAbsent(element: Element | null, what = 'element') {
  assert.ok(element === null, `${what} should be absent`)
}
beforeEach(() => {
  apollo.queries.length = 0
  apollo.subscriptions.length = 0
  rbac.denied = new Set()
  rbac.calls.length = 0
  feedback.toasts.length = 0
  feedback.dismissed.length = 0
  server.lookups = 0
  server.bets.length = 0
  server.sent.length = 0
  dialogs.restoreFocusTo.clear()
})

describe('RunningMarketDetailPage', () => {
  test('loads the session by route id and renders the header, stats, times, controls and overview', async () => {
    renderPage(BASE_MOCKS())
    assert.ok(screen.getByText('Loading market details...'))
    await ready()

    assert.deepEqual(optionsFor(WORLI_INSTANCE), { variables: { id: ID }, pollInterval: 5000, skip: false })
    assert.deepEqual(rbac.calls[0], [{ domain: 'matka.worli', actions: ['view', 'update'] }])
    assert.ok(rbac.calls.some((call) => JSON.stringify(call) === JSON.stringify([{ domain: 'matka.worli', actions: ['update'] }])))
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.ok(screen.queryByText('Trading') === null)
    assert.equal(screen.getByRole('link', { name: 'Back' }).getAttribute('href'), '/matka/worli')
    assert.ok(screen.getByText('OPEN SESSION'))
    // The run date shows in the header and in the Market Summary.
    assert.equal(screen.getAllByText('dd MMM yyyy|2026-10-07').length, 2)
    assert.ok(screen.getByText('3f2b8c1e...'))
    assert.match(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && /^\d{2,}:\d{2}:\d{2}$/.test(el.textContent ?? '')).textContent ?? '',
      /^\d{2,}:\d{2}:\d{2}$/,
    )

    assert.equal(statValue('Total Bets'), '1,234')
    assert.equal(statNote('Total Bets'), 'LiveActive betting')
    assert.equal(statValue('Total Stakes'), '₹12,345.60')
    assert.equal(statNote('Total Stakes'), 'Avg: ₹10.00')
    assert.equal(statValue('Exposure Risk'), '₹120,000.00')
    assert.equal(statNote('Exposure Risk'), 'critical')
    assert.equal(statValue('Worst Outcome'), '128')
    assert.equal(statNote('Worst Outcome'), '-₹2500.50')

    const timesCard = screen.getByRole('heading', { level: 2, name: 'Session Times' }).closest('section') as HTMLElement
    const times = within(within(timesCard).getByRole('list'))
    assert.ok(times.getByText('h:mm a@2026-10-07T04:00:00.000Z'))
    assert.ok(times.getByText('h:mm a@2099-10-07T05:30:00.000Z'))
    assert.ok(times.getByText('h:mm a@2099-10-07T06:00:00.000Z'))

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Operator Controls' }))
    for (const name of ['Pause', 'Resume', 'Lock Now', 'Close Now', 'Set Message', 'Adjust Suspend Minutes']) {
      assert.ok(screen.getByRole('button', { name }))
    }

    // The overview tab's book-backed cards.
    await screen.findByRole('heading', { level: 2, name: 'Bid Type Distribution' })
    const summary = within(screen.getByRole('heading', { level: 2, name: 'Market Summary' }).closest('section') as HTMLElement)
    assert.ok(summary.getByText('mkt-kalyan-0001'))
    assert.ok(summary.getByText('rules-v2'))
    const risks = within(screen.getByRole('heading', { level: 2, name: 'Top Risk Selections' }).closest('section') as HTMLElement)
    const riskRows = risks.getAllByRole('listitem')
    assert.equal(riskRows.length, 3)
    assert.ok(within(riskRows[0]).getByText('-₹900.00'))
    assert.ok(within(riskRows[0]).getByText('1 bets'))
    assert.equal(screen.getAllByText('selections').length, 2)

    assert.deepEqual(
      apollo.subscriptions.map((call) => [
        call.query === WORLI_INSTANCE_UPDATED ? 'updated' : call.query === WORLI_BET_CREATED ? 'bet' : 'other',
        call.variables,
      ]),
      [
        ['updated', { id: ID }],
        ['bet', { instanceId: ID }],
      ],
    )
  })

  test('a denied caller sees the denial; nothing is queried or subscribed', () => {
    rbac.denied = new Set(['matka.worli:view', 'matka.worli:update'])
    renderPage(BASE_MOCKS())
    assert.equal(screen.getByRole('alert').textContent, 'Access denied')
    assert.equal(apollo.queries.length, 0)
    assert.equal(apollo.subscriptions.length, 0)
  })

  test('a viewer without update sees the page, and the controls card says access is denied', async () => {
    rbac.denied = new Set(['matka.worli:update'])
    renderPage(BASE_MOCKS())
    await ready()
    const controls = screen.getByRole('heading', { level: 2, name: 'Operator Controls' }).closest('section') as HTMLElement
    assert.equal(within(controls).getByRole('alert').textContent, 'Access denied')
    assertAbsent(within(controls).queryByRole('button', { name: 'Pause' }))
  })

  test('a bad id goes back to the list at once, without a lookup or subscriptions', async () => {
    renderPage(BASE_MOCKS(), 'running')
    await screen.findByText('Worli list route')
    assert.equal(server.lookups, 0)
    assert.equal(apollo.subscriptions.length, 0)
    assert.equal(optionsFor(WORLI_INSTANCE)?.skip, true)
  })

  test('a missing session says so, then returns to the list after two seconds', async () => {
    renderPage([{ request: { query: WORLI_INSTANCE, variables: { id: ID } }, result: { data: { worliInstance: null } } }])
    await screen.findByText('Market not found')
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Market Details' }))
    assert.ok(screen.getByText('Returning to Worli Running Markets…'))
    await screen.findByText('Worli list route', undefined, { timeout: 4000 })
  })

  test('a failed lookup says why, then returns to the list', async () => {
    renderPage([{ request: { query: WORLI_INSTANCE, variables: { id: ID } }, error: new Error('Network down') }])
    await screen.findByText('Failed to load market details: Network down')
    await screen.findByText('Worli list route', undefined, { timeout: 4000 })
  })

  test('an instance update refetches; Auto-refresh turns the poll off; Refresh asks again', async () => {
    renderPage(BASE_MOCKS())
    await ready()
    const before = server.lookups
    await act(async () => {
      apollo.subscriptions[0].observer?.next({ data: { worliInstanceUpdated: { id: ID } } })
    })
    await waitFor(() => assert.ok(server.lookups > before))

    fireEvent.click(screen.getByRole('switch', { name: 'Auto-refresh' }))
    assert.equal(optionsFor(WORLI_INSTANCE)?.pollInterval, 0)

    const again = server.lookups
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })
    await waitFor(() => assert.ok(server.lookups > again))
  })

  test('new bets fill the live feed, newest first, ten at most, with one replacing toast', async () => {
    renderPage(BASE_MOCKS())
    await ready()
    assertAbsent(screen.queryByRole('heading', { name: 'Live Bets Feed' }))
    const betSub = apollo.subscriptions.find((call) => call.query === WORLI_BET_CREATED)

    act(() => {
      for (let index = 0; index < 11; index += 1) {
        betSub?.observer?.next({ data: { worliBetCreated: bet({ id: `live-${index}`, betNumbers: `N${index}` }) } })
      }
      betSub?.observer?.next({ data: { worliBetCreated: null } })
    })

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Live Bets Feed' }))
    assert.ok(screen.getByText('10 recent'))
    const rows = within(screen.getByRole('region', { name: 'Live bets' })).getAllByRole('listitem')
    assert.equal(rows.length, 10)
    assert.ok(within(rows[0]).getByText('N10'))
    assert.ok(within(rows[0]).getByText('HH:mm:ss@2026-10-07T05:00:00.000Z'))
    assert.equal(feedback.toasts.length, 11)
    assert.deepEqual(feedback.toasts[0], { message: 'New bet placed!', tone: 'ok', duration: 2000 })
    assert.equal(feedback.dismissed.length, 10)
  })

  test('the operator message shows until it is closed', async () => {
    renderPage([instanceMock({ operatorMessage: 'Results at 6 PM' }), bookMock])
    await ready()
    assert.ok(screen.getByText('Operator Message'))
    assert.ok(screen.getByText('Results at 6 PM'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    assertAbsent(screen.queryByText('Results at 6 PM'))
  })

  test('Pause asks for a reason, sends it and reloads the session', async () => {
    renderPage([...BASE_MOCKS(), mutationMock(PAUSE_WORLI, 'pauseWorliInstance', { id: ID, reason: 'Exposure' })])
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Confirm PAUSE' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm' }))
    assert.ok(dialog.getByText('Please input a reason'))
    assert.equal(server.sent.length, 0)

    fireEvent.change(dialog.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Exposure' } })
    const before = server.lookups
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Confirm' }))
    })
    await waitFor(() => assert.deepEqual(server.sent, [{ field: 'pauseWorliInstance', id: ID, reason: 'Exposure' }]))
    await waitFor(() => assertAbsent(screen.queryByRole('dialog')))
    await waitFor(() => assert.ok(server.lookups > before))

    // The prompt starts empty again.
    fireEvent.click(screen.getByRole('button', { name: 'Lock Now' }))
    const lock = within(screen.getByRole('dialog', { name: 'Confirm LOCK' }))
    assert.equal((lock.getByRole('textbox', { name: /Reason/ }) as HTMLTextAreaElement).value, '')
  })

  test('a failed Resume keeps its prompt open with the error', async () => {
    renderPage([
      ...BASE_MOCKS(),
      { request: { query: RESUME_WORLI, variables: { id: ID, reason: 'Back' } }, error: new Error('Not allowed now') },
    ])
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Confirm RESUME' }))
    fireEvent.change(dialog.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Back' } })
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Confirm' }))
    })
    await screen.findByText('Not allowed now')
    assert.ok(screen.getByRole('dialog', { name: 'Confirm RESUME' }))
  })

  test('a failed Set Message keeps its dialog open with the error and the note', async () => {
    renderPage([
      ...BASE_MOCKS(),
      { request: { query: SET_MESSAGE_WORLI, variables: { id: ID, message: 'Closing early' } }, error: new Error('Message rejected') },
    ])
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Set Message' }))
    const message = within(screen.getByRole('dialog', { name: 'Set market message' }))
    fireEvent.change(message.getByRole('textbox', { name: 'Market message' }), { target: { value: 'Closing early' } })
    await act(async () => {
      fireEvent.click(message.getByRole('button', { name: 'OK' }))
    })
    await waitFor(() => assert.equal(message.getByRole('alert').textContent, 'Message rejected'))
    assert.ok(screen.getByRole('dialog', { name: 'Set market message' }))
    assert.equal((message.getByRole('textbox', { name: 'Market message' }) as HTMLInputElement).value, 'Closing early')
  })

  test('Set Message sends the note as typed; Adjust Suspend Minutes parses the minutes, then asks for a reason', async () => {
    renderPage([
      ...BASE_MOCKS(),
      mutationMock(SET_MESSAGE_WORLI, 'setWorliMarketMessage', { id: ID, message: 'Closing early' }),
      mutationMock(ADJUST_SUSPEND_WORLI, 'adjustWorliSuspendMinutes', { id: ID, minutes: 12, reason: 'Late start' }),
    ])
    await ready()

    fireEvent.click(screen.getByRole('button', { name: 'Set Message' }))
    const message = within(screen.getByRole('dialog', { name: 'Set market message' }))
    fireEvent.change(message.getByRole('textbox', { name: 'Market message' }), { target: { value: 'Closing early' } })
    await act(async () => {
      fireEvent.click(message.getByRole('button', { name: 'OK' }))
    })
    await waitFor(() => assertAbsent(screen.queryByRole('dialog')))

    fireEvent.click(screen.getByRole('button', { name: 'Adjust Suspend Minutes' }))
    const minutes = within(screen.getByRole('dialog', { name: 'Adjust suspend minutes' }))
    const field = minutes.getByRole('textbox', { name: 'Minutes before close' }) as HTMLInputElement
    assert.equal(field.value, '5')
    fireEvent.change(field, { target: { value: '12abc' } })
    fireEvent.click(minutes.getByRole('button', { name: 'OK' }))

    const reason = within(screen.getByRole('dialog', { name: 'Reason for suspend adjustment' }))
    // The minutes dialog's OK is gone once this prompt opens, so it hands focus back to the flow's trigger.
    assert.ok(
      dialogs.restoreFocusTo.get('Reason for suspend adjustment')?.current ===
        screen.getByRole('button', { name: 'Adjust Suspend Minutes' }),
      'the suspend reason prompt restores focus to Adjust Suspend Minutes',
    )
    fireEvent.change(reason.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Late start' } })
    await act(async () => {
      fireEvent.click(reason.getByRole('button', { name: 'Confirm' }))
    })
    await waitFor(() => assert.deepEqual(server.sent, [
      { field: 'setWorliMarketMessage', id: ID, message: 'Closing early' },
      { field: 'adjustWorliSuspendMinutes', id: ID, minutes: 12, reason: 'Late start' },
    ]))
    await waitFor(() => assertAbsent(screen.queryByRole('dialog')))

    // The note was cleared after a successful send.
    fireEvent.click(screen.getByRole('button', { name: 'Set Message' }))
    assert.equal((screen.getByRole('textbox', { name: 'Market message' }) as HTMLInputElement).value, '')
  })

  test('the book tab filters and sorts the selections and keeps its filters across tab switches', async () => {
    renderPage(BASE_MOCKS())
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: 'Book Analysis' }))
    await screen.findByText('Total Book Stake')
    assert.ok(screen.getByText('₹5000.00'))
    const single = () => screen.getByRole('region', { name: 'SINGLE selections' })
    assert.ok(screen.getByText('(3 selections)'))
    assert.deepEqual(
      within(single()).getAllByRole('listitem').map((item) => item.firstElementChild?.textContent),
      ['1', '2', '12'],
    )
    assert.ok(within(single()).getByText('99+'))

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'pl:asc' } })
    assert.deepEqual(
      within(single()).getAllByRole('listitem').map((item) => item.firstElementChild?.textContent),
      ['12', '1', '2'],
    )
    fireEvent.change(screen.getByLabelText('Bid type'), { target: { value: 'JODI' } })
    assertAbsent(screen.queryByRole('region', { name: 'SINGLE selections' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search selection' }), { target: { value: '6' } })
    const jodi = within(screen.getByRole('region', { name: 'JODI selections' }))
    assert.equal(jodi.getAllByRole('listitem').length, 1)
    assert.ok(jodi.getByText('-₹600.00'))

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    assertAbsent(screen.queryByRole('searchbox', { name: 'Search selection' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Book Analysis' }))
    assert.equal((screen.getByRole('searchbox', { name: 'Search selection' }) as HTMLInputElement).value, '6')
  })

  test('the bets tab lists, searches, filters by bid type, exports and voids', async () => {
    renderPage([
      ...BASE_MOCKS(),
      betsMock({ bidType: 'JODI' }, [BETS[1]]),
      mutationMock(VOID_BET, 'voidMatkaBet', { id: 'bet-1', reason: 'Duplicate' }),
    ])
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: 'Bets' }))
    await screen.findByText('user-abc...')
    assert.deepEqual(optionsFor(WORLI_BETS), {
      variables: { instanceId: ID, filters: { bidType: undefined, search: undefined }, page: 1, limit: 20 },
      pollInterval: 5000,
    })

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    assert.equal(rows.length, 2)
    const first = within(rows[0])
    for (const text of ['SP', '128', '₹100.00', '9.50x', '₹950.00', 'ACTIVE', 'HH:mm:ss@2026-10-07T05:00:00.000Z']) {
      assert.ok(first.getByText(text))
    }
    assert.equal((within(rows[1]).getByRole('button', { name: 'Void' }) as HTMLButtonElement).disabled, true)
    assert.ok(screen.getByText('Total 2 bets'))

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search bets' }), { target: { value: 'zzz' } })
    assert.equal(within(screen.getByRole('table')).getAllByRole('row').length, 2)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search bets' }), { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    assert.deepEqual(feedback.toasts.at(-1), { message: 'Export feature coming soon', tone: 'info', duration: 3000 })

    // The search re-rendered the rows, so the first one is looked up again.
    const firstRow = within(screen.getByRole('table')).getAllByRole('row')[1]
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Void' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Confirm VOID Bet' }))
    fireEvent.change(dialog.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Duplicate' } })
    const betsBefore = server.bets.length
    const lookupsBefore = server.lookups
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Confirm' }))
    })
    await waitFor(() => assert.deepEqual(server.sent, [{ field: 'voidMatkaBet', id: 'bet-1', reason: 'Duplicate' }]))
    await waitFor(() => assert.deepEqual(feedback.toasts.at(-1), { message: 'Bet voided successfully', tone: 'ok', duration: 3000 }))
    await waitFor(() => assert.ok(server.bets.length > betsBefore && server.lookups > lookupsBefore))

    fireEvent.change(screen.getByLabelText('Filter by bid type'), { target: { value: 'JODI' } })
    await waitFor(() => assert.deepEqual(optionsFor(WORLI_BETS)?.variables, {
      instanceId: ID,
      filters: { bidType: 'JODI', search: undefined },
      page: 1,
      limit: 20,
    }))
    await waitFor(() => assert.equal(within(screen.getByRole('table')).getAllByRole('row').length, 2))
  })

  test('a failed Void keeps its reason prompt open with the error, without the success toast', async () => {
    renderPage([
      ...BASE_MOCKS(),
      { request: { query: VOID_BET, variables: { id: 'bet-1', reason: 'Duplicate' } }, error: new Error('Bet already settled') },
    ])
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: 'Bets' }))
    await screen.findByText('user-abc...')
    const firstRow = within(screen.getByRole('table')).getAllByRole('row')[1]
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Void' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Confirm VOID Bet' }))
    fireEvent.change(dialog.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Duplicate' } })
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Confirm' }))
    })
    await waitFor(() => assert.equal(dialog.getByRole('alert').textContent, 'Bet already settled'))
    assert.ok(screen.getByRole('dialog', { name: 'Confirm VOID Bet' }))
    assert.equal((dialog.getByRole('textbox', { name: /Reason/ }) as HTMLTextAreaElement).value, 'Duplicate')
    assert.ok(!feedback.toasts.some((entry) => entry.message === 'Bet voided successfully'))
  })

  test('the activity log lists entries newest first with their reason and actor', async () => {
    renderPage(BASE_MOCKS())
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: 'Activity Log' }))
    await screen.findByText('Exposure too high')
    assert.deepEqual(optionsFor(WORLI_ACTIVITY), { variables: { instanceId: ID }, pollInterval: 10000 })
    const entries = within(screen.getByRole('heading', { level: 2, name: 'Activity Log' }).closest('section') as HTMLElement)
      .getAllByRole('listitem')
    assert.equal(entries.length, 2)
    assert.ok(within(entries[0]).getByText('LOCK'))
    assert.ok(within(entries[0]).getByText('dd MMM yyyy, HH:mm:ss#2026-10-07T05:10:00.000Z'))
    assert.ok(within(entries[0]).getByText('admin-7'))
    assert.ok(within(entries[0]).getByText('2'))
    assert.ok(within(entries[1]).getByText('MESSAGE'))
    assert.ok(entries[0].querySelector('blockquote') !== null)
    assert.ok(entries[1].querySelector('blockquote') === null)
  })

  test('an empty book, bets list and activity log say so', async () => {
    renderPage([
      instanceMock(),
      { request: { query: WORLI_BOOK, variables: { instanceId: ID, side: 'OPEN' } }, maxUsageCount: Number.POSITIVE_INFINITY, result: { data: { worliBook: null } } },
      betsMock(undefined, []),
      { request: { query: WORLI_ACTIVITY, variables: { instanceId: ID } }, maxUsageCount: Number.POSITIVE_INFINITY, result: { data: { worliActivity: [] } } },
    ])
    await ready()
    await screen.findByText('No risk data available')
    assertAbsent(screen.queryByRole('heading', { name: 'Bid Type Distribution' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Book Analysis' }))
    await screen.findByText('No book data available')
    fireEvent.click(screen.getByRole('tab', { name: 'Bets' }))
    await screen.findByText('No data')
    fireEvent.click(screen.getByRole('tab', { name: 'Activity Log' }))
    await screen.findByText('No activity recorded yet')
  })
})
