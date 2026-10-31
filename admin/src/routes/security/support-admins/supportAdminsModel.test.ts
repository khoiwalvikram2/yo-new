import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { Role } from '@/state/rbacStore'
import {
  DELETE_CONFIRM,
  EMPTY_CREATE_ADMIN,
  EMPTY_IP,
  EXPORT_FILENAME,
  EXPORT_SHEET,
  REMOVE_IP_CONFIRM,
  activityTone,
  addIpVariables,
  adminCountLabel,
  adminStatus,
  auditDetails,
  availableRoles,
  clampPage,
  createAdminIssues,
  createAdminSchema,
  createAdminVariables,
  deactivateVariables,
  deleteVariables,
  effectivePermissions,
  exportTitle,
  filterAdmins,
  forceLogoutVariables,
  formatAction,
  ipIssues,
  ipSchema,
  isActiveAdmin,
  isValidEmail,
  latestActivityByAdmin,
  pageOfAdmins,
  permissionCountLabel,
  reactivateVariables,
  resetPasswordVariables,
  resourceIdLabel,
  roleOptions,
  roleVariables,
  shortAdminId,
  supportAdminExportColumns,
  timeAgo,
  timelineTone,
  visibleAdmins,
  type AdminUser,
  type AuditEvent,
  type CreateAdminValues,
  type IpValues,
} from './supportAdminsModel'

const VIEW: Role = {
  id: 'role-view',
  name: 'Viewer',
  tenant: null,
  permissions: [{ domain: 'payments', actions: ['view', 'export'] }],
  updatedAt: '2026-10-01T00:00:00.000Z',
}
const OPS: Role = {
  id: 'role-ops',
  name: 'Operations',
  tenant: 'tenant-1',
  permissions: [
    { domain: 'payments', actions: ['view', 'approve'] },
    { domain: 'users', actions: ['view'] },
  ],
  updatedAt: '2026-10-02T00:00:00.000Z',
}

function admin(id: string, name: string, email: string | null, roles: Role[], status?: AdminUser['status']): AdminUser {
  return { id, name, email, roles, status, createdAt: '2026-09-30T10:20:00.000Z' }
}

const SELF = admin('current-user', 'Current Admin', 'self@example.test', [VIEW], 'ACTIVE')
const ASHA = admin('admin-asha-123456', 'Asha Menon', 'asha@example.test', [OPS], 'ACTIVE')
const RAVI = admin('admin-ravi-123456', 'Ravi Kumar', null, [], 'INACTIVE')

function event(id: string, actorId: string | null, timestamp: string, action = 'role_assigned'): AuditEvent {
  return {
    id,
    actorId,
    timestamp,
    action,
    domain: 'security.roles',
    resourceType: 'Role',
    resourceId: 'resource-1234567890',
  }
}

async function zodErrors<T>(schema: { safeParseAsync: (value: T) => Promise<{ success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }> }, value: T) {
  const result = await schema.safeParseAsync(value)
  if (result.success) return {}
  return Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]))
}

describe('support admin list model', () => {
  test('hides the signed-in admin and filters by trimmed name, email or role without changing source order', () => {
    const visible = visibleAdmins([SELF, ASHA, RAVI], SELF.id)
    assert.deepEqual(visible, [ASHA, RAVI])
    assert.deepEqual(filterAdmins(visible, ''), [ASHA, RAVI])
    assert.deepEqual(filterAdmins(visible, ' ASHA '), [ASHA])
    assert.deepEqual(filterAdmins(visible, 'example.test'), [ASHA])
    assert.deepEqual(filterAdmins(visible, 'opera'), [ASHA])
    assert.deepEqual(filterAdmins(visible, 'missing'), [])
  })

  test('clamps pages and slices from that clamped page', () => {
    const rows = Array.from({ length: 23 }, (_, index) => index + 1)
    assert.equal(clampPage(0, rows.length, 10), 1)
    assert.equal(clampPage(99, rows.length, 10), 3)
    assert.equal(clampPage(Number.NaN, rows.length, 10), 1)
    assert.equal(clampPage(3, 0, 10), 1)
    assert.deepEqual(pageOfAdmins(rows, 1, 10), rows.slice(0, 10))
    assert.deepEqual(pageOfAdmins(rows, 99, 10), [21, 22, 23])
  })

  test('keeps the count, status and short-id copy', () => {
    assert.equal(adminCountLabel(0), '0 admins')
    assert.equal(adminCountLabel(1), '1 admin')
    assert.equal(adminCountLabel(2), '2 admins')
    assert.equal(isActiveAdmin(ASHA), true)
    assert.equal(isActiveAdmin({}), true)
    assert.equal(isActiveAdmin(RAVI), false)
    assert.deepEqual(adminStatus(ASHA), { label: 'Active', tone: 'ok' })
    assert.deepEqual(adminStatus(RAVI), { label: 'Inactive', tone: 'neutral' })
    assert.deepEqual(adminStatus({ status: 'SUSPENDED' }), { label: 'Suspended', tone: 'neg' })
    assert.equal(shortAdminId(ASHA.id), 'admin-as...')
  })
})

describe('activity model', () => {
  test('keeps only each visible admin most recent event', () => {
    const old = event('old', ASHA.id, '2026-10-01T10:00:00.000Z')
    const recent = event('recent', ASHA.id, '2026-10-02T10:00:00.000Z', 'user_deactivated')
    const hidden = event('hidden', SELF.id, '2026-10-03T10:00:00.000Z')
    const map = latestActivityByAdmin([old, hidden, recent], [ASHA, RAVI])
    assert.equal(map.size, 1)
    assert.equal(map.get(ASHA.id), recent)
  })

  test('formats action labels, tones and relative time with the legacy boundaries', () => {
    assert.equal(formatAction('role_assigned'), 'Role Assigned')
    assert.equal(activityTone('user_created'), 'ok')
    assert.equal(activityTone('role_revoked'), 'neg')
    assert.equal(activityTone('user_viewed'), 'info')
    assert.equal(timelineTone('role_created'), 'ok')
    assert.equal(timelineTone('role_revoked'), 'neg')
    assert.equal(timelineTone('user_reactivated'), 'info')
    const now = new Date('2026-10-07T12:00:00.000Z')
    assert.equal(timeAgo('2026-10-07T11:59:40.000Z', now), 'Just now')
    assert.equal(timeAgo('2026-10-07T11:55:00.000Z', now), '5m ago')
    assert.equal(timeAgo('2026-10-07T09:00:00.000Z', now), '3h ago')
    assert.equal(timeAgo('2026-10-05T12:00:00.000Z', now), '2d ago')
  })

  test('builds the resource and before/after previews', () => {
    assert.equal(resourceIdLabel('abcdefghijklmnop'), 'ID: abcdefghijkl...')
    assert.equal(resourceIdLabel(null), 'ID: null...')
    assert.equal(auditDetails({}), null)
    assert.equal(auditDetails({ before: {}, after: [] }), null)
    assert.deepEqual(auditDetails({ before: { active: false }, after: { active: true } }), {
      before: '{"active":false}...',
      after: '{"active":true}...',
    })
  })
})

describe('roles, actions and export', () => {
  test('deduplicates effective domain actions and finds available roles', () => {
    assert.deepEqual(effectivePermissions([VIEW, OPS]), [
      { domain: 'payments', label: 'payments: 3 actions' },
      { domain: 'users', label: 'users: 1 action' },
    ])
    assert.equal(permissionCountLabel(OPS), '3 permissions')
    assert.deepEqual(availableRoles([VIEW, OPS], [OPS]), [VIEW])
    assert.deepEqual(roleOptions([VIEW, OPS]), [
      { value: VIEW.id, label: VIEW.name },
      { value: OPS.id, label: OPS.name },
    ])
    assert.deepEqual(roleVariables(ASHA.id, OPS.id), { input: { userId: ASHA.id, roleId: OPS.id } })
  })

  test('keeps exact mutation variables and confirmation copy', () => {
    assert.deepEqual(deactivateVariables(ASHA), { id: ASHA.id, status: 'INACTIVE' })
    assert.deepEqual(reactivateVariables(RAVI), { id: RAVI.id, status: 'ACTIVE' })
    assert.deepEqual(forceLogoutVariables(ASHA), { id: ASHA.id })
    assert.deepEqual(resetPasswordVariables(ASHA), { id: ASHA.id, require: true })
    assert.deepEqual(deleteVariables(ASHA), { id: ASHA.id })
    assert.deepEqual(DELETE_CONFIRM, {
      title: 'Delete Support Admin',
      warning: 'This action cannot be undone. All associated data including roles will be permanently deleted.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    assert.deepEqual(REMOVE_IP_CONFIRM, {
      title: 'Remove this IP from allowlist?',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
  })

  test('keeps export metadata, columns and current filtered rows', () => {
    const columns = supportAdminExportColumns((value) => `date:${value}`)
    assert.equal(EXPORT_FILENAME, 'Support-Admins')
    assert.equal(EXPORT_SHEET, 'Support Admins')
    assert.equal(exportTitle(2), 'Support Admins — 2 admin(s)')
    assert.deepEqual(columns.map((column) => [column.header, column.key, column.width]), [
      ['Name', 'name', 22],
      ['Email', 'email', 28],
      ['Status', 'status', 12],
      ['Roles', 'roles', 24],
      ['Created', 'createdAt', 20],
    ])
    assert.deepEqual(columns.map((column) => column.getter(RAVI)), [
      'Ravi Kumar', '', 'INACTIVE', '', `date:${RAVI.createdAt}`,
    ])
  })
})

describe('create and IP forms', () => {
  const valid: CreateAdminValues = {
    name: 'Asha Menon',
    email: 'asha@example.test',
    password: 'secret1',
    phone: ' +91 99999 ',
    roleIds: [VIEW.id],
  }

  test('applies every legacy create rule and accepts unicode password characters by code point', async () => {
    assert.deepEqual(EMPTY_CREATE_ADMIN, { name: '', email: '', password: '', phone: '', roleIds: [] })
    assert.deepEqual(createAdminIssues(valid), [])
    assert.deepEqual(createAdminIssues({ ...valid, name: '', email: '', password: '', roleIds: [] }), [
      { path: 'name', message: 'Please enter name' },
      { path: 'email', message: 'Please enter email' },
      { path: 'password', message: 'Please enter password' },
      { path: 'roleIds', message: 'Please select at least one role' },
    ])
    assert.deepEqual(createAdminIssues({ ...valid, email: 'bad', password: '12345' }), [
      { path: 'email', message: 'Enter a valid email' },
      { path: 'password', message: 'Minimum 6 characters' },
    ])
    assert.equal(isValidEmail('name@example.com'), true)
    assert.equal(isValidEmail('bad@localhost'), false)
    assert.deepEqual(await zodErrors(createAdminSchema, valid), {})
    assert.deepEqual(await zodErrors(createAdminSchema, { ...valid, email: 'bad' }), { email: 'Enter a valid email' })
  })

  test('builds CreateSupportAdmin variables in legacy key order and trims only phone', () => {
    const variables = createAdminVariables(valid)
    assert.deepEqual(variables, {
      input: {
        name: 'Asha Menon',
        email: 'asha@example.test',
        password: 'secret1',
        phone: '+91 99999',
        roleIds: [VIEW.id],
      },
    })
    assert.deepEqual(Object.keys(variables.input), ['name', 'email', 'password', 'phone', 'roleIds'])
    assert.equal(createAdminVariables({ ...valid, phone: '  ' }).input.phone, undefined)
  })

  test('keeps the legacy IPv4/CIDR validation and exact AddIp variables', async () => {
    assert.deepEqual(EMPTY_IP, { cidr: '' })
    assert.deepEqual(ipIssues({ cidr: '' }), [{ path: 'cidr', message: 'Please enter IP address or CIDR' }])
    assert.deepEqual(ipIssues({ cidr: 'bad' }), [{
      path: 'cidr',
      message: 'Invalid IP address or CIDR format (e.g., 192.168.1.1 or 192.168.1.0/24)',
    }])
    assert.deepEqual(ipIssues({ cidr: '192.168.1.0/24' }), [])
    assert.deepEqual(await zodErrors<IpValues>(ipSchema, { cidr: '10.0.0.1' }), {})
    assert.deepEqual(addIpVariables(ASHA.id, { cidr: '10.0.0.1' }), { userId: ASHA.id, cidr: '10.0.0.1' })
  })
})
