import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { NotificationBell } from '@/components/NotificationBell'
import { PasswordPage } from '@/routes/PasswordPage'
import { useAuth, type CrmMe } from '@/state/auth'
import { MY_NOTIFICATIONS, CHANGE_OWN_PASSWORD } from '@/lib/gql'

/**
 * The bell, and the password screen.
 *
 * The bell's only job is the count: an escalation that reaches an agent's inbox
 * and shows no badge has not reached them at all, and the ladder's fallback
 * quietly stops working. A badge that counts read notifications is the same
 * failure in reverse — it stops meaning anything and people stop looking.
 *
 * The password screen carries a rule that is easy to lose in a refactor:
 * changing a password bumps the token version server-side, so the session it
 * was changed from is already dead. Leaving the user signed in hands them a
 * token that fails on its next use, with no obvious cause.
 */

const meFixture: CrmMe = {
  id: 'u1',
  name: 'Asha',
  email: null,
  status: 'ACTIVE',
  requirePasswordReset: false,
  tenant: 'acme',
  whitelabelName: 'Acme Casino',
  permissions: [{ domain: 'crm.players', actions: ['view'] }],
  bookIds: [],
  canViewAllPlayers: false,
  sessionIdleMinutes: 60,
  outOfOfficeUntil: null,
  delegateTo: null,
}

function note(over: Record<string, unknown> = {}) {
  return {
    __typename: 'CrmNotification',
    id: 'n1',
    kind: 'TASK_ESCALATED',
    title: 'A task was escalated to you',
    body: null,
    resourceType: 'crm_task',
    resourceId: 't1',
    readAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

function mountBell(notifications: unknown[]) {
  useAuth.setState({ token: 'tok', me: meFixture, lastActivityAt: Date.now() })
  return render(
    <MockedProvider
      mocks={[
        {
          request: { query: MY_NOTIFICATIONS },
          result: { data: { crmMyNotifications: notifications } },
          maxUsageCount: 20,
        },
        {
          request: { query: MY_NOTIFICATIONS, variables: {} },
          result: { data: { crmMyNotifications: notifications } },
          maxUsageCount: 20,
        },
      ]}
     
    >
      <MemoryRouter>
        <AntApp>
          <NotificationBell />
        </AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('the notification bell', () => {
  test('counts the unread ones', async () => {
    mountBell([note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c', readAt: new Date().toISOString() })])
    // Two unread of three: a badge counting all three would stop meaning
    // anything, and people stop looking at a number that never falls.
    await waitFor(() => assert.ok(screen.getByText('2')))
  })

  test('shows no count when everything has been read', async () => {
    mountBell([note({ readAt: new Date().toISOString() })])
    await waitFor(() => assert.equal(screen.queryByText('1'), null))
  })

  test('shows no count on an empty inbox', async () => {
    const { container } = mountBell([])
    await waitFor(() => assert.ok(container.querySelector('button, .ant-badge')))
    assert.equal(screen.queryByText('1'), null)
  })
})

function mountPassword(mocks: unknown[], forced = false) {
  useAuth.setState({ token: 'tok', me: meFixture, lastActivityAt: Date.now() })
  return render(
    <MockedProvider mocks={mocks as never}>
      <MemoryRouter>
        <AntApp>
          <PasswordPage forced={forced} />
        </AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

async function fillPassword(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: /change password/i }))
}

describe('changing your own password', () => {
  const GOOD = 'Str0ng-Passw0rd!'

  test('refuses when the two new passwords disagree', async () => {
    // Caught on the screen, before a request: the server would accept the first
    // one and the user would be locked out by their own typo.
    mountPassword([])
    await fillPassword('old-password', GOOD, 'Str0ng-Passw0rd?')
    await waitFor(() => assert.ok(screen.getByText('The two new passwords do not match')))
  })

  test('shows the server’s refusal', async () => {
    mountPassword([
      {
        request: {
          query: CHANGE_OWN_PASSWORD,
          variables: { currentPassword: 'wrong', newPassword: GOOD },
        },
        result: {
          data: {
            crmChangeOwnPassword: {
              __typename: 'CrmMutationResult',
              ok: false,
              error: 'Current password is incorrect',
            },
          },
        },
      },
    ])
    await fillPassword('wrong', GOOD, GOOD)
    await waitFor(() => assert.ok(screen.getByText('Current password is incorrect')))
  })

  test('ends the session on success, because the old token is already dead', async () => {
    mountPassword([
      {
        request: {
          query: CHANGE_OWN_PASSWORD,
          variables: { currentPassword: 'old-password', newPassword: GOOD },
        },
        result: {
          data: {
            crmChangeOwnPassword: { __typename: 'CrmMutationResult', ok: true, error: null },
          },
        },
      },
    ])
    await fillPassword('old-password', GOOD, GOOD)
    await waitFor(() => assert.equal(useAuth.getState().token, null))
    assert.equal(useAuth.getState().me, null)
  })
})

describe('a forced password change', () => {
  test('explains why the user is being made to do it', async () => {
    mountPassword([], true)
    await waitFor(() => assert.ok(screen.getByText('Choose your own password')))
  })

  test('the ordinary screen does not show that explanation', async () => {
    mountPassword([], false)
    await waitFor(() => assert.ok(screen.getByLabelText('Current password')))
    assert.equal(screen.queryByText('Choose your own password'), null)
  })
})
