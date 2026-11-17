import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { DocumentNode } from 'graphql'
import { rememberSignOutReason } from '@/shared/core/signOutReason'
import LoginPage from './LoginPage'

type LoginCallbacks = { onCompleted: (data: unknown) => void; onError: (error: Error) => void }
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), login: vi.fn(), agentLogin: vi.fn(), hydrated: vi.fn(), tenant: vi.fn(), toast: vi.fn(),
  logout: vi.fn(), adminMutation: vi.fn(), agentMutation: vi.fn(), adminLoading: false, agentLoading: false,
  callbacks: new Map<string, LoginCallbacks>(), documents: new Map<string, DocumentNode>(),
  from: undefined as undefined | { from: { pathname: string } },
  session: { token: '', agent: null as object | null },
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ state: mocks.from }),
}))
vi.mock('@apollo/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@apollo/client')>(),
  useMutation: (document: DocumentNode, callbacks: LoginCallbacks) => {
    const operation = document.definitions.find((definition) => definition.kind === 'OperationDefinition')
    const agent = operation?.kind === 'OperationDefinition' && operation.name?.value === 'AgentLogin'
    mocks.callbacks.set(agent ? 'agent' : 'admin', callbacks)
    mocks.documents.set(agent ? 'agent' : 'admin', document)
    return [agent ? mocks.agentMutation : mocks.adminMutation,
      { loading: agent ? mocks.agentLoading : mocks.adminLoading }]
  },
}))
vi.mock('@/shared/core/authStore', () => ({ useAuthStore: { getState: () => ({
  login: mocks.login, agentLogin: mocks.agentLogin, setHasHydrated: mocks.hydrated, logout: mocks.logout, ...mocks.session,
}) } }))
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: { getState: () => ({ setTenant: mocks.tenant }) } }))
vi.mock('@/ui/components/toast', () => ({ toast: mocks.toast }))
/* The dialog's own behaviour (the token on the change, the sign-out rules) is ChangePasswordModal.test.tsx's; here
   it is a stand-in that shows what it was given and can finish either way. */
vi.mock('@/shared/ui/ChangePasswordModal', () => ({
  ChangePasswordModal: (props: { open: boolean; sessionToken?: string; onChanged?: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Change Password" data-open={String(props.open)} data-token={props.sessionToken}>
      <button type="button" onClick={() => { props.onChanged?.(); props.onClose() }}>Stub: password changed</button>
      <button type="button" onClick={() => props.onClose()}>Stub: cancel</button>
    </div>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.callbacks.clear()
  mocks.documents.clear()
  mocks.adminMutation.mockResolvedValue({})
  mocks.agentMutation.mockResolvedValue({})
  mocks.adminLoading = false
  mocks.agentLoading = false
  mocks.from = undefined
  mocks.session = { token: '', agent: null }
  mocks.agentLogin.mockImplementation((payload: { token: string; agent: object }) => { mocks.session = payload })
  localStorage.removeItem('TENANT')
  localStorage.removeItem('X_WHITELABEL_ID')
})
afterEach(cleanup)

function page() { return render(<MemoryRouter><LoginPage /></MemoryRouter>) }
function submit(identifier: string, password = 'test-secret') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Email or Username' }), { target: { value: identifier } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
}

describe('portal sign-in contracts', () => {
  test('admin email submits the same trimmed mutation input and keeps the password out of markup', async () => {
    page()
    submit(' admin@example.test ', ' test-secret ')
    await waitFor(() => assert.equal(mocks.adminMutation.mock.calls.length, 1))
    assert.deepEqual(mocks.adminMutation.mock.calls[0][0], { variables: { input: { email: 'admin@example.test', password: 'test-secret' } } })
    assert.equal(mocks.agentMutation.mock.calls.length, 0)
    const password = screen.getByLabelText(/^Password/) as HTMLInputElement
    assert.equal(password.getAttribute('value'), null)
    assert.equal(password.getAttribute('autocomplete'), 'current-password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    assert.equal(password.type, 'text')
  })

  test('admin success saves tenant headers and restores the requested route', () => {
    mocks.from = { from: { pathname: '/reporting/pnl' } }
    page()
    const user = { id: 'admin-1', name: 'Admin' }
    act(() => mocks.callbacks.get('admin')!.onCompleted({ login: {
      user, roles: ['ADMIN'], permissions: [], token: 'admin-token', tenant: ' tenant-1 ',
    } }))
    assert.deepEqual(mocks.login.mock.calls[0][0], { user, roles: ['ADMIN'], permissions: [], token: 'admin-token' })
    assert.deepEqual(mocks.tenant.mock.calls[0], ['tenant-1', true])
    assert.equal(localStorage.getItem('TENANT'), 'tenant-1')
    assert.equal(localStorage.getItem('X_WHITELABEL_ID'), 'tenant-1')
    assert.deepEqual(mocks.navigate.mock.calls[0], ['/reporting/pnl', { replace: true }])
  })

  test('admin root redirect still selects a route allowed by their permissions', () => {
    page()
    act(() => mocks.callbacks.get('admin')!.onCompleted({ login: {
      user: { id: 'support-1' }, roles: ['SUPPORT'], token: 'token',
      permissions: [{ domain: 'payments.withdrawals', actions: ['view'] }],
    } }))
    assert.deepEqual(mocks.navigate.mock.calls[0], ['/payments/withdrawal-requests', { replace: true }])
  })

  test('agent username keeps its mutation, tenant, read-only mode and agent-home redirect', async () => {
    mocks.from = { from: { pathname: '/reporting/pnl' } }
    page()
    submit(' agent01 ')
    await waitFor(() => assert.equal(mocks.agentMutation.mock.calls.length, 1))
    assert.deepEqual(mocks.agentMutation.mock.calls[0][0], { variables: { input: { username: 'agent01', password: 'test-secret' } } })
    const agent = { id: 'agent-1', status: 'INACTIVE', tenantId: 'agent-tenant' }
    act(() => mocks.callbacks.get('agent')!.onCompleted({ agents: { agentLogin: {
      agent, token: 'agent-token', permissions: [],
    } } }))
    assert.deepEqual(mocks.agentLogin.mock.calls[0][0], { agent, token: 'agent-token', permissions: [], isReadOnly: true })
    assert.deepEqual(mocks.hydrated.mock.calls[0], [true])
    assert.equal(localStorage.getItem('X_WHITELABEL_ID'), 'agent-tenant')
    await waitFor(() => assert.deepEqual(mocks.navigate.mock.calls[0], ['/agent', { replace: true }]))
  })

  test.each(['SUSPENDED', 'BLOCKED'])('%s agent response retains the account error and refuses navigation', (status) => {
    page()
    act(() => mocks.callbacks.get('agent')!.onCompleted({ agents: { agentLogin: {
      agent: { id: 'agent-1', status }, token: 'agent-token', permissions: [],
    } } }))
    assert.ok(screen.getByRole('alert'))
    assert.equal(mocks.navigate.mock.calls.length, 0)
    assert.equal(mocks.toast.mock.calls[0][0].duration, 5000)
    assert.equal(mocks.toast.mock.calls[0][0].title, status === 'SUSPENDED' ? 'Account Suspended' : 'Account Blocked')
  })

  test('invalid credentials announce the server error and busy submissions are suppressed', () => {
    mocks.adminLoading = true
    page()
    const button = screen.getByRole('button', { name: 'Signing in...' })
    assert.equal(button.getAttribute('aria-disabled'), 'true')
    fireEvent.click(button)
    assert.equal(mocks.adminMutation.mock.calls.length, 0)
    act(() => mocks.callbacks.get('admin')!.onError(new Error('Invalid credentials')))
    assert.ok(screen.getByRole('alert').textContent?.includes('Invalid credentials'))
  })
})

/* SYS-08: after Reset Password the server lets the admin's session do nothing but change the password. The sign-in
   page asks for it before the shell, which otherwise showed "Password change required" on every request. */
describe('sign-in with Reset Password pending', () => {
  const resetLogin = (extra: Record<string, unknown> = {}) => ({ login: {
    user: { id: '648', name: 'Finance' }, roles: ['Finance Manager'], permissions: [], token: 'reset-token',
    tenant: 'grandwinn-com', requirePasswordReset: true, ...extra,
  } })

  test('the sign-in asks for requirePasswordReset', () => {
    page()
    const operation = mocks.documents.get('admin')?.definitions.find((definition) => definition.kind === 'OperationDefinition')
    const login = operation?.kind === 'OperationDefinition' ? operation.selectionSet.selections[0] : undefined
    const fields = login?.kind === 'Field' ? login.selectionSet?.selections.map((s) => (s.kind === 'Field' ? s.name.value : '')) : []
    assert.ok(fields?.includes('requirePasswordReset'), 'LOGIN_MUTATION does not request requirePasswordReset')
  })

  test('opens the password change with the sign-in token, and neither signs in nor enters the shell', () => {
    page()
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'old-secret' } })
    act(() => mocks.callbacks.get('admin')!.onCompleted(resetLogin()))

    const prompt = screen.getByRole('dialog', { name: 'Change Password' })
    assert.equal(prompt.getAttribute('data-token'), 'reset-token')
    assert.equal(prompt.getAttribute('data-open'), 'true')
    assert.equal(mocks.login.mock.calls.length, 0, 'the session was kept')
    assert.equal(mocks.navigate.mock.calls.length, 0, 'the shell was entered')
    // The change goes out for this admin's whitelabel, and the typed password is not left in the form.
    assert.deepEqual(mocks.tenant.mock.calls[0], ['grandwinn-com', true])
    assert.equal(localStorage.getItem('X_WHITELABEL_ID'), 'grandwinn-com')
    assert.equal((screen.getByLabelText(/^Password/) as HTMLInputElement).value, '')
  })

  test('a session still kept in this browser is ended first, so its token is not the one sent', () => {
    mocks.session = { token: 'someone-elses-token', agent: null }
    mocks.logout.mockImplementation(() => { localStorage.clear() })
    page()
    act(() => mocks.callbacks.get('admin')!.onCompleted(resetLogin()))
    assert.equal(mocks.logout.mock.calls.length, 1)
    assert.equal(localStorage.getItem('TENANT'), 'grandwinn-com', 'the tenant is stored after the old session is cleared')
  })

  test('once changed, the form asks for a sign-in with the new password', () => {
    page()
    act(() => mocks.callbacks.get('admin')!.onCompleted(resetLogin()))
    fireEvent.click(screen.getByRole('button', { name: 'Stub: password changed' }))

    assert.equal(screen.queryByRole('dialog', { name: 'Change Password' }), null)
    assert.ok(screen.getByRole('status').textContent?.includes('Password changed. Sign in with your new password.'))
    assert.equal(screen.queryByRole('alert'), null)
    assert.equal(mocks.login.mock.calls.length, 0)
    assert.equal(mocks.navigate.mock.calls.length, 0)
  })

  test('cancelled, the form says a new password is required', () => {
    page()
    act(() => mocks.callbacks.get('admin')!.onCompleted(resetLogin()))
    fireEvent.click(screen.getByRole('button', { name: 'Stub: cancel' }))

    assert.equal(screen.queryByRole('dialog', { name: 'Change Password' }), null)
    assert.ok(screen.getByRole('alert').textContent?.includes('You must choose a new password before you can continue.'))
    assert.equal(mocks.login.mock.calls.length, 0)
    assert.equal(mocks.navigate.mock.calls.length, 0)
  })

  test('requirePasswordReset false signs in as before', () => {
    page()
    act(() => mocks.callbacks.get('admin')!.onCompleted(resetLogin({ requirePasswordReset: false })))
    assert.equal(mocks.login.mock.calls.length, 1)
    assert.equal(screen.queryByRole('dialog', { name: 'Change Password' }), null)
    assert.equal(mocks.navigate.mock.calls.length, 1)
  })
})

/* N003 (SCO-08 follow-up): a forced session end (a suspended agent, a deleted or deactivated admin) toasted "Session
   ended" and reloaded this page, and the reload dropped the toast: the sign-in page gave no reason. The error link
   records the reason for this tab (api.test.ts checks that half); this page shows it once. */
describe('the reason for a forced sign-out', () => {
  const KEY = 'gw-admin-sign-out-reason'
  beforeEach(() => { sessionStorage.clear() })

  test('is shown on the sign-in page, then forgotten', () => {
    rememberSignOutReason('session-ended')
    const first = page()
    const shown = screen.getByRole('status')
    assert.ok(shown.textContent?.includes('Session ended'), shown.textContent ?? '')
    assert.ok(shown.textContent?.includes('Please sign in again.'), shown.textContent ?? '')
    assert.equal(screen.queryByRole('alert'), null, 'a reason, not an error')
    assert.equal(sessionStorage.getItem(KEY), null, 'cleared once shown')
    first.unmount()

    page()
    assert.equal(screen.queryByRole('status'), null, 'a later visit does not repeat it')
  })

  test('a token that ran out is named as such (B009: the session guard\'s sign-out)', () => {
    rememberSignOutReason('session-expired')
    page()
    const shown = screen.getByRole('status')
    assert.ok(shown.textContent?.includes('Session expired'), shown.textContent ?? '')
    assert.ok(shown.textContent?.includes('Your session has expired'), shown.textContent ?? '')
    assert.ok(shown.textContent?.includes('Please sign in again.'), shown.textContent ?? '')
    assert.equal(sessionStorage.getItem(KEY), null, 'cleared once shown')
  })

  test('goes away with the next sign-in attempt', async () => {
    rememberSignOutReason('session-ended')
    page()
    assert.ok(screen.getByRole('status'))
    submit('admin@example.test')
    await waitFor(() => assert.equal(mocks.adminMutation.mock.calls.length, 1))
    assert.equal(screen.queryByRole('status'), null)
  })

  test('is not shown without one, nor from an old or unreadable record', () => {
    page()
    assert.equal(screen.queryByRole('status'), null, 'an ordinary visit says nothing')
    cleanup()

    rememberSignOutReason('session-ended', Date.now() - 10 * 60_000)
    page()
    assert.equal(screen.queryByRole('status'), null, 'a sign-out whose page never came, minutes ago')
    assert.equal(sessionStorage.getItem(KEY), null)
    cleanup()

    sessionStorage.setItem(KEY, '{not json')
    page()
    assert.equal(screen.queryByRole('status'), null)
  })
})
