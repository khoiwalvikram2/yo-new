/**
 * /notifications/tasks/:id mounted against MockedProvider and a MemoryRouter: the scoped MyNotification
 * lookup (task category, one requested record, errorPolicy all), that no RBAC guard stands in front, the mark-read-on-view
 * mutation and its store update, the status tags and two steps (from the metadata status or the read
 * flag), every detail row, the task action through resolveNotificationActionUrl, and the loading,
 * not-found and error states. Currency and the tenant date formatter are stubbed; the notification store
 * is the real zustand store.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { MARK_NOTIFICATION_READ_MUTATION, MY_NOTIFICATIONS_QUERY, MY_NOTIFICATION_QUERY } from '@/lib/graphql/notifications'
import { useNotificationStore } from '@/state/notificationStore'
import TaskDetailPage from './TaskDetailPage'

const apollo = vi.hoisted(() => ({
  queries: [] as Array<{ query: unknown; options: unknown }>,
  mutations: [] as Array<{ mutation: unknown; options: unknown }>,
}))
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
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({ mutation: args[0], options: args[1] })
      return actual.useMutation(...args)
    },
  }
})

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency?: string) => `${currency ?? 'INR'} ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (date: Date, format?: string) => `tenant ${date.toISOString()} as ${format}`,
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    children: ReactNode
  }) => {
    rbac.calls.push(required)
    return rbac.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

const NOW = new Date('2026-10-07T06:30:00.000Z')
const VARIABLES = { id: '51', category: 'task' }

interface Row {
  __typename: 'Notification'
  id: string
  type: string
  category: 'general' | 'task'
  title: string
  message: string
  metadata: Record<string, unknown> | null
  isRead: boolean
  actionUrl: string | null
  createdAt: string
}

function row(id: string, patch: Partial<Row> = {}): Row {
  return {
    __typename: 'Notification',
    id,
    type: 'WITHDRAWAL',
    category: 'task',
    title: `Task ${id}`,
    message: `Description ${id}`,
    metadata: null,
    isRead: true,
    actionUrl: null,
    createdAt: '2026-10-07T04:30:00.000Z',
    ...patch,
  }
}

const REVIEW = row('51', {
  title: 'Review withdrawal WR-51284',
  message: 'Above the review limit',
  metadata: { userName: 'vishal_09', userPhone: 'N/A', amount: 120000, currency: 'INR', method: 'UPI', requestId: 'WR-51284' },
  actionUrl: '/agent/3',
})

function listMock(rows: Row[]): MockedResponse {
  return {
    request: { query: MY_NOTIFICATION_QUERY, variables: VARIABLES },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => ({ data: { myNotification: rows.find(row => row.id === VARIABLES.id) ?? null } }),
  }
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

function renderPage(mocks: MockedResponse[], path = '/notifications/tasks/51') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MockedProvider mocks={mocks}>
        <PageEyebrowProvider value="Home">
          <Routes>
            <Route path="/notifications/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/notifications" element={<p>Notifications route</p>} />
            <Route path="/agents/:id" element={<p>Agent profile route</p>} />
          </Routes>
          <LocationProbe />
        </PageEyebrowProvider>
      </MockedProvider>
    </MemoryRouter>,
  )
}

function terms() {
  return screen.getAllByRole('term').map((term) => term.textContent)
}

function steps() {
  const list = screen.getByRole('list')
  return within(list)
    .getAllByRole('listitem')
    .map((item) => [item.textContent, item.getAttribute('aria-current')])
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  apollo.queries.length = 0
  apollo.mutations.length = 0
  rbac.allowed = true
  rbac.calls.length = 0
  useNotificationStore.setState({ notifications: [], generalUnread: 0, taskUnread: 0, totalUnread: 0, lastFetched: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TaskDetailPage', () => {
  test('looks the id up in the first 1000 tasks and shows every detail', async () => {
    renderPage([listMock([row('50'), REVIEW])])

    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Review withdrawal WR-51284' }))
    assert.deepEqual(apollo.queries[0], {
      query: MY_NOTIFICATION_QUERY,
      options: { variables: VARIABLES, skip: false, errorPolicy: 'all', fetchPolicy: 'cache-and-network' },
    })
    assert.deepEqual(apollo.mutations[0], {
      mutation: MARK_NOTIFICATION_READ_MUTATION,
      options: { refetchQueries: [MY_NOTIFICATION_QUERY, MY_NOTIFICATIONS_QUERY] },
    })

    assert.equal(screen.getByRole('link', { name: 'Back' }).getAttribute('href'), '/notifications')
    assert.ok(screen.queryByText('Home') === null)
    assert.ok(screen.getByText('WITHDRAWAL'))
    assert.ok(screen.getByText('Task'))
    // Read and no metadata status: completed.
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement
    assert.ok(within(header).getByText('Completed'))
    assert.equal(screen.getByRole('heading', { level: 2 }).textContent, 'Task Status')
    assert.deepEqual(steps(), [
      ['Createdtenant 2026-10-07T04:30:00.000Z as dd MMM yyyy, HH:mm:ss', null],
      ['CompletedTask has been completed', null],
    ])

    assert.deepEqual(terms(), ['Description', 'Created', 'Task Details', 'Action URL'])
    assert.ok(screen.getByText('Above the review limit'))
    assert.ok(screen.getByText('(about 2 hours ago)'))
    assert.deepEqual(
      ['User:', 'Amount:', 'Method:'].map((label) => screen.getByText(label).parentElement?.textContent),
      ['User:vishal_09', 'Amount:INR 120000.00 INR', 'Method:UPI'],
    )
    assert.ok(screen.queryByText('Phone:') === null)
    assert.equal(screen.getByText('Show all metadata').tagName, 'SUMMARY')
    assert.match(screen.getByLabelText('Metadata').textContent ?? '', /"requestId": "WR-51284"/)
    assert.equal(screen.getByText('/agent/3').tagName, 'CODE')
  })

  test('Go to Task Action opens the resolved app route', async () => {
    renderPage([listMock([REVIEW])])

    fireEvent.click(await screen.findByRole('button', { name: 'Go to Task Action' }))
    await waitFor(() => assert.equal(screen.getByTestId('location').textContent, '/agents/3'))
    assert.ok(screen.getByText('Agent profile route'))
  })

  test('opens for any signed-in reader: no RBAC guard, the server scopes the read to its recipient', async () => {
    // A caller the old notifications.list:view guard refused: a Whitelabel Admin opening a deposit or withdrawal task.
    rbac.allowed = false
    renderPage([listMock([REVIEW])])

    assert.ok(await screen.findByRole('button', { name: 'Go to Task Action' }))
    assert.equal(rbac.calls.length, 0)
    assert.equal(screen.queryByText('Access denied'), null)
  })

  test('marks an unread task read on view, updates the store, and the task then reads Completed', async () => {
    const marks = { count: 0 }
    const server = { read: false }
    useNotificationStore.setState({
      notifications: [{ id: '51', type: 'WITHDRAWAL', category: 'task', title: 't', message: 'm', isRead: false, createdAt: NOW.toISOString() }],
      taskUnread: 3,
      totalUnread: 3,
    })
    renderPage([
      {
        request: { query: MY_NOTIFICATION_QUERY, variables: VARIABLES },
        maxUsageCount: Number.POSITIVE_INFINITY,
        result: () => ({ data: { myNotification: { ...REVIEW, metadata: null, isRead: server.read } } }),
      },
      {
        request: { query: MARK_NOTIFICATION_READ_MUTATION, variables: { id: '51' } },
        result: () => {
          marks.count += 1
          server.read = true
          return { data: { markNotificationRead: { __typename: 'Notification', id: '51', isRead: true } } }
        },
      },
    ])

    await screen.findByRole('heading', { level: 1, name: 'Review withdrawal WR-51284' })
    await waitFor(() => assert.equal(useNotificationStore.getState().taskUnread, 2))
    assert.equal(marks.count, 1)
    await waitFor(() =>
      assert.deepEqual(steps(), [
        ['Createdtenant 2026-10-07T04:30:00.000Z as dd MMM yyyy, HH:mm:ss', null],
        ['CompletedTask has been completed', null],
      ]),
    )
    assert.equal(marks.count, 1)
  })

  test('an unread task with no status reads Pending and In Progress until it is marked', async () => {
    renderPage([
      listMock([{ ...REVIEW, isRead: false, metadata: null }]),
      { request: { query: MARK_NOTIFICATION_READ_MUTATION, variables: { id: '51' } }, error: new Error('nope') },
    ])

    await screen.findByRole('heading', { level: 1, name: 'Review withdrawal WR-51284' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    assert.ok(screen.getByText('Pending'))
    assert.deepEqual(steps(), [
      ['Createdtenant 2026-10-07T04:30:00.000Z as dd MMM yyyy, HH:mm:ss', null],
      ['In ProgressTask is currently in progress', 'step'],
    ])
    assert.deepEqual(terms(), ['Description', 'Created', 'Action URL'])
  })

  test('a metadata status wins over the read flag', async () => {
    renderPage([listMock([row('51', { isRead: true, metadata: { status: 'approved' } })])])

    await screen.findByRole('heading', { level: 1, name: 'Task 51' })
    assert.ok(screen.getByText('Pending'))
    assert.equal(steps()[1][0], 'In ProgressTask is currently in progress')
    // `status` is not one of the listed keys, so the full metadata is offered.
    assert.ok(screen.getByText('Show all metadata'))
  })

  test('falls back to No description, says an unreadable date is invalid, and leaves out the action', async () => {
    renderPage([listMock([row('51', { type: 'OTHER', message: '', createdAt: 'garbage' })])])

    assert.ok(await screen.findByText('No description'))
    assert.ok(screen.getAllByText('Invalid date').length >= 2)
    assert.ok(screen.queryByText(/ago\)/) === null)
    assert.deepEqual(terms(), ['Description', 'Created'])
    assert.equal(screen.queryByRole('button', { name: 'Go to Task Action' }), null)
  })

  test('shows a loading state, then says the task was not found', async () => {
    renderPage([listMock([row('50')])])

    assert.ok(screen.getByText('Loading task'))
    assert.ok(await screen.findByText('Task not found'))
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Task Details')
    assert.equal(screen.getByRole('link', { name: 'Back' }).getAttribute('href'), '/notifications')
  })

  test('states a failed lookup and retries it', async () => {
    renderPage([
      { request: { query: MY_NOTIFICATION_QUERY, variables: VARIABLES }, error: new Error('Network down') },
      listMock([REVIEW]),
    ])

    assert.ok(await screen.findByText('Failed to load task: Network down'))
    assert.ok(screen.queryByText('Task not found') === null)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Review withdrawal WR-51284' }))
  })
})
