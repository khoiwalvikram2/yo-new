/**
 * /notifications mounted against MockedProvider and a MemoryRouter: the exact MyNotifications document
 * and options (variables, poll fallback, policies), that no RBAC guard stands in front, the tab strip and its
 * location-state and agent rules, the realtime merge and its refetch triggers, row navigation with the
 * mark-read mutation, Mark all read, and the loading, empty and error states. The live subscription hook
 * is stubbed (it opens a socket), as are the currency and tenant date formatters; the notification
 * store is the real zustand store.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  MARK_ALL_NOTIFICATIONS_READ_MUTATION,
  MARK_NOTIFICATION_READ_MUTATION,
  MY_NOTIFICATIONS_QUERY,
} from '@/lib/graphql/notifications'
import { useNotificationStore, type Notification } from '@/state/notificationStore'
import NotificationsPage from './NotificationsPage'

const apollo = vi.hoisted(() => ({
  queries: [] as Array<{ query: unknown; options: unknown }>,
  mutations: [] as Array<{ mutation: unknown; options: unknown }>,
}))
const auth = vi.hoisted(() => ({ agent: false }))
const live = vi.hoisted(() => ({ error: undefined as Error | undefined }))
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

vi.mock('@/components/topbar/useNotificationSubscription', () => ({
  useNotificationSubscription: () => ({ error: live.error }),
}))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: <T,>(selector: (state: { isAgent: () => boolean }) => T) => selector({ isAgent: () => auth.agent }),
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency?: string) => `${currency ?? 'INR'} ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDate: (date: string | Date, format?: string) => `Day ${String(date).slice(0, 10)} (${format})`,
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

/* 12:00 IST on 7 Oct 2026, so the real IST isToday/isYesterday helpers label the fixture days. */
const NOW = new Date('2026-10-07T06:30:00.000Z')

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
    type: 'DEPOSIT',
    category: 'general',
    title: `Notification ${id}`,
    message: `Message ${id}`,
    metadata: null,
    isRead: true,
    actionUrl: null,
    createdAt: '2026-10-07T04:30:00.000Z',
    ...patch,
  }
}

const DEPOSIT = row('11', {
  title: 'Deposit received',
  message: 'DR-78421 is waiting for review',
  metadata: { amount: 25000, currency: 'INR', userName: 'ravi_77' },
  isRead: false,
})
const WITHDRAWAL = row('12', {
  type: 'WITHDRAWAL',
  title: 'Withdrawal requested',
  createdAt: '2026-10-06T10:00:00.000Z',
})
const OLD_SYSTEM = row('13', { type: 'SYSTEM', title: 'Maintenance done', createdAt: '2026-10-01T10:00:00.000Z' })

function variables(category: 'general' | 'task') {
  return { category, limit: 20, offset: 0 }
}

function listMock(category: 'general' | 'task', rows: Row[], counter?: { count: number }): MockedResponse {
  return {
    request: { query: MY_NOTIFICATIONS_QUERY, variables: variables(category) },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      if (counter) counter.count += 1
      return { data: { myNotifications: rows } }
    },
  }
}

function markReadMock(id: string, counter: { count: number }): MockedResponse {
  return {
    request: { query: MARK_NOTIFICATION_READ_MUTATION, variables: { id } },
    result: () => {
      counter.count += 1
      return { data: { markNotificationRead: { __typename: 'Notification', id, isRead: true } } }
    },
  }
}

function storeRow(id: string, patch: Partial<Notification> = {}): Notification {
  return {
    id,
    type: 'DEPOSIT',
    category: 'general',
    title: `Realtime ${id}`,
    message: `Live ${id}`,
    isRead: false,
    actionUrl: null,
    createdAt: '2026-10-07T06:00:00.000Z',
    ...patch,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

function renderPage(mocks: MockedResponse[], initialEntries: InitialEntry[] = ['/notifications']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <MockedProvider mocks={mocks}>
        <PageEyebrowProvider value="Home">
          <Routes>
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/notifications/:id" element={<p>Notification detail route</p>} />
            <Route path="/notifications/tasks/:id" element={<p>Task detail route</p>} />
          </Routes>
          <LocationProbe />
        </PageEyebrowProvider>
      </MockedProvider>
    </MemoryRouter>,
  )
}

function lastQueryOptions() {
  const last = apollo.queries.at(-1)
  assert.ok(last, 'useQuery was called')
  assert.equal(last.query, MY_NOTIFICATIONS_QUERY)
  return last.options as Record<string, unknown>
}

function location() {
  return screen.getByTestId('location').textContent
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  apollo.queries.length = 0
  apollo.mutations.length = 0
  auth.agent = false
  live.error = undefined
  rbac.allowed = true
  rbac.calls.length = 0
  useNotificationStore.setState({ notifications: [], generalUnread: 0, taskUnread: 0, totalUnread: 0, lastFetched: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NotificationsPage', () => {
  test('asks for the first 20 general notifications with the legacy options and groups them by day', async () => {
    renderPage([listMock('general', [DEPOSIT, WITHDRAWAL, OLD_SYSTEM])])

    const deposit = await screen.findByRole('link', { name: /Deposit received/ })
    assert.deepEqual(lastQueryOptions(), {
      variables: variables('general'),
      pollInterval: 0,
      errorPolicy: 'all',
      fetchPolicy: 'cache-and-network',
    })
    assert.deepEqual(
      apollo.mutations.slice(0, 2).map(({ mutation, options }) => [mutation, options]),
      [
        [MARK_NOTIFICATION_READ_MUTATION, { refetchQueries: [MY_NOTIFICATIONS_QUERY] }],
        [MARK_ALL_NOTIFICATIONS_READ_MUTATION, { refetchQueries: [MY_NOTIFICATIONS_QUERY] }],
      ],
    )

    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Notifications')
    assert.ok(screen.queryByText('Home') === null)
    assert.ok(screen.queryByText('View and manage your notifications and pending tasks') === null)
    assert.equal(screen.getByRole('heading', { level: 2 }).textContent, 'Notifications')
    assert.deepEqual(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
      ['Today', 'Yesterday', 'Day 2026-10-01 (MMM d, yyyy)'],
    )

    assert.equal(deposit.getAttribute('href'), '/notifications/11')
    assert.ok(within(deposit).getByText('INR 25000.00'))
    assert.ok(within(deposit).getByText('DR-78421 is waiting for review'))
    assert.ok(within(deposit).getByText('about 2 hours ago'))
    assert.ok(within(deposit).getByText('ravi_77'))
    assert.ok(within(deposit).getByText('Unread'))

    const withdrawal = screen.getByRole('link', { name: /Withdrawal requested/ })
    assert.equal(withdrawal.getAttribute('href'), '/notifications/12')
    assert.equal(within(withdrawal).queryByText('Unread'), null)
    assert.ok(screen.getByRole('link', { name: /Maintenance done/ }))
  })

  test('opens for any signed-in reader: no RBAC guard, the server scopes the inbox to its recipient', async () => {
    // A caller the old notifications.list:view guard refused: a Whitelabel Admin or an agent, whose bells list
    // these same rows and whose View all lands here.
    rbac.allowed = false
    renderPage([listMock('general', [DEPOSIT])])

    await screen.findByRole('link', { name: /Deposit received/ })
    assert.equal(rbac.calls.length, 0)
    assert.equal(screen.queryByText('Access denied'), null)
  })

  test('falls back to a 30-second poll while the live subscription is failing', async () => {
    live.error = new Error('socket closed')
    renderPage([listMock('general', [DEPOSIT])])

    await screen.findByRole('link', { name: /Deposit received/ })
    assert.equal(lastQueryOptions().pollInterval, 30000)
  })

  test('switches between General and Tasks, with the store counts on each tab', async () => {
    useNotificationStore.setState({ generalUnread: 2, taskUnread: 1, totalUnread: 3 })
    renderPage([listMock('general', [DEPOSIT]), listMock('task', [])])

    await screen.findByRole('link', { name: /Deposit received/ })
    const tablist = screen.getByRole('tablist', { name: 'Notification categories' })
    const tabs = within(tablist).getAllByRole('tab')
    assert.deepEqual(tabs.map((tab) => tab.textContent), ['General (2)', 'Tasks (1)'])
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true')
    assert.ok(screen.getByText('2 unread'))
    const panel = screen.getByRole('tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), tabs[0].id)

    fireEvent.click(tabs[1])

    assert.ok(await screen.findByText('No pending tasks'))
    assert.deepEqual(lastQueryOptions().variables, variables('task'))
    assert.equal(within(tablist).getAllByRole('tab')[1].getAttribute('aria-selected'), 'true')
    assert.ok(screen.getByText('1 unread'))
    assert.equal(screen.queryByRole('button', { name: 'Mark all read' }), null)
  })

  test('opens on the tab the bell asked for', async () => {
    renderPage(
      [listMock('general', [DEPOSIT]), listMock('task', [row('31', { category: 'task', title: 'Approve KYC' })])],
      [{ pathname: '/notifications', state: { category: 'task' } }],
    )

    const task = await screen.findByRole('link', { name: /Approve KYC/ })
    assert.equal(task.getAttribute('href'), '/notifications/tasks/31')
    assert.deepEqual(lastQueryOptions().variables, variables('task'))
    assert.equal(screen.getByRole('tab', { name: /Tasks/ }).getAttribute('aria-selected'), 'true')
  })

  test('an agent sees only General, whatever the bell asked for', async () => {
    auth.agent = true
    useNotificationStore.setState({ generalUnread: 1, taskUnread: 4, totalUnread: 5 })
    renderPage([listMock('general', [DEPOSIT])], [{ pathname: '/notifications', state: { category: 'task' } }])

    await screen.findByRole('link', { name: /Deposit received/ })
    assert.deepEqual(
      screen.getAllByRole('tab').map((tab) => tab.textContent),
      ['General (1)'],
    )
    assert.ok(apollo.queries.every(({ options }) => (options as { variables: { category: string } }).variables.category === 'general'))
  })

  test('a click on an unread row marks it read, updates the store, then opens it', async () => {
    const marks = { count: 0 }
    useNotificationStore.setState({ notifications: [storeRow('11', { title: 'Deposit received' })], generalUnread: 1, totalUnread: 1 })
    renderPage([listMock('general', [DEPOSIT]), markReadMock('11', marks)])

    fireEvent.click(await screen.findByRole('link', { name: /Deposit received/ }))

    await waitFor(() => assert.equal(location(), '/notifications/11'))
    assert.equal(marks.count, 1)
    assert.equal(useNotificationStore.getState().generalUnread, 0)
    assert.ok(screen.getByText('Notification detail route'))
  })

  test('a read row opens without a mutation, and a task row opens the task page', async () => {
    const marks = { count: 0 }
    renderPage([
      listMock('general', [WITHDRAWAL, row('14', { category: 'task', title: 'Task in general list', isRead: true })]),
      markReadMock('12', marks),
    ])

    fireEvent.click(await screen.findByRole('link', { name: /Task in general list/ }))
    await waitFor(() => assert.equal(location(), '/notifications/tasks/14'))
    assert.equal(marks.count, 0)
    assert.ok(screen.getByText('Task detail route'))
  })

  test('a failed mark-read still opens the notification', async () => {
    renderPage([
      listMock('general', [DEPOSIT]),
      { request: { query: MARK_NOTIFICATION_READ_MUTATION, variables: { id: '11' } }, error: new Error('nope') },
    ])

    fireEvent.click(await screen.findByRole('link', { name: /Deposit received/ }))
    await waitFor(() => assert.equal(location(), '/notifications/11'))
  })

  test('a modified click is left to the browser', async () => {
    const marks = { count: 0 }
    renderPage([listMock('general', [DEPOSIT]), markReadMock('11', marks)])

    const link = await screen.findByRole('link', { name: /Deposit received/ })
    fireEvent.click(link, { ctrlKey: true })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    assert.equal(marks.count, 0)
    assert.equal(location(), '/notifications')
  })

  test('Mark all read clears the shown category and refetches the list', async () => {
    const fetches = { count: 0 }
    const markAll = { count: 0 }
    useNotificationStore.setState({ generalUnread: 3, taskUnread: 2, totalUnread: 5 })
    renderPage([
      listMock('general', [DEPOSIT, WITHDRAWAL], fetches),
      {
        request: { query: MARK_ALL_NOTIFICATIONS_READ_MUTATION, variables: { category: 'general' } },
        result: () => {
          markAll.count += 1
          return { data: { markAllNotificationsRead: true } }
        },
      },
    ])

    await screen.findByRole('link', { name: /Deposit received/ })
    const before = fetches.count
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))

    await waitFor(() => assert.equal(markAll.count, 1))
    await waitFor(() => assert.equal(useNotificationStore.getState().generalUnread, 0))
    assert.equal(useNotificationStore.getState().taskUnread, 2)
    await waitFor(() => assert.ok(fetches.count > before))
  })

  test('Mark all read only shows while something is unread', async () => {
    renderPage([listMock('general', [WITHDRAWAL, OLD_SYSTEM])])

    await screen.findByRole('link', { name: /Withdrawal requested/ })
    assert.equal(screen.queryByRole('button', { name: 'Mark all read' }), null)
    assert.ok(screen.getByRole('button', { name: 'Refresh' }))
  })

  test('realtime rows lead the list and both refetch triggers reach the network', async () => {
    const fetches = { count: 0 }
    useNotificationStore.setState({
      notifications: [storeRow('99', { title: 'Brand new deposit' }), storeRow('98', { category: 'task', title: 'Other tab' })],
      generalUnread: 1,
      taskUnread: 1,
      totalUnread: 2,
    })
    renderPage([listMock('general', [DEPOSIT], fetches)])

    await screen.findByRole('link', { name: /Deposit received/ })
    const links = screen.getAllByRole('link')
    assert.match(links[0].textContent ?? '', /Brand new deposit/)
    assert.ok(screen.queryByText('Other tab') === null)

    // The store already holds rows, so the page refetches once 100ms after mounting.
    await waitFor(() => assert.ok(fetches.count >= 2))
    const afterMount = fetches.count
    act(() => {
      window.dispatchEvent(new CustomEvent('notificationReceived'))
    })
    await waitFor(() => assert.ok(fetches.count > afterMount))

    const afterEvent = fetches.count
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.ok(fetches.count > afterEvent))
  })

  test('shows a loading state, then the empty state', async () => {
    renderPage([listMock('general', [])])

    assert.ok(screen.getByText('Loading notifications'))
    assert.ok(await screen.findByText('No notifications'))
    assert.ok(screen.queryByText('Loading notifications') === null)
  })

  test('states a failed load and retries it', async () => {
    renderPage([
      { request: { query: MY_NOTIFICATIONS_QUERY, variables: variables('general') }, error: new Error('Network down') },
      listMock('general', [DEPOSIT]),
    ])

    assert.ok(await screen.findByText('Failed to load notifications: Network down'))
    assert.ok(screen.queryByText('No notifications') === null)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    assert.ok(await screen.findByRole('link', { name: /Deposit received/ }))
    assert.ok(screen.queryByText(/Failed to load notifications/) === null)
  })
})
