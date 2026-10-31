import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { LoginPage } from '@/routes/LoginPage'
import { useAuth } from '@/state/auth'
import { LOGIN } from '@/lib/gql'

/**
 * Signing in, and the three ways it goes wrong.
 *
 * A sign-in screen that swallows a failure is worse than one that crashes: the
 * user types the right password, nothing happens, and there is nothing to
 * report. Each failure has to reach the screen —
 *
 *   - the server refused, and said why
 *   - the server refused and said nothing, so the screen must supply a message
 *   - the server could not be reached at all, which is a different problem and
 *     needs to read differently, or people retype a password that was correct
 *
 * The success path has its own requirement: the session is only established
 * when the server says ok *and* hands over a token. Storing a session on a
 * half-answer would leave a signed-in user with no credentials.
 */

const meFixture = {
  __typename: 'CrmMe',
  id: 'u1',
  name: 'Asha',
  email: null,
  status: 'ACTIVE',
  requirePasswordReset: false,
  tenant: 'acme',
  whitelabelName: 'Acme Casino',
  permissions: [{ __typename: 'CrmPermissionPair', domain: 'crm.players', actions: ['view'] }],
  bookIds: [],
  canViewAllPlayers: false,
  sessionIdleMinutes: 60,
  outOfOfficeUntil: null,
  delegateTo: null,
}

function mount(mocks: unknown[]) {
  return render(
    <MockedProvider mocks={mocks as never}>
      <LoginPage />
    </MockedProvider>
  )
}

async function submit(username = 'asha', password = 'Str0ng-Passw0rd!') {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

const loginMock = (result: unknown) => [
  {
    request: { query: LOGIN, variables: { username: 'asha', password: 'Str0ng-Passw0rd!' } },
    ...(result as Record<string, unknown>),
  },
]

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('a successful sign-in', () => {
  test('stores the session the server handed back', async () => {
    mount(
      loginMock({
        result: {
          data: { crmLogin: { __typename: 'CrmLoginResult', ok: true, error: null, token: 'tok-123', me: meFixture } },
        },
      })
    )
    await submit()
    await waitFor(() => assert.equal(useAuth.getState().token, 'tok-123'))
    assert.equal(useAuth.getState().me?.name, 'Asha')
  })

  test('does not sign in on an ok without a token', async () => {
    // A half-answer would otherwise produce a signed-in user holding no
    // credential — every request then fails and the only way out is a manual
    // sign-out.
    mount(
      loginMock({
        result: { data: { crmLogin: { __typename: 'CrmLoginResult', ok: true, error: null, token: null, me: meFixture } } },
      })
    )
    await submit()
    await waitFor(() => assert.ok(screen.getByText('Sign-in failed')))
    assert.equal(useAuth.getState().token, null)
  })
})

describe('a refused sign-in', () => {
  test('shows the server’s own message rather than inventing one', async () => {
    mount(
      loginMock({
        result: {
          data: {
            crmLogin: {
              __typename: 'CrmLoginResult',
              ok: false,
              error: 'Your account is locked. Contact an administrator.',
              token: null,
              me: null,
            },
          },
        },
      })
    )
    await submit()
    await waitFor(() =>
      assert.ok(screen.getByText('Your account is locked. Contact an administrator.'))
    )
    assert.equal(useAuth.getState().token, null)
  })

  test('supplies a message when the server sends none', async () => {
    mount(
      loginMock({
        result: { data: { crmLogin: { __typename: 'CrmLoginResult', ok: false, error: null, token: null, me: null } } },
      })
    )
    await submit()
    await waitFor(() => assert.ok(screen.getByText('Sign-in failed')))
  })
})

describe('when the server cannot be reached', () => {
  test('says so, distinctly from a rejected password', async () => {
    // Someone told "sign-in failed" retypes their password. Someone told the
    // server is unreachable checks the server.
    mount(loginMock({ error: new Error('connection refused') }))
    await submit()
    await waitFor(() => assert.ok(screen.getByText('Could not reach the server. Try again.')))
    assert.equal(useAuth.getState().token, null)
  })
})

describe('the form itself', () => {
  test('asks for a username and a password', async () => {
    mount([])
    assert.ok(screen.getByLabelText('Username'))
    assert.ok(screen.getByLabelText('Password'))
    assert.ok(screen.getByRole('button', { name: /sign in/i }))
  })
})
