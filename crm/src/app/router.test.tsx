import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { AppRouter } from '@/app/router'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'
import { ME, MY_NOTIFICATIONS } from '@/lib/gql'

/**
 * Who lands where.
 *
 * `navigation.test.ts` proves `landingPath` picks the right screen. This proves
 * the router actually uses it — which is the half that was broken: every
 * refusal used to redirect to a hardcoded `/players`, a route that is itself
 * gated, so a user without `crm.players:view` was sent to a screen the server
 * refuses and shown an error with no navigation and no explanation.
 *
 * The three cases that matter are a guarded route the caller may not open, a
 * catch-all path, and an account with no screens at all — the last of which
 * must produce a message rather than a redirect that never settles.
 */

function me(permissions: CrmPermissionPair[], over: Partial<CrmMe> = {}): CrmMe {
  return {
    id: 'u1',
    name: 'Agent',
    email: null,
    status: 'ACTIVE',
    requirePasswordReset: false,
    tenant: 'default',
    whitelabelName: 'Test WL',
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

/**
 * The shell re-reads the caller on mount, and renders the notification bell,
 * which queries on mount too. An unmocked bell does not fail anything — it just
 * errors quietly and buries the run in warnings.
 */
const meMock = (who: CrmMe) => [
  { request: { query: ME }, result: { data: { crmMe: asWire(who) } }, maxUsageCount: 10 },
  {
    request: { query: MY_NOTIFICATIONS },
    result: { data: { crmMyNotifications: [] } },
    maxUsageCount: 20,
  },
]

function mount(who: CrmMe | null, at: string, token: string | null = 'tok') {
  useAuth.setState({ token, me: who, lastActivityAt: Date.now() })
  return render(
    <MockedProvider mocks={who ? meMock(who) : []}>
      <MemoryRouter initialEntries={[at]}>
        <AppRouter />
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('before signing in', () => {
  test('every path shows the sign-in screen', async () => {
    mount(null, '/queue', null)
    await waitFor(() => assert.ok(screen.getByText(/Sign in to your desk/i)))
  })
})

describe('a screen the caller may not open', () => {
  test('lands them on one they can, not on a fixed path', async () => {
    // Security-only: no crm.players:view at all. The old behaviour sent them to
    // /players and left them staring at an error.
    mount(me([{ domain: 'crm.security', actions: ['view'] }]), '/queue')
    await waitFor(() => assert.ok(screen.getByText(/security/i)))
  })

  test('the catch-all does the same rather than assuming /players', async () => {
    mount(me([{ domain: 'crm.books', actions: ['view'] }]), '/no-such-page')
    await waitFor(() => assert.ok(screen.getByText(/books/i)))
  })
})

describe('an account with no screens', () => {
  test('is told so, instead of being redirected in a circle', async () => {
    // Reachable: every screen's permission is grantable, so a role can be saved
    // holding none of them.
    mount(me([]), '/players')
    await waitFor(() => assert.ok(screen.getByText('No screens available')))
    assert.ok(screen.getByText(/ask an administrator/i))
  })

  test('says the same for an unknown path', async () => {
    mount(me([]), '/anything')
    await waitFor(() => assert.ok(screen.getByText('No screens available')))
  })
})

describe('a forced password change', () => {
  test('takes over everything until it is done', async () => {
    // A credential an administrator typed into a chat window stays valid until
    // it is replaced, so nothing else may be reachable first.
    mount(
      me([{ domain: 'crm.players', actions: ['view'] }], { requirePasswordReset: true }),
      '/players'
    )
    await waitFor(() => assert.ok(screen.getByText("Choose your own password")))
  })
})

describe('a screen the caller may open', () => {
  test('renders instead of redirecting', async () => {
    mount(me([{ domain: 'crm.players', actions: ['view'] }]), '/players')
    await waitFor(() => assert.ok(screen.getByText(/players/i)))
    assert.equal(screen.queryByText('No screens available'), null)
  })
})
