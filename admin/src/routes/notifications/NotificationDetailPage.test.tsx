/**
 * /notifications/:id mounted against MockedProvider and a MemoryRouter: the scoped MyNotification lookup
 * (one requested record, errorPolicy all), that no RBAC guard stands in front, the mark-read-on-view mutation and its store
 * update, every detail row and tag, the action navigation through resolveNotificationActionUrl, and the
 * loading, not-found and error states. Currency and the tenant date formatter are stubbed; the
 * notification store is the real zustand store.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { MARK_NOTIFICATION_READ_MUTATION, MY_NOTIFICATIONS_QUERY, MY_NOTIFICATION_QUERY } from '@/lib/graphql/notifications'
import { useNotificationStore } from '@/state/notificationStore'
import NotificationDetailPage from './NotificationDetailPage'

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
const VARIABLES = { id: '41' }

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
    createdAt: '2026-10-07T06:00:00.000Z',
    ...patch,
  }
}

const DEPOSIT = row('41', {
  title: 'Deposit received',
  message: 'DR-78421 is waiting for review',
  metadata: { userName: 'ravi_77', userPhone: '9876543210', amount: 25000, currency: 'INR', depositId: 'DR-78421' },
  actionUrl: '/players/3',
})

function listMock(rows: Row[], counter?: { count: number }): MockedResponse {
  return {
    request: { query: MY_NOTIFICATION_QUERY, variables: VARIABLES },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      if (counter) counter.count += 1
      return { data: { myNotification: rows.find(row => row.id === VARIABLES.id) ?? null } }
    },
  }
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

function renderPage(mocks: MockedResponse[], path = '/notifications/41') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MockedProvider mocks={mocks}>
        <PageEyebrowProvider value="Home">
          <Routes>
            <Route path="/notifications/:id" element={<NotificationDetailPage />} />
            <Route path="/notifications" element={<p>Notifications route</p>} />
            <Route path="/players/profile/:id" element={<p>Player profile route</p>} />
          </Routes>
          <LocationProbe />
        </PageEyebrowProvider>
      </MockedProvider>
    </MemoryRouter>,
  )
}

function detailRows() {
  return screen.getAllByRole('term').map((term) => term.textContent)
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

describe('NotificationDetailPage', () => {
  test('looks up exactly the requested id and shows every detail', async () => {
    renderPage([listMock([row('40'), DEPOSIT])])

    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Deposit received' }))
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
    assert.ok(screen.getByText('DEPOSIT'))
    assert.ok(screen.getByText('General'))
    assert.ok(screen.queryByText('Unread') === null)

    assert.deepEqual(detailRows(), ['Message', 'Created', 'Details'])
    assert.ok(screen.getByText('DR-78421 is waiting for review'))
    assert.ok(screen.getByText('tenant 2026-10-07T06:00:00.000Z as dd MMM yyyy, HH:mm:ss'))
    assert.ok(screen.getByText('(30 minutes ago)'))
    assert.deepEqual(
      ['User:', 'Phone:', 'Amount:'].map((label) => screen.getByText(label).parentElement?.textContent),
      ['User:ravi_77', 'Phone:9876543210', 'Amount:INR 25000.00 INR'],
    )

    const summary = screen.getByText('Show all metadata')
    assert.equal(summary.tagName, 'SUMMARY')
    const code = screen.getByLabelText('Metadata').textContent ?? ''
    assert.match(code, /"depositId": "DR-78421"/)
    assert.ok(screen.getByRole('button', { hidden: true, name: 'Copy Metadata' }))
  })

  test('Go to Action opens the resolved app route', async () => {
    renderPage([listMock([DEPOSIT])])

    fireEvent.click(await screen.findByRole('button', { name: 'Go to Action' }))
    await waitFor(() => assert.equal(screen.getByTestId('location').textContent, '/players/profile/3'))
    assert.ok(screen.getByText('Player profile route'))
  })

  test('opens for any signed-in reader: no RBAC guard, the server scopes the read to its recipient', async () => {
    // A caller the old notifications.list:view guard refused: a Whitelabel Admin or an agent opening its own alert.
    rbac.allowed = false
    renderPage([listMock([DEPOSIT])])

    assert.ok(await screen.findByRole('heading', { name: 'Deposit received' }))
    assert.equal(rbac.calls.length, 0)
    assert.equal(screen.queryByText('Access denied'), null)
  })

  test('marks an unread notification read on view and updates the store', async () => {
    const marks = { count: 0 }
    const server = { read: false }
    useNotificationStore.setState({
      notifications: [{ id: '41', type: 'DEPOSIT', category: 'general', title: 't', message: 'm', isRead: false, createdAt: NOW.toISOString() }],
      generalUnread: 2,
      totalUnread: 2,
    })
    renderPage([
      {
        request: { query: MY_NOTIFICATION_QUERY, variables: VARIABLES },
        maxUsageCount: Number.POSITIVE_INFINITY,
        result: () => ({ data: { myNotification: { ...DEPOSIT, isRead: server.read } } }),
      },
      {
        request: { query: MARK_NOTIFICATION_READ_MUTATION, variables: { id: '41' } },
        result: () => {
          marks.count += 1
          server.read = true
          return { data: { markNotificationRead: { __typename: 'Notification', id: '41', isRead: true } } }
        },
      },
    ])

    assert.ok(await screen.findByText('Unread'))
    await waitFor(() => assert.equal(useNotificationStore.getState().generalUnread, 1))
    assert.equal(marks.count, 1)
    await waitFor(() => assert.ok(screen.queryByText('Unread') === null))
    assert.equal(marks.count, 1)
  })

  test('a failed mark-read leaves the page and the store as they were', async () => {
    useNotificationStore.setState({ generalUnread: 2, totalUnread: 2 })
    renderPage([
      listMock([{ ...DEPOSIT, isRead: false }]),
      { request: { query: MARK_NOTIFICATION_READ_MUTATION, variables: { id: '41' } }, error: new Error('nope') },
    ])

    assert.ok(await screen.findByText('Unread'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    assert.ok(screen.getByText('Unread'))
    assert.equal(useNotificationStore.getState().generalUnread, 2)
  })

  test('falls back to No message, leaves out Details and the action, and says an unreadable date is invalid', async () => {
    renderPage([
      listMock([row('41', { type: 'MYSTERY', category: 'task', message: '', createdAt: 'garbage', metadata: null })]),
    ])

    assert.ok(await screen.findByText('No message'))
    assert.deepEqual(detailRows(), ['Message', 'Created'])
    assert.ok(screen.getByText('Invalid date'))
    assert.ok(screen.queryByText(/ago\)/) === null)
    assert.ok(screen.getByText('MYSTERY'))
    assert.ok(screen.getByText('Task'))
    assert.equal(screen.queryByRole('button', { name: 'Go to Action' }), null)
  })

  test('keeps a Details row with only the lines that apply and no metadata toggle', async () => {
    renderPage([listMock([row('41', { metadata: { userPhone: 'N/A', currency: 'INR' } })])])

    await screen.findByRole('heading', { level: 1, name: 'Notification 41' })
    assert.deepEqual(detailRows(), ['Message', 'Created', 'Details'])
    assert.ok(screen.queryByText('Phone:') === null)
    assert.ok(screen.queryByText('Show all metadata') === null)
  })

  test('shows a loading state, then says the notification was not found', async () => {
    renderPage([listMock([row('40')])])

    assert.ok(screen.getByText('Loading notification'))
    assert.ok(await screen.findByText('Notification not found'))
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Notification Details')
    assert.equal(screen.getByRole('link', { name: 'Back' }).getAttribute('href'), '/notifications')
  })

  test('states a failed lookup and retries it', async () => {
    renderPage([
      { request: { query: MY_NOTIFICATION_QUERY, variables: VARIABLES }, error: new Error('Network down') },
      listMock([DEPOSIT]),
    ])

    assert.ok(await screen.findByText('Failed to load notification: Network down'))
    assert.ok(screen.queryByText('Notification not found') === null)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Deposit received' }))
  })
})
