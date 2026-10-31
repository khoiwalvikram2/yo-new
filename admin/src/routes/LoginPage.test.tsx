import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { DocumentNode } from 'graphql'
import LoginPage from './LoginPage'

type LoginCallbacks = { onCompleted: (data: unknown) => void; onError: (error: Error) => void }
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), login: vi.fn(), agentLogin: vi.fn(), hydrated: vi.fn(), tenant: vi.fn(), toast: vi.fn(),
  adminMutation: vi.fn(), agentMutation: vi.fn(), adminLoading: false, agentLoading: false,
  callbacks: new Map<string, LoginCallbacks>(), from: undefined as undefined | { from: { pathname: string } },
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
    return [agent ? mocks.agentMutation : mocks.adminMutation,
      { loading: agent ? mocks.agentLoading : mocks.adminLoading }]
  },
}))
vi.mock('@/shared/core/authStore', () => ({ useAuthStore: { getState: () => ({
  login: mocks.login, agentLogin: mocks.agentLogin, setHasHydrated: mocks.hydrated, ...mocks.session,
}) } }))
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: { getState: () => ({ setTenant: mocks.tenant }) } }))
vi.mock('@/ui/components/toast', () => ({ toast: mocks.toast }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.callbacks.clear()
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
