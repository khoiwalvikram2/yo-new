/**
 * Pure logic of /security/roles (W7 Task 190), moved out of RolesManagementPage.tsx, StatsCards.tsx and
 * RolesTable.tsx so it can be tested without React. Every rule here is the legacy one, word for word where
 * it carries copy; the only addition is `clampPage` (a page left past the end by a search now shows the
 * last page instead of an empty table).
 */
import dayjs from 'dayjs'
import type { TableExportColumn } from '@/shared/utils/tableExport'
import type { GraphQLRole } from './types'

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 10

export const PAGE_TITLE = 'Roles & Permissions'
export const PAGE_SUB = 'Manage roles and permissions for admin users'
export const TABLE_TITLE = 'Roles List'
export const SEARCH_PLACEHOLDER = 'Search by role name, permissions, or domains...'

/** The legacy access-denied copy, shown when the caller lacks security.roles:view. */
export const ACCESS_DENIED = {
  title: 'Access Denied',
  text: "You don't have permission to view roles. Please contact your administrator.",
  requirementLead: 'Required permission:',
  requirement: 'roles:read',
} as const

/** The legacy error Alert above the page. */
export const LOAD_ERROR_TITLE = 'Error loading data'
export const LOAD_ERROR_FALLBACK = 'Failed to load roles'

/** The two confirmations a delete passes through (legacy: a Popconfirm on the row, then a Modal). */
export const DELETE_ROLE_TITLE = 'Delete Role'
export const ROW_CONFIRM = {
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  /** "Are you sure you want to delete "<name>"?" — the name is bold in the dialog. */
  lead: 'Are you sure you want to delete',
  note: 'This action cannot be undone.',
} as const
export const MODAL_CONFIRM = {
  confirmLabel: 'Yes, Delete',
  cancelLabel: 'Cancel',
  /** "Are you sure you want to delete the role "<name>"?" — the name is bold in the dialog. */
  lead: 'Are you sure you want to delete the role',
  note: 'This action cannot be undone. Users with this role will lose their assigned permissions.',
} as const

/** The legacy client-side search: role name, then every permission's domain and actions. */
export function filterRoles(roles: readonly GraphQLRole[], searchText: string): GraphQLRole[] {
  return roles.filter((role: GraphQLRole) => {
    if (!searchText.trim()) return true

    const searchLower = searchText.toLowerCase().trim()

    // Search in role name
    if (role?.name?.toLowerCase().includes(searchLower)) {
      return true
    }

    // Search in permissions (domains and actions)
    if (role?.permissions) {
      for (const permission of role.permissions) {
        // Search in domain name
        if (permission.domain?.toLowerCase().includes(searchLower)) {
          return true
        }

        // Search in action names
        if (permission.actions?.some((action) => action.toLowerCase().includes(searchLower))) {
          return true
        }
      }
    }

    return false
  })
}

/** The filter count the legacy badge showed: the raw search text, untrimmed. */
export function activeFilterCount(query: string): number {
  return query ? 1 : 0
}

/** A page left past the end (a search shrank the list) shows the last page that exists. */
export function clampPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

/** The legacy slice: (page - 1) * size up to page * size. */
export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const startIndex = (page - 1) * pageSize
  const endIndex = startIndex + pageSize
  return rows.slice(startIndex, endIndex)
}

/** Every action of every permission, as the table's Permissions cell, the dialog and the export count them. */
export function permissionCount(role: Pick<GraphQLRole, 'permissions'>): number {
  return role.permissions.reduce((sum, p) => sum + p.actions.length, 0)
}

/** The role's domains, first-seen order, without repeats (the Domains cell and the export). */
export function uniqueDomains(role: Pick<GraphQLRole, 'permissions'>): string[] {
  return [...new Set(role.permissions.map((p) => p.domain))]
}

export function plural(count: number, singular: string, many: string): string {
  return count === 1 ? singular : many
}

/** The card's count line: every role the search matched, on every page (the legacy header counted this page only). */
export function roleCountLabel(count: number): string {
  return `${count} ${plural(count, 'role', 'roles')}`
}

type StatsPermission = { domain?: string; actions?: string[] }
export type StatsRole = { permissions?: StatsPermission[] }

export interface RoleStats {
  totalRoles: number
  totalPermissions: number
  activeRoles: number
  domains: number
  avgPermissionsPerRole: number
}

/** The four legacy statistics, over every role the query returned (the search never touches them). */
export function roleStats(roles: readonly StatsRole[]): RoleStats {
  const totalRoles = roles.length
  const totalPermissions = roles.reduce((sum, role) => {
    return sum + (role.permissions?.reduce((pSum, p) => pSum + (p.actions?.length ?? 0), 0) ?? 0)
  }, 0)
  const activeRoles = roles.length
  const domains = new Set(roles.flatMap((role) => role.permissions?.map((p) => p.domain).filter(Boolean) ?? [])).size

  // Calculate average permissions per role
  const avgPermissionsPerRole = totalRoles > 0 ? Math.round(totalPermissions / totalRoles) : 0

  return { totalRoles, totalPermissions, activeRoles, domains, avgPermissionsPerRole }
}

/**
 * Whether the Updated cell prints a date: a value dayjs can read, in a year from 2000 to 2100 (the legacy
 * guard against epoch-zero and garbage dates). Anything else prints a dash.
 */
export function isShownUpdatedAt(updatedAt: string | null | undefined): updatedAt is string {
  if (!updatedAt) return false
  try {
    const date = dayjs(updatedAt)
    if (!date.isValid()) return false
    const year = date.year()
    return year >= 2000 && year <= 2100
  } catch {
    return false
  }
}

/** The legacy Excel columns (the export writes every role the search matched, titled with their count). */
export function roleExportColumns(formatDate: (date: string) => string): TableExportColumn<GraphQLRole>[] {
  return [
    { header: 'Role', key: 'name', width: 24, getter: (r) => r.name ?? '' },
    {
      header: 'Permissions Count',
      key: 'permissionsCount',
      width: 16,
      getter: (r) => r.permissions.reduce((sum, p) => sum + p.actions.length, 0),
    },
    {
      header: 'Domains',
      key: 'domains',
      width: 32,
      getter: (r) => [...new Set(r.permissions.map((p) => p.domain))].join(', '),
    },
    { header: 'Updated', key: 'updatedAt', width: 20, getter: (r) => (r.updatedAt ? formatDate(r.updatedAt) : '') },
  ]
}

export function exportTitle(count: number): string {
  return `Roles — ${count} role(s)`
}

/** The edit route of a role, as the legacy table navigated to it. */
export function roleEditPath(id: string): string {
  return `/security/roles/${id}/edit`
}

/** The three permission chips the Permissions cell shows, and how many it leaves for "+N". */
export function visiblePermissions(role: Pick<GraphQLRole, 'permissions'>) {
  return { shown: role.permissions.slice(0, 3), more: Math.max(0, role.permissions.length - 3) }
}

/** The four domain tags the Domains cell shows, and how many it leaves for "+N". */
export function visibleDomains(domains: readonly string[]) {
  return { shown: domains.slice(0, 4), more: Math.max(0, domains.length - 4) }
}
