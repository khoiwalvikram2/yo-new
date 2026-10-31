/* The rules of /security/support-admins (SupportAdminsPage.tsx), kept free of React so they are tested on their
 * own. Every value, label, message and variable is the legacy antd page's; where the kit behaves differently from
 * antd the difference is absorbed here and named in the comment.
 *
 * Nothing here logs, stores or copies a password: the create-form functions take the typed values and return
 * messages or the mutation variables, and nothing else. */
import { z } from 'zod'
import type { Role } from '@/state/rbacStore'
import type { TableExportColumn } from '@/shared/utils/tableExport'
import type { StatusPillTone } from '@/ui/components/StatusPill'

export type AdminStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

export interface AdminUser {
  id: string
  name: string
  email: string | null
  createdAt: string
  roles: Role[]
  status?: AdminStatus
}

/** One row of the Audit query (the shape the page reads; `before`/`after` are JSON values). */
export interface AuditEvent {
  id: string
  actorId: string | null
  domain: string | null
  action: string
  resourceType: string | null
  resourceId: string | null
  timestamp: string
  before?: unknown
  after?: unknown
}

export interface IpAllowlistEntry {
  id: string
  cidr: string
  createdAt: string | null
}

// ---------- list ----------

/** The signed-in admin never sees their own row (legacy `admin.id !== currentUserId`). */
export function visibleAdmins(list: readonly AdminUser[] | null | undefined, currentUserId: string | undefined): AdminUser[] {
  return (list ?? []).filter((admin) => admin.id !== currentUserId)
}

/** Name, email or any role name contains the trimmed, lower-cased search (legacy client-side filter). */
export function filterAdmins(admins: readonly AdminUser[], searchText: string): AdminUser[] {
  if (!searchText.trim()) return [...admins]
  const q = searchText.toLowerCase().trim()
  return admins.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      (a.email || '').toLowerCase().includes(q) ||
      a.roles.some((r) => r.name.toLowerCase().includes(q)),
  )
}

/** The page the table can show: 1 when nothing is listed, never past the last page. */
export function clampPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

/**
 * The rows of one page. Named change: the legacy slice used the raw page number, so narrowing the search while
 * on page 3 left an empty table under a non-empty count; the page is clamped to the last one now, as the kit
 * Pagination already displays it.
 */
export function pageOfAdmins<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const current = clampPage(page, rows.length, pageSize)
  const start = (current - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/** The legacy card line under the list title. */
export function adminCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'admin' : 'admins'}`
}

/** A missing status reads as Active (legacy). */
export function isActiveAdmin(admin: Pick<AdminUser, 'status'>): boolean {
  return admin.status === 'ACTIVE' || !admin.status
}

/** The legacy status tag: Suspended red, Active (or missing) green, anything else a grey Inactive. */
export function adminStatus(admin: Pick<AdminUser, 'status'>): { label: 'Suspended' | 'Active' | 'Inactive'; tone: StatusPillTone } {
  if (admin.status === 'SUSPENDED') return { label: 'Suspended', tone: 'neg' }
  if (isActiveAdmin(admin)) return { label: 'Active', tone: 'ok' }
  return { label: 'Inactive', tone: 'neutral' }
}

/** The legacy ID line: the first eight characters and an ellipsis, always. */
export function shortAdminId(id: string): string {
  return id.substring(0, 8) + '...'
}

// ---------- activity ----------

/** The most recent audit event of each listed admin (legacy recentActivityMap). */
export function latestActivityByAdmin(
  events: readonly AuditEvent[] | null | undefined,
  admins: readonly Pick<AdminUser, 'id'>[],
): Map<string, AuditEvent> {
  const activitiesByAdmin = new Map<string, AuditEvent>()
  if (!events || !admins.length) return activitiesByAdmin
  const adminIds = new Set(admins.map((a) => a.id))
  events.forEach((event) => {
    if (event.actorId && adminIds.has(event.actorId)) {
      const existing = activitiesByAdmin.get(event.actorId)
      if (!existing || new Date(event.timestamp) > new Date(existing.timestamp)) {
        activitiesByAdmin.set(event.actorId, event)
      }
    }
  })
  return activitiesByAdmin
}

/** `role_assigned` → `Role Assigned` (legacy). */
export function formatAction(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
}

/** The table and Activity Log tag colour: green create/assign/reactivate, red delete/revoke/deactivate/blocked,
 *  otherwise blue. */
export function activityTone(action: string): StatusPillTone {
  if (action.includes('create') || action.includes('assign') || action.includes('reactivate')) return 'ok'
  if (action.includes('delete') || action.includes('revoke') || action.includes('deactivate') || action.includes('blocked')) {
    return 'neg'
  }
  return 'info'
}

/** The Manage Roles timeline dot: green create, red delete/revoke, otherwise blue (a different legacy rule). */
export function timelineTone(action: string): 'ok' | 'neg' | 'info' {
  if (action.includes('create')) return 'ok'
  if (action.includes('delete') || action.includes('revoke')) return 'neg'
  return 'info'
}

/** `Just now`, `5m ago`, `3h ago`, `2d ago` from the event to `now` (legacy). */
export function timeAgo(timestamp: string, now: Date = new Date()): string {
  const eventTime = new Date(timestamp)
  const diffMs = now.getTime() - eventTime.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

/** Activity Log Resource column: `ID: ` and the first twelve characters, an ellipsis always (legacy). */
export function resourceIdLabel(resourceId: unknown): string {
  return `ID: ${String(resourceId).substring(0, 12)}...`
}

function hasKeys(value: unknown): boolean {
  return value != null && Object.keys(value as object).length > 0
}

function preview(value: unknown): string {
  return `${String(JSON.stringify(value, null, 0)).slice(0, 80)}...`
}

/** Activity Log Details: the first 80 characters of each non-empty side, or null for `No details` (legacy). */
export function auditDetails(event: Pick<AuditEvent, 'before' | 'after'>): { before?: string; after?: string } | null {
  const hasBefore = hasKeys(event.before)
  const hasAfter = hasKeys(event.after)
  if (!hasBefore && !hasAfter) return null
  return {
    ...(hasBefore ? { before: preview(event.before) } : {}),
    ...(hasAfter ? { after: preview(event.after) } : {}),
  }
}

// ---------- roles ----------

export interface EffectivePermission {
  domain: string
  label: string
}

/** One tag per permission domain across the assigned roles, with its distinct action count (legacy). */
export function effectivePermissions(roles: readonly Role[]): EffectivePermission[] {
  const domainMap = new Map<string, Set<string>>()
  roles.forEach((role) => {
    role.permissions.forEach((perm) => {
      const actions = domainMap.get(perm.domain) ?? new Set<string>()
      domainMap.set(perm.domain, actions)
      perm.actions.forEach((action) => {
        actions.add(action)
      })
    })
  })
  return Array.from(domainMap.entries()).map(([domain, actions]) => ({
    domain,
    label: `${domain}: ${actions.size} ${actions.size === 1 ? 'action' : 'actions'}`,
  }))
}

/** `N permissions` (always plural, legacy): every action of every permission of the role. */
export function permissionCountLabel(role: Role): string {
  const totalPerms = role.permissions.reduce((sum, p) => sum + p.actions.length, 0)
  return `${totalPerms} permissions`
}

/** The roles not yet assigned, in the Roles query's order. */
export function availableRoles(allRoles: readonly Role[], assignedRoles: readonly Role[]): Role[] {
  const assignedRoleIds = new Set(assignedRoles.map((r) => r.id))
  return allRoles.filter((r) => !assignedRoleIds.has(r.id))
}

export function roleVariables(userId: string, roleId: string): { input: { userId: string; roleId: string } } {
  return { input: { userId, roleId } }
}

// ---------- row actions ----------

export function deactivateVariables(admin: Pick<AdminUser, 'id'>): { id: string; status: 'INACTIVE' } {
  return { id: admin.id, status: 'INACTIVE' }
}

export function reactivateVariables(admin: Pick<AdminUser, 'id'>): { id: string; status: 'ACTIVE' } {
  return { id: admin.id, status: 'ACTIVE' }
}

export function forceLogoutVariables(admin: Pick<AdminUser, 'id'>): { id: string } {
  return { id: admin.id }
}

/** Reset Password asks the server to require a new password at next sign-in; no password travels. */
export function resetPasswordVariables(admin: Pick<AdminUser, 'id'>): { id: string; require: true } {
  return { id: admin.id, require: true }
}

export function deleteVariables(admin: Pick<AdminUser, 'id'>): { id: string } {
  return { id: admin.id }
}

/** The legacy Modal.confirm (its two paragraphs are composed by the page around the bold name). */
export const DELETE_CONFIRM = {
  title: 'Delete Support Admin',
  warning: 'This action cannot be undone. All associated data including roles will be permanently deleted.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  tone: 'danger',
} as const

/** The legacy Popconfirm, now a modal confirmation (D5). */
export const REMOVE_IP_CONFIRM = {
  title: 'Remove this IP from allowlist?',
  confirmLabel: 'Remove',
  cancelLabel: 'Cancel',
  tone: 'danger',
} as const

// ---------- export ----------

export const EXPORT_FILENAME = 'Support-Admins'
export const EXPORT_SHEET = 'Support Admins'

export function exportTitle(count: number): string {
  return `Support Admins — ${count} admin(s)`
}

/** The legacy Excel columns, in order; Created uses the app's default date format. */
export function supportAdminExportColumns(formatDate: (value: string) => string): TableExportColumn<AdminUser>[] {
  return [
    { header: 'Name', key: 'name', width: 22, getter: (a) => a.name ?? '' },
    { header: 'Email', key: 'email', width: 28, getter: (a) => a.email ?? '' },
    { header: 'Status', key: 'status', width: 12, getter: (a) => a.status ?? 'ACTIVE' },
    { header: 'Roles', key: 'roles', width: 24, getter: (a) => a.roles?.map((r) => r.name).join(', ') ?? '' },
    { header: 'Created', key: 'createdAt', width: 20, getter: (a) => (a.createdAt ? formatDate(a.createdAt) : '') },
  ]
}

// ---------- forms ----------

interface IssueSink {
  addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void
}

interface Issue<F extends string> {
  path: F
  message: string
}

function addIssues<F extends string>(issues: Issue<F>[], context: IssueSink) {
  for (const issue of issues) context.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
}

/** antd's async-validator `min` counted a supplementary-plane character once, as code points do. */
function codePointLength(value: string): number {
  return Array.from(value).length
}

/** async-validator's `type: 'email'` test (the pattern and the 320-character cap antd 5 shipped). */
const EMAIL_PATTERN =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9\u00a0-\ud7ff\uf900-\ufdcf\ufdf0-\uffef]+\.)+[a-zA-Z\u00a0-\ud7ff\uf900-\ufdcf\ufdf0-\uffef]{2,}))$/

export function isValidEmail(value: string): boolean {
  return value.length <= 320 && EMAIL_PATTERN.test(value)
}

export const PASSWORD_MIN = 6

export interface CreateAdminValues {
  name: string
  email: string
  password: string
  phone: string
  roleIds: string[]
}

/** Every field starts empty; there is no default password. */
export const EMPTY_CREATE_ADMIN: CreateAdminValues = { name: '', email: '', password: '', phone: '', roleIds: [] }

/**
 * The legacy rules, in field order, one message per field. antd's `required` passed a whitespace-only string
 * and failed an empty one; the email and length rules ran only on a non-empty value.
 */
export function createAdminIssues(values: CreateAdminValues): Issue<keyof CreateAdminValues>[] {
  const issues: Issue<keyof CreateAdminValues>[] = []
  if (!values.name) issues.push({ path: 'name', message: 'Please enter name' })
  if (!values.email) issues.push({ path: 'email', message: 'Please enter email' })
  else if (!isValidEmail(values.email)) issues.push({ path: 'email', message: 'Enter a valid email' })
  if (!values.password) issues.push({ path: 'password', message: 'Please enter password' })
  else if (codePointLength(values.password) < PASSWORD_MIN) issues.push({ path: 'password', message: 'Minimum 6 characters' })
  if (!values.roleIds?.length) issues.push({ path: 'roleIds', message: 'Please select at least one role' })
  return issues
}

export const createAdminSchema = z
  .object({
    name: z.string(),
    email: z.string(),
    password: z.string(),
    phone: z.string(),
    roleIds: z.array(z.string()),
  })
  .superRefine((values, context) => addIssues(createAdminIssues(values), context))

export interface CreateAdminVariables {
  input: { name: string; email: string; password: string; phone: string | undefined; roleIds: string[] }
}

/** CreateSupportAdmin, in the legacy key order: values as typed, the phone trimmed or left out. */
export function createAdminVariables(values: CreateAdminValues): CreateAdminVariables {
  return {
    input: {
      name: values.name,
      email: values.email,
      password: values.password,
      phone: values.phone?.trim?.() || undefined,
      roleIds: values.roleIds || [],
    },
  }
}

export interface RoleOption {
  value: string
  label: string
}

export function roleOptions(roles: readonly Role[]): RoleOption[] {
  return roles.map((role) => ({ label: role.name, value: role.id }))
}

// IP allowlist

export const CIDR_PATTERN = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/
export const IP_HELP = 'Enter a single IP (e.g., 192.168.1.1) or CIDR notation (e.g., 192.168.1.0/24)'
export const IP_PLACEHOLDER = '192.168.1.1 or 192.168.1.0/24'

export interface IpValues {
  cidr: string
}

export const EMPTY_IP: IpValues = { cidr: '' }

/** Required, then the legacy IPv4 / CIDR pattern on a non-empty value (whitespace counts as a value). */
export function ipIssues(values: IpValues): Issue<keyof IpValues>[] {
  if (!values.cidr) return [{ path: 'cidr', message: 'Please enter IP address or CIDR' }]
  if (!CIDR_PATTERN.test(values.cidr)) {
    return [{ path: 'cidr', message: 'Invalid IP address or CIDR format (e.g., 192.168.1.1 or 192.168.1.0/24)' }]
  }
  return []
}

export const ipSchema = z
  .object({ cidr: z.string() })
  .superRefine((values, context) => addIssues(ipIssues(values), context))

/** AddIpToAllowlist: the value as typed. */
export function addIpVariables(userId: string, values: IpValues): { userId: string; cidr: string } {
  return { userId, cidr: values.cidr }
}
