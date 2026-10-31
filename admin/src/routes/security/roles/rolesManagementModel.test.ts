import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import type { GraphQLRole } from './types'
import {
  ACCESS_DENIED,
  DEFAULT_PAGE_SIZE,
  MODAL_CONFIRM,
  PAGE_SIZE_OPTIONS,
  ROW_CONFIRM,
  activeFilterCount,
  clampPage,
  exportTitle,
  filterRoles,
  isShownUpdatedAt,
  pageSlice,
  permissionCount,
  roleCountLabel,
  roleEditPath,
  roleExportColumns,
  roleStats,
  uniqueDomains,
  visibleDomains,
  visiblePermissions,
} from './rolesManagementModel'

function role(id: string, name = `Role ${id}`, permissions: GraphQLRole['permissions'] = []): GraphQLRole {
  return { id, name, tenant: null, permissions, updatedAt: '2026-09-22T10:15:00.000Z' }
}

const ADMIN = role('admin', 'Operations Admin', [
  { domain: 'users', actions: ['read', 'write'] },
  { domain: 'payments', actions: ['read', 'approve'] },
  { domain: 'users', actions: ['delete'] },
])
const AUDITOR = role('auditor', 'Risk Auditor', [
  { domain: 'audit', actions: ['read', 'export'] },
])

describe('rolesManagementModel', () => {
  test('keeps the legacy page sizes and security copy', () => {
    assert.equal(DEFAULT_PAGE_SIZE, 10)
    assert.deepEqual(PAGE_SIZE_OPTIONS, [10, 20, 50, 100])
    assert.deepEqual(ACCESS_DENIED, {
      title: 'Access Denied',
      text: "You don't have permission to view roles. Please contact your administrator.",
      requirementLead: 'Required permission:',
      requirement: 'roles:read',
    })
  })

  test('searches role names, permission domains and actions case-insensitively', () => {
    const roles = [ADMIN, AUDITOR]
    assert.deepEqual(filterRoles(roles, ''), roles)
    assert.deepEqual(filterRoles(roles, '  operations '), [ADMIN])
    assert.deepEqual(filterRoles(roles, 'PAYMENTS'), [ADMIN])
    assert.deepEqual(filterRoles(roles, 'export'), [AUDITOR])
    assert.deepEqual(filterRoles(roles, 'missing'), [])
    assert.equal(activeFilterCount(''), 0)
    assert.equal(activeFilterCount('   '), 1)
  })

  test('clamps a page after filtering and slices without mutating rows', () => {
    const rows = Array.from({ length: 23 }, (_, index) => index + 1)
    assert.equal(clampPage(3, 12, 10), 2)
    assert.equal(clampPage(-5, 12, 10), 1)
    assert.equal(clampPage(Number.NaN, 0, 0), 1)
    assert.deepEqual(pageSlice(rows, 3, 10), [21, 22, 23])
    assert.equal(rows.length, 23)
  })

  test('counts actions, de-duplicates domains and limits table detail', () => {
    assert.equal(permissionCount(ADMIN), 5)
    assert.deepEqual(uniqueDomains(ADMIN), ['users', 'payments'])
    assert.deepEqual(visiblePermissions(ADMIN), { shown: ADMIN.permissions, more: 0 })
    assert.deepEqual(visibleDomains(['a', 'b', 'c', 'd', 'e']), {
      shown: ['a', 'b', 'c', 'd'],
      more: 1,
    })
    const longRole = role('long', 'Long', [...ADMIN.permissions, ...AUDITOR.permissions])
    assert.equal(visiblePermissions(longRole).more, 1)
  })

  test('derives all four statistics and a rounded average', () => {
    assert.deepEqual(roleStats([ADMIN, AUDITOR]), {
      totalRoles: 2,
      totalPermissions: 7,
      activeRoles: 2,
      domains: 3,
      avgPermissionsPerRole: 4,
    })
    assert.deepEqual(roleStats([]), {
      totalRoles: 0,
      totalPermissions: 0,
      activeRoles: 0,
      domains: 0,
      avgPermissionsPerRole: 0,
    })
  })

  test('shows only readable dates in the legacy year range', () => {
    assert.equal(isShownUpdatedAt('2026-09-22T10:15:00.000Z'), true)
    assert.equal(isShownUpdatedAt('1998-12-31T23:59:59.000Z'), false)
    assert.equal(isShownUpdatedAt('2101-01-01T00:00:00.000Z'), false)
    assert.equal(isShownUpdatedAt('not-a-date'), false)
    assert.equal(isShownUpdatedAt(null), false)
  })

  test('builds the unchanged export columns over the displayed rows', () => {
    const columns = roleExportColumns((value) => `date:${value}`)
    assert.deepEqual(columns.map((column) => column.header), [
      'Role',
      'Permissions Count',
      'Domains',
      'Updated',
    ])
    assert.deepEqual(columns.map((column) => column.getter?.(ADMIN)), [
      'Operations Admin',
      5,
      'users, payments',
      'date:2026-09-22T10:15:00.000Z',
    ])
    assert.equal(exportTitle(2), 'Roles — 2 role(s)')
  })

  test('keeps role labels, edit routing and both delete confirmation stages', () => {
    assert.equal(roleCountLabel(1), '1 role')
    assert.equal(roleCountLabel(3), '3 roles')
    assert.equal(roleEditPath('role/one'), '/security/roles/role/one/edit')
    assert.deepEqual(ROW_CONFIRM, {
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      lead: 'Are you sure you want to delete',
      note: 'This action cannot be undone.',
    })
    assert.deepEqual(MODAL_CONFIRM, {
      confirmLabel: 'Yes, Delete',
      cancelLabel: 'Cancel',
      lead: 'Are you sure you want to delete the role',
      note: 'This action cannot be undone. Users with this role will lose their assigned permissions.',
    })
  })
})
