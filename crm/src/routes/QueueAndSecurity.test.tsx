import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { QueuePage } from '@/routes/QueuePage'
import { SecurityPage } from '@/routes/SecurityPage'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'
import { TASKS, BOOKS, USERS, LOGIN_ATTEMPTS, PII_ACCESS_LOG } from '@/lib/gql'

/**
 * The queue, and the two logs nobody reads until something has gone wrong.
 *
 * The queue's own job is triage: a breaching task has to look different from a
 * task that is merely open, or the screen is just a list. The security screens
 * have the opposite job — they are read once, after an incident, and a failed
 * sign-in that renders identically to a successful one makes the log useless at
 * exactly the moment it is needed.
 */

function me(permissions: CrmPermissionPair[]): CrmMe {
  return {
    id: 'u1',
    name: 'Asha',
    email: null,
    status: 'ACTIVE',
    requirePasswordReset: false,
    tenant: 'acme',
    whitelabelName: 'Acme Casino',
    permissions,
    bookIds: [],
    canViewAllPlayers: false,
    sessionIdleMinutes: 60,
    outOfOfficeUntil: null,
    delegateTo: null,
  }
}

function task(over: Record<string, unknown> = {}) {
  const due = new Date(Date.now() - 60 * 60_000).toISOString()
  return {
    __typename: 'CrmTask',
    id: 'task-1',
    playerId: '42',
    bookId: 'b1',
    bookName: 'Book A',
    assigneeId: null,
    assigneeName: null,
    title: 'Chase the deposit',
    body: null,
    priority: 'NORMAL',
    status: 'OPEN',
    outcome: null,
    source: 'MANUAL',
    dueAt: due,
    breachAt: due,
    isBreaching: false,
    escalationLevel: 0,
    acknowledgedAt: null,
    createdAt: due,
    ...over,
  }
}

function mountQueue(permissions: CrmPermissionPair[], tasks: unknown[]) {
  useAuth.setState({ token: 'tok', me: me(permissions), lastActivityAt: Date.now() })
  const mocks = [
    {
      request: { query: TASKS, variables: { filter: { assignedToMe: true } } },
      result: { data: { crmTasks: tasks } },
      maxUsageCount: 10,
    },
    { request: { query: BOOKS }, result: { data: { crmBooks: [] } }, maxUsageCount: 10 },
    { request: { query: USERS }, result: { data: { crmUsers: [] } }, maxUsageCount: 10 },
  ]
  return render(
    <MockedProvider mocks={mocks as never}>
      <MemoryRouter>
        <AntApp>
          <QueuePage />
        </AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('the queue', () => {
  const VIEWER: CrmPermissionPair[] = [{ domain: 'crm.tasks', actions: ['view'] }]
  const WORKER: CrmPermissionPair[] = [{ domain: 'crm.tasks', actions: ['view', 'manage'] }]

  test('lists the tasks it was given', async () => {
    mountQueue(VIEWER, [task()])
    await waitFor(() => assert.ok(screen.getByText('Chase the deposit')))
  })

  test('a breaching task is marked as one', async () => {
    // The whole point of the SLA is that this row looks different.
    mountQueue(VIEWER, [task({ isBreaching: true })])
    await waitFor(() => assert.ok(screen.getByText('Chase the deposit')))
    assert.ok(screen.getAllByText(/breaching/i).length > 0)
  })

  test('offers no way to create work on view alone', async () => {
    mountQueue(VIEWER, [task()])
    await waitFor(() => assert.ok(screen.getByText('Chase the deposit')))
    const creates = screen
      .queryAllByRole('button')
      .filter((b) => /new task|create/i.test(b.textContent ?? ''))
    assert.deepEqual(creates.map((b) => b.textContent), [], 'a task could be created without crm.tasks:manage')
  })

  test('offers it with manage', async () => {
    mountQueue(WORKER, [task()])
    await waitFor(() => assert.ok(screen.getByText('Chase the deposit')))
    const creates = screen
      .queryAllByRole('button')
      .filter((b) => /new task|create/i.test(b.textContent ?? ''))
    assert.ok(creates.length > 0, 'crm.tasks:manage was granted but no task can be created')
  })

  test('an empty queue is a state, not a failure', async () => {
    mountQueue(VIEWER, [])
    await waitFor(() => assert.ok(screen.getAllByText(/no data|nothing|empty/i).length > 0))
  })
})

function mountSecurity(attempts: unknown[], access: unknown[]) {
  useAuth.setState({
    token: 'tok',
    me: me([{ domain: 'crm.security', actions: ['view'] }]),
    lastActivityAt: Date.now(),
  })
  const mocks = [
    {
      request: { query: LOGIN_ATTEMPTS, variables: { limit: 200 } },
      result: { data: { crmLoginAttempts: attempts } },
      maxUsageCount: 10,
    },
    {
      request: { query: PII_ACCESS_LOG, variables: { limit: 200, resourceId: undefined } },
      result: { data: { crmPiiAccessLog: access } },
      maxUsageCount: 10,
    },
    {
      request: { query: PII_ACCESS_LOG, variables: { limit: 200 } },
      result: { data: { crmPiiAccessLog: access } },
      maxUsageCount: 10,
    },
  ]
  return render(
    <MockedProvider mocks={mocks as never}>
      <MemoryRouter>
        <AntApp>
          <SecurityPage />
        </AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

describe('the sign-in log', () => {
  const failed = {
    __typename: 'CrmLoginAttempt',
    id: 'a1',
    username: 'mallory',
    userName: null,
    success: false,
    reason: 'BAD_PASSWORD',
    ipAddress: '203.0.113.9',
    userAgent: 'curl/8',
    createdAt: new Date().toISOString(),
  }
  const ok = {
    __typename: 'CrmLoginAttempt',
    id: 'a2',
    username: 'asha',
    userName: 'Asha',
    success: true,
    reason: null,
    ipAddress: '198.51.100.4',
    userAgent: 'Firefox',
    createdAt: new Date().toISOString(),
  }

  test('a failure is distinguishable from a success at a glance', async () => {
    // Read once, after an incident. If both rows look the same the log answers
    // nothing.
    mountSecurity([failed, ok], [])
    await waitFor(() => assert.ok(screen.getByText('mallory')))
    assert.ok(screen.getByText('asha'))
    assert.ok(screen.getByText(/BAD_PASSWORD|bad password/i), 'the reason for a refusal was not shown')
  })

  test('shows where the attempt came from', async () => {
    mountSecurity([failed], [])
    await waitFor(() => assert.ok(screen.getByText('203.0.113.9')))
  })
})

describe('the PII access log', () => {
  test('records who looked at what, which is its entire purpose', async () => {
    mountSecurity(
      [],
      [
        {
          __typename: 'CrmPiiAccessEntry',
          id: 'p1',
          userName: 'Asha',
          resourceType: 'player_export',
          resourceId: '42',
          action: 'export',
          fields: ['name', 'phone'],
          ipAddress: '198.51.100.4',
          createdAt: new Date().toISOString(),
        },
      ]
    )
    // It lives behind a tab, so it only mounts once that tab is opened — which
    // is also the only way a person reaches it.
    await waitFor(() => assert.ok(screen.getByText('Data access')))
    fireEvent.click(screen.getByText('Data access'))
    await waitFor(() => assert.ok(screen.getAllByText(/player_export|export/i).length > 0))
  })

  test('the security screen offers all three of its views', async () => {
    mountSecurity([], [])
    await waitFor(() => assert.ok(screen.getByText('Sign-in attempts')))
    assert.ok(screen.getByText('Address allowlist'))
    assert.ok(screen.getByText('Data access'))
  })
})
