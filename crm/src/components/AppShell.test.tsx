import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'
import { ME, MY_NOTIFICATIONS } from '@/lib/gql'

/**
 * The sidebar is a permission surface.
 *
 * It is not the protection — the server refuses regardless — but it is the only
 * thing that tells an agent what their account is for. Showing an entry they
 * cannot open wastes a click and reads as a fault; hiding one they can open
 * hides a job nobody then does. Both are silent.
 *
 * The two status badges matter for the same reason: a deactivated agent whose
 * writes are all being refused needs to know that is why.
 */

function me(permissions: CrmPermissionPair[], over: Partial<CrmMe> = {}): CrmMe {
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
    ...over,
  }
}

/**
 * The wire shape of the caller: the same object plus the type names Apollo's
 * cache normalises on. Kept apart from the `CrmMe` fixture so the fixture stays
 * the type the app actually consumes.
 */
const asWire = (who: CrmMe) => ({
  __typename: 'CrmMe',
  ...who,
  permissions: who.permissions.map((p) => ({ __typename: 'CrmPermissionPair', ...p })),
})

function mount(who: CrmMe) {
  useAuth.setState({ token: 'tok', me: who, lastActivityAt: Date.now() })
  return render(
    <MockedProvider
      mocks={[
        { request: { query: ME }, result: { data: { crmMe: asWire(who) } }, maxUsageCount: 10 },
        // The shell renders the notification bell, which queries on mount.
        // Leaving it unmocked does not fail the test — it just makes the bell
        // error quietly and fills the run with warnings that hide real ones.
        {
          request: { query: MY_NOTIFICATIONS },
          result: { data: { crmMyNotifications: [] } },
          maxUsageCount: 20,
        },
      ]}
     
    >
      <MemoryRouter initialEntries={['/players']}>
        <AppShell>
          <div>page body</div>
        </AppShell>
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('the sidebar shows exactly what the account can open', () => {
  test('an agent with players and tasks sees three entries and no more', async () => {
    mount(
      me([
        { domain: 'crm.players', actions: ['view'] },
        { domain: 'crm.tasks', actions: ['view'] },
      ])
    )
    await waitFor(() => assert.ok(screen.getByText('Players')))
    assert.ok(screen.getByText('Queue'))
    // Desk health rides on the same permission as the queue.
    assert.ok(screen.getByText('Desk health'))

    for (const hidden of ['Books', 'CRM users', 'Roles', 'Security', 'Tags']) {
      assert.equal(screen.queryByText(hidden), null, `${hidden} was offered without its permission`)
    }
  })

  test('an administrator sees the administrative entries too', async () => {
    mount(
      me([
        { domain: 'crm.players', actions: ['view'] },
        { domain: 'crm.books', actions: ['view'] },
        { domain: 'crm.users', actions: ['view'] },
        { domain: 'crm.roles', actions: ['view'] },
        { domain: 'crm.security', actions: ['view'] },
        { domain: 'crm.tags', actions: ['apply'] },
      ])
    )
    await waitFor(() => assert.ok(screen.getByText('Players')))
    for (const shown of ['Books', 'CRM users', 'Roles', 'Security', 'Tags']) {
      assert.ok(screen.getByText(shown), `${shown} was hidden from someone who holds it`)
    }
  })

  test('an account with no permissions is offered nothing at all', async () => {
    mount(me([]))
    await waitFor(() => assert.ok(screen.getByText('page body')))
    for (const entry of ['Players', 'Queue', 'Desk health', 'Books', 'CRM users', 'Roles', 'Security', 'Tags']) {
      assert.equal(screen.queryByText(entry), null, `${entry} was offered to an account with no permissions`)
    }
  })
})

describe('the shell tells you whose desk you are on', () => {
  test('names the whitelabel rather than the raw tenant id', async () => {
    mount(me([{ domain: 'crm.players', actions: ['view'] }]))
    await waitFor(() => assert.ok(screen.getByText('Acme Casino')))
    assert.equal(screen.queryByText('acme'), null, 'the internal tenant id was shown to the user')
  })

  test('falls back to the tenant when the whitelabel has no name', async () => {
    mount(me([{ domain: 'crm.players', actions: ['view'] }], { whitelabelName: null }))
    await waitFor(() => assert.ok(screen.getByText('acme')))
  })
})

describe('status badges', () => {
  test('a deactivated agent is told their session is read-only', async () => {
    // Otherwise every write fails with a message they cannot connect to a cause.
    mount(me([{ domain: 'crm.players', actions: ['view'] }], { status: 'INACTIVE' }))
    await waitFor(() => assert.ok(screen.getByText('View only')))
  })

  test('an active agent carries no such badge', async () => {
    mount(me([{ domain: 'crm.players', actions: ['view'] }]))
    await waitFor(() => assert.ok(screen.getByText('Players')))
    assert.equal(screen.queryByText('View only'), null)
  })

  test('whitelabel-wide visibility is shown, because it changes what the lists mean', async () => {
    mount(me([{ domain: 'crm.players', actions: ['view'] }], { canViewAllPlayers: true }))
    await waitFor(() => assert.ok(screen.getByText('All players')))
  })
})

describe('the account menu', () => {
  test('renders the page it wraps', async () => {
    mount(me([{ domain: 'crm.players', actions: ['view'] }]))
    await waitFor(() => assert.ok(screen.getByText('page body')))
  })
})
