import { test, describe, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { gql } from '@apollo/client'
import { apolloClient } from '@/lib/apollo'
import { useAuth, type CrmMe } from '@/state/auth'

/**
 * The transport, which is where three security decisions actually live.
 *
 * Every request carries the CRM token and `x-client-type: crm` — the second is
 * what `guardAdminSurface` uses to tell a CRM caller from an admin one, and a
 * request without it is answered as the wrong principal.
 *
 * The other two are about ending a session that should be over. A tab left open
 * overnight must not make its first request of the morning with last night's
 * token, and a token the server has rejected must not stay in place producing a
 * UI that looks signed in and fails every action.
 *
 * Tested against the real client with `fetch` stubbed, so it is the shipped
 * module under test rather than a rebuilt copy of its links.
 */

const PING = gql`
  query Ping {
    crmMe {
      id
    }
  }
`

const meFixture: CrmMe = {
  id: 'u1',
  name: 'Asha',
  email: null,
  status: 'ACTIVE',
  requirePasswordReset: false,
  tenant: 'acme',
  whitelabelName: null,
  permissions: [],
  bookIds: [],
  canViewAllPlayers: false,
  sessionIdleMinutes: 60,
  outOfOfficeUntil: null,
  delegateTo: null,
}

let sent: Array<{ headers: Record<string, string> }> = []

function stubFetch(body: unknown) {
  return vi.fn(async (_url: unknown, init: { headers?: Record<string, string> } = {}) => {
    sent.push({ headers: (init.headers ?? {}) as Record<string, string> })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response
  })
}

const OK_BODY = { data: { crmMe: { id: 'u1', __typename: 'CrmMe' } } }

beforeEach(() => {
  sent = []
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
  apolloClient.stop()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Header names arrive in whatever case the link used; compare lowercased. */
function headersOf(i = 0): Record<string, string> {
  const h = sent[i]?.headers ?? {}
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]))
}

async function ping() {
  try {
    await apolloClient.query({ query: PING, fetchPolicy: 'network-only' })
  } catch {
    /* the assertions are about what was sent and what the store did */
  }
}

describe('every request identifies itself as the CRM', () => {
  test('sends x-client-type, which is how the server picks the principal', async () => {
    vi.stubGlobal('fetch', stubFetch(OK_BODY))
    useAuth.setState({ token: 'tok-1', me: meFixture, lastActivityAt: Date.now() })
    await ping()
    assert.equal(sent.length, 1)
    assert.equal(headersOf()['x-client-type'], 'crm')
  })

  test('carries the token as a bearer credential', async () => {
    vi.stubGlobal('fetch', stubFetch(OK_BODY))
    useAuth.setState({ token: 'tok-1', me: meFixture, lastActivityAt: Date.now() })
    await ping()
    assert.equal(headersOf().authorization, 'Bearer tok-1')
  })

  test('sends no authorization header when there is no session', async () => {
    vi.stubGlobal('fetch', stubFetch(OK_BODY))
    await ping()
    assert.equal(headersOf().authorization, undefined)
    // Still identifies itself, so an unauthenticated call is answered by the
    // CRM surface rather than the admin one.
    assert.equal(headersOf()['x-client-type'], 'crm')
  })
})

describe('a session that has gone idle', () => {
  test('is ended before the request goes out, not after it comes back', async () => {
    // A tab left open overnight would otherwise make its first request of the
    // morning with last night's token.
    vi.stubGlobal('fetch', stubFetch(OK_BODY))
    useAuth.setState({
      token: 'stale',
      me: { ...meFixture, sessionIdleMinutes: 30 },
      lastActivityAt: Date.now() - 31 * 60_000,
    })
    await ping()
    assert.equal(useAuth.getState().token, null, 'an idle session survived a request')
    assert.equal(headersOf().authorization, undefined, 'a stale token was sent anyway')
  })

  test('a session inside the window is left alone', async () => {
    vi.stubGlobal('fetch', stubFetch(OK_BODY))
    useAuth.setState({
      token: 'fresh',
      me: { ...meFixture, sessionIdleMinutes: 30 },
      lastActivityAt: Date.now() - 5 * 60_000,
    })
    await ping()
    assert.equal(useAuth.getState().token, 'fresh')
    assert.equal(headersOf().authorization, 'Bearer fresh')
  })
})

describe('a token the server rejects', () => {
  test('ends the local session too', async () => {
    // Suspended, roles changed, the whitelabel's CRM switched off. Keeping the
    // token would leave a UI that looks signed in and fails every action.
    vi.stubGlobal(
      'fetch',
      stubFetch({ errors: [{ message: 'Unauthorized: CRM sign-in required' }] })
    )
    useAuth.setState({ token: 'revoked', me: meFixture, lastActivityAt: Date.now() })
    await ping()
    assert.equal(useAuth.getState().token, null, 'a rejected token was kept')
  })

  test('an ordinary error leaves the session alone', async () => {
    // Only an authentication failure means the session is over; a forbidden
    // action or a validation error does not.
    vi.stubGlobal(
      'fetch',
      stubFetch({ errors: [{ message: 'Forbidden: insufficient permissions for crm.books:view' }] })
    )
    useAuth.setState({ token: 'good', me: meFixture, lastActivityAt: Date.now() })
    await ping()
    assert.equal(useAuth.getState().token, 'good', 'a permission error signed the user out')
  })
})
