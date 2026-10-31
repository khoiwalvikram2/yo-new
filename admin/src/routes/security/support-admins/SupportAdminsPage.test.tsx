import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { DocumentNode } from 'graphql'
import {
  ADD_IP_TO_ALLOWLIST,
  ADMIN_ROLES,
  ASSIGN_ROLE_TO_ADMIN,
  CREATE_SUPPORT_ADMIN,
  IP_ALLOWLIST,
  REMOVE_IP_FROM_ALLOWLIST,
  REVOKE_ROLE_FROM_ADMIN,
  ROLES,
  SUPPORT_ADMINS,
} from '@/lib/graphql/rbac'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import type { Role } from '@/state/rbacStore'
import {
  AUDIT_QUERY,
  ADMIN_ACTIVITY_PAGE,
  DELETE_USER,
  FORCE_LOGOUT,
  SET_REQUIRE_PASSWORD_RESET,
  SET_USER_STATUS,
} from './supportAdminsOperations'
import type { AdminUser, AuditEvent } from './supportAdminsModel'
import SupportAdminsPage from './SupportAdminsPage'

interface QueryOptions { variables?: Record<string, unknown>; skip?: boolean }
interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: string
  onConfirm?: () => void | Promise<void>
}

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  guardCalls: [] as Array<{ required: unknown; requireAny?: boolean }>,
  allowed: new Set<string>(),
  currentUserId: 'current-user',
  online: new Set<string>(),
  exportOptions: [] as Array<Record<string, unknown>>,
  handleExport: vi.fn(),
  confirm: vi.fn(),
  mutationCalls: new Map<string, Array<Record<string, unknown>>>(),
  refetch: vi.fn(async () => undefined),
  refetchRoles: vi.fn(async () => undefined),
  refetchIp: vi.fn(async () => undefined),
  supportData: undefined as { supportAdmins: AdminUser[] } | undefined,
  rolesData: undefined as { roles: Role[] } | undefined,
  assignedData: undefined as { adminRoles: Role[] } | undefined,
  auditData: undefined as { audit: AuditEvent[] } | undefined,
  recentData: undefined as { audit: AuditEvent[] } | undefined,
  ipData: undefined as { ipAllowlist: Array<{ id: string; cidr: string; createdAt: string }> } | undefined,
  supportLoading: false,
  supportError: undefined as Error | undefined,
}))

vi.mock('@apollo/client', async () => {
  const actual = await vi.importActual<typeof import('@apollo/client')>('@apollo/client')
  return { ...actual, useQuery: mocks.useQuery, useMutation: mocks.useMutation }
})

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, requireAny, children }: { required: unknown; requireAny?: boolean; children: ReactNode }) => {
    mocks.guardCalls.push({ required, requireAny })
    return <>{children}</>
  },
}))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { permissions: string[]; user: { id: string } }) => unknown) => selector({
    permissions: [],
    user: { id: mocks.currentUserId },
  }),
}))

vi.mock('@/shared/core/nestedPermissionMapping', () => ({
  hasPermissionWithNested: (_permissions: unknown, domain: string, action: string) => mocks.allowed.has(`${domain}:${action}`),
}))

vi.mock('@/shared/hooks/usePresence', () => ({ usePresence: vi.fn() }))
vi.mock('@/state/presenceStore', () => ({
  usePresenceStore: (selector: (state: { onlineAdminIds: Set<string> }) => unknown) => selector({ onlineAdminIds: mocks.online }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDate: (value: string, pattern?: string) => `${pattern ?? 'date'}:${value.slice(0, 10)}`,
    formatTime: (value: string, pattern?: string) => `${pattern ?? 'time'}:${value.slice(11, 16)}`,
    formatDateTime: (value: string) => `datetime:${value}`,
  }),
}))

vi.mock('@/shared/hooks/useTableExport', () => ({
  useTableExport: (options: Record<string, unknown>) => {
    mocks.exportOptions.push(options)
    return { exporting: false, handleExport: mocks.handleExport }
  },
}))

vi.mock('@/ui/components/confirm', () => ({ confirm: mocks.confirm }))

const VIEW: Role = {
  id: 'role-view',
  name: 'Viewer',
  tenant: null,
  permissions: [{ domain: 'users', actions: ['view'] }],
  updatedAt: '2026-10-01T00:00:00.000Z',
}
const OPS: Role = {
  id: 'role-ops',
  name: 'Operations',
  tenant: null,
  permissions: [{ domain: 'payments', actions: ['view', 'approve'] }],
  updatedAt: '2026-10-01T00:00:00.000Z',
}

const SELF: AdminUser = {
  id: 'current-user', name: 'Current User', email: 'self@example.test', status: 'ACTIVE', roles: [VIEW], createdAt: '2026-09-01T08:00:00.000Z',
}
const ASHA: AdminUser = {
  id: 'admin-asha-123456', name: 'Asha Menon', email: 'asha@example.test', status: 'ACTIVE', roles: [OPS], createdAt: '2026-09-20T10:20:00.000Z',
}
const RAVI: AdminUser = {
  id: 'admin-ravi-123456', name: 'Ravi Kumar', email: null, status: 'INACTIVE', roles: [], createdAt: '2026-09-21T11:30:00.000Z',
}
const RECENT: AuditEvent = {
  id: 'event-recent', actorId: ASHA.id, domain: 'security.roles', action: 'role_assigned', resourceType: 'Role',
  resourceId: 'resource-1234567890', timestamp: new Date().toISOString(), before: {}, after: { role: OPS.id },
}

function mutationName(document: DocumentNode): string {
  if (document === CREATE_SUPPORT_ADMIN) return 'create'
  if (document === ASSIGN_ROLE_TO_ADMIN) return 'assign'
  if (document === REVOKE_ROLE_FROM_ADMIN) return 'revoke'
  if (document === SET_USER_STATUS) return 'status'
  if (document === FORCE_LOGOUT) return 'logout'
  if (document === SET_REQUIRE_PASSWORD_RESET) return 'reset'
  if (document === DELETE_USER) return 'delete'
  if (document === ADD_IP_TO_ALLOWLIST) return 'addIp'
  if (document === REMOVE_IP_FROM_ALLOWLIST) return 'removeIp'
  throw new Error('Unexpected mutation')
}

function mutationReply(name: string) {
  const field = ({
    create: 'createSupportAdmin', assign: 'assignRoleToAdmin', revoke: 'revokeRoleFromAdmin', status: 'setUserStatus',
    logout: 'forceLogoutUser', reset: 'setRequirePasswordReset', delete: 'deleteSupportAdmin',
    addIp: 'addIpToAllowlist', removeIp: 'removeIpFromAllowlist',
  } as Record<string, string>)[name]
  return { data: { [field]: { success: true, message: 'ok' } } }
}

function sent(name: string) {
  return mocks.mutationCalls.get(name) ?? []
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PageEyebrowProvider value="System">
        <SupportAdminsPage />
      </PageEyebrowProvider>
    </MemoryRouter>,
  )
}

async function openMore(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }))
  await screen.findByRole('menu')
}

beforeEach(() => {
  mocks.guardCalls.length = 0
  mocks.allowed = new Set([
    'security.support-admins:view',
    'security.support-admins:create',
    'security.roles:assign',
  ])
  mocks.currentUserId = SELF.id
  mocks.online = new Set([ASHA.id])
  mocks.exportOptions.length = 0
  mocks.handleExport.mockReset()
  mocks.confirm.mockReset().mockResolvedValue(false)
  mocks.mutationCalls.clear()
  mocks.refetch.mockClear()
  mocks.refetchRoles.mockClear()
  mocks.refetchIp.mockClear()
  mocks.supportData = { supportAdmins: [SELF, ASHA, RAVI] }
  mocks.rolesData = { roles: [OPS, VIEW] }
  mocks.assignedData = { adminRoles: [OPS] }
  mocks.auditData = { audit: [RECENT] }
  mocks.recentData = { audit: [RECENT] }
  mocks.ipData = { ipAllowlist: [{ id: 'ip-1', cidr: '10.0.0.1', createdAt: '2026-10-01T10:00:00.000Z' }] }
  mocks.supportLoading = false
  mocks.supportError = undefined

  mocks.useQuery.mockReset().mockImplementation((document: DocumentNode, options: QueryOptions = {}) => {
    if (document === SUPPORT_ADMINS) {
      return { data: mocks.supportData, loading: mocks.supportLoading, error: mocks.supportError, refetch: mocks.refetch }
    }
    if (document === ROLES) return { data: mocks.rolesData, loading: false }
    if (document === ADMIN_ROLES) return { data: mocks.assignedData, loading: false, refetch: mocks.refetchRoles }
    if (document === IP_ALLOWLIST) return { data: mocks.ipData, loading: false, refetch: mocks.refetchIp }
    if (document === ADMIN_ACTIVITY_PAGE) return { data: { auditEvents: { items: mocks.auditData?.audit ?? [], total: mocks.auditData?.audit.length ?? 0 } }, loading: false }
    if (document === AUDIT_QUERY) {
      return options.variables?.actor
        ? { data: mocks.auditData, loading: false }
        : { data: mocks.recentData, loading: false }
    }
    throw new Error('Unexpected query')
  })
  mocks.useMutation.mockReset().mockImplementation((document: DocumentNode) => {
    const name = mutationName(document)
    const run = vi.fn(async ({ variables }: { variables: Record<string, unknown> }) => {
      const calls = mocks.mutationCalls.get(name) ?? []
      calls.push(variables)
      mocks.mutationCalls.set(name, calls)
      return mutationReply(name)
    })
    return [run, { loading: false }]
  })
})

describe('/security/support-admins', () => {
  test('renders the kit list, presence, activity, paging/export contract and client search; excludes self', async () => {
    renderPage()
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Support Admins' }))
    assert.ok(screen.queryByText('System') === null)
    assert.ok(screen.getByText('Asha Menon'))
    assert.ok(screen.getByText('Ravi Kumar'))
    assert.ok(screen.queryByText('Current User') === null)
    assert.ok(screen.getByText('Online'))
    assert.ok(screen.getByText('Role Assigned'))
    assert.ok(screen.getByText('2 admins'))
    assert.deepEqual(mocks.guardCalls[0], {
      required: [{ domain: 'security.support-admins', actions: ['view'] }],
      requireAny: undefined,
    })

    const exported = mocks.exportOptions.at(-1)
    assert.ok(exported)
    assert.equal(exported.filename, 'Support-Admins')
    assert.equal(exported.sheetName, 'Support Admins')
    assert.equal(exported.title, 'Support Admins — 2 admin(s)')
    assert.equal((exported.data as AdminUser[]).length, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    assert.equal(mocks.handleExport.mock.calls.length, 1)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search support admins' }), { target: { value: 'viewer' } })
    assert.ok(screen.queryByText('Asha Menon') === null)
    assert.ok(screen.queryByText('Ravi Kumar') === null)
    assert.ok(screen.getByText('No support admins found'))
  })

  test('keeps the inner OR permission state and hides create without both write and assign', () => {
    mocks.allowed = new Set()
    renderPage()
    assert.ok(screen.getByText('Access Denied'))
    assert.ok(screen.getByText('roles:read'))
    const supportCall = mocks.useQuery.mock.calls.find(([document]) => document === SUPPORT_ADMINS)
    assert.equal((supportCall?.[1] as QueryOptions).skip, true)

    mocks.allowed = new Set(['security.roles:assign'])
    renderPage()
    assert.ok(screen.getAllByRole('heading', { level: 1, name: 'Support Admins' }).length >= 1)
    assert.equal(screen.queryByRole('button', { name: 'Create Support Admin' }), null)
  })

  test('validates and creates with the exact legacy input, then refetches and closes', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Create Support Admin' }))
    const drawer = await screen.findByRole('dialog', { name: 'Create Support Admin' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create' }))
    assert.ok(await within(drawer).findByText('Please enter name'))
    assert.ok(within(drawer).getByText('Please enter email'))
    assert.ok(within(drawer).getByText('Please enter password'))
    assert.ok(within(drawer).getByText('Please select at least one role'))

    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Name' }), { target: { value: 'Neha Rao' } })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Email' }), { target: { value: 'neha@example.test' } })
    const password = drawer.querySelector<HTMLInputElement>('input[name="password"]')
    assert.ok(password)
    fireEvent.change(password, { target: { value: 'secret9' } })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Phone (Optional)' }), { target: { value: ' +91 777 ' } })
    fireEvent.click(within(drawer).getByRole('combobox', { name: 'Roles' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Viewer' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create' }))

    await waitFor(() => assert.equal(sent('create').length, 1))
    assert.deepEqual(sent('create')[0], {
      input: { name: 'Neha Rao', email: 'neha@example.test', password: 'secret9', phone: '+91 777', roleIds: [VIEW.id] },
    })
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Create Support Admin' }), null))
    assert.equal(mocks.refetch.mock.calls.length, 1)
  })

  test('manages roles and shows the selected administrator activity without changing query contracts', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Manage roles for Asha Menon' }))
    const drawer = await screen.findByRole('dialog', { name: 'Manage Roles - Administrator' })
    assert.ok(within(drawer).getByText('payments: 2 actions'))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Assign' }))
    await waitFor(() => assert.deepEqual(sent('assign'), [{ input: { userId: ASHA.id, roleId: VIEW.id } }]))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => assert.deepEqual(sent('revoke'), [{ input: { userId: ASHA.id, roleId: OPS.id } }]))
    assert.equal(mocks.refetchRoles.mock.calls.length, 2)

    fireEvent.click(within(drawer).getByRole('tab', { name: 'Activity' }))
    assert.ok(within(drawer).getByText('Role Assigned'))
    assert.ok(within(drawer).getByText(`datetime:${RECENT.timestamp}`))
    const adminRolesCall = mocks.useQuery.mock.calls.find(([document, options]) => (
      document === ADMIN_ROLES && (options as QueryOptions).variables?.userId === ASHA.id
    ))
    assert.ok(adminRolesCall)
  })

  test('keeps status/logout/reset/delete actions and the destructive confirmation copy', async () => {
    renderPage()
    await openMore('Asha Menon')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }))
    await waitFor(() => assert.deepEqual(sent('status')[0], { id: ASHA.id, status: 'INACTIVE' }))

    await openMore('Ravi Kumar')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivate' }))
    await waitFor(() => assert.deepEqual(sent('status')[1], { id: RAVI.id, status: 'ACTIVE' }))

    await openMore('Asha Menon')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Force Logout' }))
    await waitFor(() => assert.deepEqual(sent('logout'), [{ id: ASHA.id }]))

    await openMore('Asha Menon')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset Password' }))
    await waitFor(() => assert.deepEqual(sent('reset'), [{ id: ASHA.id, require: true }]))

    await openMore('Asha Menon')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    assert.equal(mocks.confirm.mock.calls.length, 1)
    const request = mocks.confirm.mock.calls[0][0] as ConfirmOptions
    assert.equal(request.title, 'Delete Support Admin')
    assert.equal(request.confirmLabel, 'Delete')
    assert.equal(request.cancelLabel, 'Cancel')
    assert.equal(request.tone, 'danger')
    await act(async () => { await request.onConfirm?.() })
    assert.deepEqual(sent('delete'), [{ id: ASHA.id }])
  })

  test('adds and removes IP entries with the exact variables and modal confirmation', async () => {
    renderPage()
    await openMore('Asha Menon')
    fireEvent.click(screen.getByRole('menuitem', { name: 'IP Allowlist' }))
    const drawer = await screen.findByRole('dialog', { name: 'IP Allowlist - Administrator' })
    assert.ok(within(drawer).getByText('10.0.0.1'))
    const field = within(drawer).getByRole('textbox', { name: 'IP Address or CIDR' })
    fireEvent.change(field, { target: { value: '192.168.1.0/24' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add IP' }))
    await waitFor(() => assert.deepEqual(sent('addIp'), [{ userId: ASHA.id, cidr: '192.168.1.0/24' }]))
    assert.equal(mocks.refetchIp.mock.calls.length, 1)
    await waitFor(() => assert.equal((field as HTMLInputElement).value, ''))

    fireEvent.click(within(drawer).getByRole('button', { name: 'Remove' }))
    assert.equal(mocks.confirm.mock.calls.length, 1)
    const request = mocks.confirm.mock.calls[0][0] as ConfirmOptions
    assert.equal(request.title, 'Remove this IP from allowlist?')
    assert.equal(request.confirmLabel, 'Remove')
    assert.equal(request.tone, 'danger')
    await act(async () => { await request.onConfirm?.() })
    assert.deepEqual(sent('removeIp'), [{ id: 'ip-1' }])
    assert.equal(mocks.refetchIp.mock.calls.length, 2)
  })

  test('opens the full activity log and preserves load errors beside available stale rows', async () => {
    mocks.supportError = new Error('Support service unavailable')
    renderPage()
    assert.ok(screen.getByText('Error loading support admins'))
    assert.ok(screen.getByText('Support service unavailable'))
    assert.ok(screen.getByText('Asha Menon'))

    await openMore('Asha Menon')
    fireEvent.click(screen.getByRole('menuitem', { name: 'View All Activity' }))
    const drawer = await screen.findByRole('dialog', { name: 'Activity Log - Administrator' })
    assert.ok(within(drawer).getByText('Role Assigned'))
    assert.ok(within(drawer).getByText('security.roles'))
    assert.ok(within(drawer).getByText('After:', { exact: false }))
    assert.ok(within(drawer).getByText('ID: resource-123...'))
  })
})
