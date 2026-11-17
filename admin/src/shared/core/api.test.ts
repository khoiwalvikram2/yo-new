/**
 * The link chain every admin request goes through (shared/core/api.ts), driven end to end with a stubbed
 * fetch so each assertion counts what really left the browser.
 *
 * The error link ended with `return forward(operation)`. In Apollo's onError that is a retry, not a
 * pass-through: every operation that came back with an error, or failed on the network, was sent a second
 * time. One click on a refused save ran the mutation twice, one wrong password counted twice against the
 * login lockout, and a mutation whose response was lost after the server committed it ran again.
 *
 * The auth link half: an operation may name the whitelabel it is about. App Configuration opened from the
 * Whitelabels list sent a bare x-whitelabel-id header, which the server ignores in core mode, so the page
 * said "Managing: <brand>" while it read and would have saved the default tenant's settings.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { gql } from '@apollo/client'

const feedback = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
/* The subscription socket (graphql-ws): each subscription is answered by `socket.answer`, which drives the sink the
   way the real client does (an Error for a message it cannot read, a close event, or the server's GraphQL errors). */
type Sink = { next: (value: unknown) => void; error: (error: unknown) => void; complete: () => void }
const socket = vi.hoisted(() => ({ answer: undefined as undefined | ((sink: Sink) => void), subscribed: 0 }))
vi.mock('graphql-ws', () => ({
  createClient: () => ({
    subscribe: (_payload: unknown, sink: Sink) => {
      socket.subscribed += 1
      queueMicrotask(() => socket.answer?.(sink))
      return () => {}
    },
    on: () => () => {},
    dispose: () => {},
    terminate: () => {},
  }),
}))
// The real store loads the Super Admin's saved mode in the background, which would race these requests.
vi.mock('./uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create(() => ({ directorMode: 'core' as 'core' | 'whitelabel', selectedWhitelabelId: null as string | null })) }
})

import { apolloClient, isSubscriptionTransportFailure } from './api'
import { useAuthStore } from './authStore'
import { clearSignOutReason, readSignOutNotice } from './signOutReason'
import { useUIStore } from './uiStore'

const SAVE = gql`mutation SaveThing($id: ID!) { saveThing(id: $id) { success message } }`
const READ = gql`query ReadThing { readThing { id } }`

/** A token the session guard accepts (it refuses an expired or unreadable one before any request). */
const liveToken = () => `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.y`

type Sent = { operation: string; headers: Record<string, string> }
let sent: Sent[]

/** Answers the operation named `name` with `result` (a string is sent raw, with `init`) and records each
 *  time it is sent. The link batches, so a request is an array and is answered with one. */
function answer(name: string, result: unknown, init: ResponseInit = { status: 200 }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_uri, options) => {
    const request = JSON.parse(String(options?.body)) as Array<{ operationName: string }>
    for (const op of request) if (op.operationName === name) sent.push({ operation: name, headers: (options?.headers ?? {}) as Record<string, string> })
    const body = typeof result === 'string' ? result : JSON.stringify(request.map((op) => (op.operationName === name ? result : { data: null })))
    return new Response(body, { headers: { 'content-type': 'application/json' }, ...init })
  })
}

beforeEach(() => {
  sent = []
  feedback.toast.mockReset()
  sessionStorage.clear()
  socket.answer = undefined
  socket.subscribed = 0
  useAuthStore.setState({ token: liveToken(), user: { id: '2', name: 'Admin' } as never, agent: undefined, roles: ['Super Admin'], permissions: [] })
  useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
})

afterEach(() => { vi.restoreAllMocks() })

describe('a failing operation is sent once and its error reaches the caller', () => {
  test('a refused mutation goes out once and rejects with the server message', async () => {
    answer('SaveThing', { data: { saveThing: null }, errors: [{ message: 'Forbidden: insufficient permissions for casino.management:update' }] })
    await assert.rejects(apolloClient.mutate({ mutation: SAVE, variables: { id: '1' } }), /Forbidden: insufficient permissions/)
    assert.equal(sent.length, 1, 'the refused mutation was sent again')
  })

  test('a mutation whose response is lost is not sent again', async () => {
    answer('SaveThing', '<html>Bad Gateway</html>', { status: 502 })
    await assert.rejects(apolloClient.mutate({ mutation: SAVE, variables: { id: '2' } }))
    assert.equal(sent.length, 1, 'a 502 after the server may have committed must not run the mutation a second time')
  })

  test('a failing query goes out once, keeps its error and toasts it once', async () => {
    answer('ReadThing', { data: { readThing: null }, errors: [{ message: 'Matka market not found' }] })
    const result = await apolloClient.query({ query: READ, fetchPolicy: 'no-cache' })
    assert.equal(result.errors?.[0]?.message, 'Matka market not found')
    assert.equal(sent.length, 1)
    assert.equal(feedback.toast.mock.calls.length, 1)
  })

  test('a query that reports its own outcome (skipNotification) keeps its error and raises no toast', async () => {
    answer('ReadThing', { data: { readThing: null }, errors: [{ message: 'Cannot query field "readThing" on type "Query".' }] })
    const result = await apolloClient.query({ query: READ, fetchPolicy: 'no-cache', context: { skipNotification: true } })
    assert.match(String(result.errors?.[0]?.message), /Cannot query field/)
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('a session-ending error still signs the admin out, without a second request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // jsdom cannot navigate to /login
    answer('ReadThing', { data: null, errors: [{ message: 'Unauthorized: session invalid. Please sign in again.' }] })
    const result = await apolloClient.query({ query: READ, fetchPolicy: 'no-cache' })
    assert.match(String(result.errors?.[0]?.message), /session invalid/)
    assert.equal(useAuthStore.getState().token, undefined, 'the session was not ended')
    assert.ok(feedback.toast.mock.calls.some(([options]) => options.title === 'Session ended'))
    assert.equal(sent.length, 1)
    // N003: the reload to /login drops that toast, so the reason is recorded for the sign-in page to show.
    assert.equal(readSignOutNotice()?.title, 'Session ended', 'the sign-in page would not know why')
    // The route guard shows this document's sign-in page before the reload lands (the sign-in chunk is loaded after a
    // sign-in through the form). That page must leave the reason for the reloaded one: it cleared it, and with a real
    // network round trip the reloaded sign-in page showed no reason.
    clearSignOutReason()
    assert.equal(readSignOutNotice()?.title, 'Session ended', 'the sign-in page shown before the reload used up the reason')
  })

  test('a session-ending reply that arrives after a sign-out on purpose raises nothing and does not reload', async () => {
    // An admin's password change signs the panel out at once; a poll already in flight then comes back refused.
    const realLogout = useAuthStore.getState().logout
    realLogout()
    // The force-logout branch signs out, toasts and reloads /login together; a spy shows whether it ran.
    const forcedLogout = vi.fn()
    useAuthStore.setState({ logout: forcedLogout })
    try {
      answer('ReadThing', { data: null, errors: [{ message: 'Unauthorized: session invalid. Please sign in again.' }] })
      const result = await apolloClient.query({ query: READ, fetchPolicy: 'no-cache' })
      assert.match(String(result.errors?.[0]?.message), /session invalid/, 'the caller still gets the error')
      assert.equal(feedback.toast.mock.calls.length, 0, 'no "Session ended" over the sign-out\'s own message')
      assert.equal(forcedLogout.mock.calls.length, 0, 'the force-logout branch (sign out, toast, reload /login) ran')
      assert.equal(readSignOutNotice(), null, 'no forced-sign-out reason for a sign-out on purpose')
      assert.equal(sent.length, 1)
    } finally {
      useAuthStore.setState({ logout: realLogout })
    }
  })
})

/* T029: a tenant stored in this browser that is not this whitelabel admin's own (another session's sign-in) makes the
   server refuse every request. It used to be toasted again on every request; now it clears the stored tenant and
   signs out once, with the reason on the sign-in page. */
describe('a stale stored tenant signs out once instead of toasting forever', () => {
  const STALE = 'Access denied: Whitelabel Admins can only access their own tenant'
  const OTHER = gql`query ReadOther { readOther { id } }`

  /** Every operation of every request is refused with `message`, under `status` (the backend's own shape). */
  function refuseAll(message: string, status = 200) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_uri, options) => {
      const request = JSON.parse(String(options?.body)) as Array<{ operationName: string }>
      for (const op of request) sent.push({ operation: op.operationName, headers: (options?.headers ?? {}) as Record<string, string> })
      return new Response(JSON.stringify(request.map(() => ({ data: null, errors: [{ message }] }))), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    })
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // jsdom cannot navigate to /login
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    window.localStorage.setItem('TENANT', 'kondareddi-com')
    window.localStorage.setItem('X_WHITELABEL_ID', 'kondareddi-com')
  })

  test('clears the stored tenant and the session, records the reason, and says it once', async () => {
    refuseAll(STALE)
    const result = await apolloClient.query({ query: READ, fetchPolicy: 'no-cache' })
    assert.equal(result.errors?.[0]?.message, STALE, 'the caller still gets the refusal')
    assert.equal(window.localStorage.getItem('TENANT'), null)
    assert.equal(window.localStorage.getItem('X_WHITELABEL_ID'), null)
    assert.equal(useAuthStore.getState().token, undefined, 'the session was not ended')
    assert.deepEqual(feedback.toast.mock.calls.map(([options]) => [options.title, options.message]), [
      ['Signed out', 'This browser held another whitelabel. Please sign in again.'],
    ])
    assert.equal(readSignOutNotice()?.title, 'Signed out')
    assert.match(String(readSignOutNotice()?.text), /another whitelabel/)
    assert.equal(sent.length, 1, 'the refused request is not sent again')
  })

  test('a burst of refused requests (and later replies) signs out and toasts once, never the raw refusal', async () => {
    refuseAll('Access denied: Whitelabel Admins cannot switch tenants')
    await Promise.all([
      apolloClient.query({ query: READ, fetchPolicy: 'no-cache' }),
      apolloClient.query({ query: OTHER, fetchPolicy: 'no-cache' }),
    ])
    // A reply still in flight after the sign-out finds no session: nothing more is said.
    await apolloClient.query({ query: READ, fetchPolicy: 'no-cache' })
    assert.deepEqual(feedback.toast.mock.calls.map(([options]) => options.title), ['Signed out'])
    assert.equal(readSignOutNotice()?.title, 'Signed out')
  })

  test('the refusal sent with an HTTP 403 is handled the same, without a network-error toast', async () => {
    refuseAll(STALE, 403)
    await assert.rejects(apolloClient.query({ query: READ, fetchPolicy: 'no-cache' }))
    assert.equal(useAuthStore.getState().token, undefined)
    assert.deepEqual(feedback.toast.mock.calls.map(([options]) => options.title), ['Signed out'])
  })

  test('another tenant refusal that is not about the stored tenant is toasted as before and keeps the session', async () => {
    refuseAll('Agent does not belong to your tenant')
    await apolloClient.query({ query: READ, fetchPolicy: 'no-cache' })
    assert.ok(useAuthStore.getState().token, 'a scope refusal signed the admin out')
    assert.equal(window.localStorage.getItem('TENANT'), 'kondareddi-com')
    assert.deepEqual(feedback.toast.mock.calls.map(([options]) => options.message), ['Agent does not belong to your tenant'])
  })
})

/* N002 (SCO-10 follow-up): when the server refuses the subscription socket ("Unauthorized: subscriptions require an
   admin session"), mercurius answers with the legacy connection_error message; graphql-ws cannot read it and the raw
   "Invalid message 'type' property "connection_error"" was toasted beside the readable session message. */
describe('a subscription that fails in its socket raises no toast', () => {
  const WATCH = gql`subscription WatchThing { thingChanged { id } }`
  /** Subscribes once and resolves with what the subscriber was handed: the error, or 'complete'. */
  const outcome = () => new Promise<unknown>((resolve) => {
    apolloClient.subscribe({ query: WATCH }).subscribe({ error: resolve, complete: () => resolve('complete') })
  })

  test('a protocol message graphql-ws cannot read reaches the subscriber, not a toast', async () => {
    socket.answer = (sink) => sink.error(new Error('Invalid message \'type\' property "connection_error"'))
    const error = await outcome()
    assert.equal(socket.subscribed, 1, 'the subscription went over the socket')
    assert.match(String((error as Error)?.message), /connection_error/, 'the subscriber still learns it failed')
    assert.equal(feedback.toast.mock.calls.length, 0, 'raw protocol text was toasted')
  })

  test('a refused or dropped socket (a close event) raises no toast either', async () => {
    socket.answer = (sink) => sink.error({ code: 4403, reason: 'Forbidden' })
    const error = await outcome()
    assert.match(String((error as Error)?.message), /Socket closed with event 4403/)
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('GraphQL errors the server answers a subscription with are still toasted, as before', async () => {
    socket.answer = (sink) => sink.error([{ message: 'Agent not found' }])
    await outcome()
    assert.deepEqual(feedback.toast.mock.calls.map(([options]) => options.message), ['Agent not found'])
  })

  test('a session-ending refusal on a query still signs out, whatever the socket did', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // jsdom cannot navigate to /login
    socket.answer = (sink) => sink.error(new Error('Invalid message \'type\' property "connection_error"'))
    await outcome()
    answer('ReadThing', { data: null, errors: [{ message: 'Unauthorized: session invalid. Please sign in again.' }] })
    await apolloClient.query({ query: READ, fetchPolicy: 'no-cache' })
    assert.equal(useAuthStore.getState().token, undefined)
    assert.deepEqual(feedback.toast.mock.calls.map(([options]) => options.title), ['Session ended'], 'only the readable message')
  })

  test('only a subscription without GraphQL errors counts as a transport failure', () => {
    const subscription = { operation: 'subscription' }
    assert.equal(isSubscriptionTransportFailure(subscription, new Error('Socket closed with event 1006')), true)
    assert.equal(isSubscriptionTransportFailure(subscription, { message: 'x', graphQLErrors: [] }), true)
    assert.equal(isSubscriptionTransportFailure(subscription, { message: 'x', graphQLErrors: [{ message: 'x' }] }), false)
    assert.equal(isSubscriptionTransportFailure({ operation: 'query' }, new Error('Failed to fetch')), false, 'a query keeps its toast')
    assert.equal(isSubscriptionTransportFailure(null, new Error('Failed to fetch')), false)
  })
})

describe('an operation sent with its own sign-in token (Reset Password at sign-in)', () => {
  test('keeps that token while nobody is signed in, with the whitelabel stored at sign-in', async () => {
    // The sign-in page keeps no session while the required change is pending; the change carries the token itself.
    useAuthStore.getState().logout()
    window.localStorage.setItem('X_WHITELABEL_ID', 'grandwinn-com')
    window.localStorage.setItem('TENANT', 'grandwinn-com')
    answer('SaveThing', { data: { saveThing: { success: true, message: 'Password changed successfully' } } })
    await apolloClient.mutate({ mutation: SAVE, variables: { id: '1' }, context: { headers: { authorization: 'Bearer sign-in-token' } } })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].headers.authorization, 'Bearer sign-in-token')
    assert.equal(sent[0].headers['x-whitelabel-id'], 'grandwinn-com')
  })
})

describe('an operation may name the whitelabel it is about', () => {
  const read = (context?: Record<string, unknown>) => apolloClient.query({ query: READ, fetchPolicy: 'no-cache', context })

  test('a Super Admin in core mode runs a targeted operation in that whitelabel', async () => {
    answer('ReadThing', { data: { readThing: { id: '1' } } })
    await read({ targetWhitelabelId: 'grandwinn-com' })
    assert.equal(sent[0].headers['x-admin-mode'], 'whitelabel')
    assert.equal(sent[0].headers['x-whitelabel-id'], 'grandwinn-com')
  })

  test('without a target the Super Admin stays in the selected mode', async () => {
    answer('ReadThing', { data: { readThing: { id: '1' } } })
    await read()
    assert.equal(sent[0].headers['x-admin-mode'], 'core')
    assert.equal(sent[0].headers['x-whitelabel-id'], undefined)
    useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'kondareddi-com' })
    await read()
    assert.equal(sent[1].headers['x-whitelabel-id'], 'kondareddi-com')
  })

  test('a Whitelabel Admin cannot point an operation at another tenant', async () => {
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    window.localStorage.setItem('TENANT', 'kondareddi-com')
    answer('ReadThing', { data: { readThing: { id: '1' } } })
    await read({ targetWhitelabelId: 'grandwinn-com' })
    assert.equal(sent[0].headers['x-whitelabel-id'], 'kondareddi-com')
    assert.equal(sent[0].headers['x-admin-mode'], undefined)
  })
})
