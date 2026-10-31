/* The rules of /config/crm-users (CrmUsersPage.tsx), kept free of React so they are tested on their own.
 * Every value, message, default and variable is the legacy antd page's; where the kit's controls behave
 * differently from antd's, the difference is absorbed here and named in the comment.
 *
 * Nothing here logs, stores or copies a password: the functions take the typed values and return messages
 * or the mutation variables. */
import { z } from 'zod'
import type { StatusPillTone } from '@/ui/components/StatusPill'

export interface CrmUserRow {
  id: string
  name: string
  username: string | null
  email: string | null
  phone: string | null
  status: string
  requirePasswordReset: boolean
  lastLoginAt: string | null
  lastSeenAt: string | null
  createdAt: string
  roleNames: string[]
  roleIds: string[]
}

export interface CrmRoleRow {
  id: string
  name: string
  description: string | null
  isSystem: boolean
}

export interface CrmUsersPageData {
  tenant?: string | null
  enabled?: boolean | null
  seatLimit?: number | null
  seatsUsed?: number | null
  canChooseTenant?: boolean | null
  users?: CrmUserRow[] | null
}

/** The Super Admin's selector; `null` lets the server use the caller's own whitelabel (legacy `tenant ?? null`). */
export function tenantVariable(tenant: string | undefined): string | null {
  return tenant ?? null
}

/** The legacy date cell (the browser's zone, en-IN medium date and short time), or a dash. */
export function when(value: string | null): string {
  return value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

/** The legacy Tag colours: ACTIVE green, INACTIVE orange, SUSPENDED red; anything else neutral. */
export function statusTone(status: string): StatusPillTone {
  if (status === 'ACTIVE') return 'ok'
  if (status === 'INACTIVE') return 'warn'
  if (status === 'SUSPENDED') return 'neg'
  return 'neutral'
}

/** Suspend an ACTIVE user; reinstate anyone else (legacy). */
export function nextStatus(status: string): 'SUSPENDED' | 'ACTIVE' {
  return status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
}

export function statusActionLabel(status: string): 'Suspend' | 'Reinstate' {
  return status === 'ACTIVE' ? 'Suspend' : 'Reinstate'
}

export interface SeatSummary {
  enabled: boolean
  seatLimit: number
  seatsUsed: number
  /** Every seat taken: a limit is set and reached. */
  full: boolean
  /** The legacy Progress percent (rounded; 0 with no limit). */
  percent: number
  text: string
}

export function seatSummary(page: CrmUsersPageData | null | undefined): SeatSummary {
  const enabled = page?.enabled ?? false
  const seatLimit = page?.seatLimit ?? 0
  const seatsUsed = page?.seatsUsed ?? 0
  return {
    enabled,
    seatLimit,
    seatsUsed,
    full: seatLimit > 0 && seatsUsed >= seatLimit,
    percent: seatLimit > 0 ? Math.round((seatsUsed / seatLimit) * 100) : 0,
    text: `${seatsUsed} of ${seatLimit} seats used`,
  }
}

export interface Option {
  value: string
  label: string
}

export function whitelabelOptions(list: ReadonlyArray<{ tenant: string; name: string }> | null | undefined): Option[] {
  return (list ?? []).map((w) => ({ value: w.tenant, label: w.name }))
}

/** The New CRM user dialog lists roles by name. */
export function createRoleOptions(roles: readonly CrmRoleRow[]): Option[] {
  return roles.map((r) => ({ value: r.id, label: r.name }))
}

/** The Roles dialog marks the system role as full access. */
export function assignRoleOptions(roles: readonly CrmRoleRow[]): Option[] {
  return roles.map((r) => ({ value: r.id, label: r.isSystem ? `${r.name} (full access)` : r.name }))
}

export interface CrmMutationResult {
  ok?: boolean | null
  error?: string | null
}

/** Legacy `settle`: every CRM user mutation answers `{ ok, error }`. */
export function settleResult(payload: CrmMutationResult | null | undefined): { ok: true } | { ok: false; error: string } {
  if (payload?.ok) return { ok: true }
  return { ok: false, error: payload?.error ?? 'Something went wrong' }
}

export const SAVED_TITLE = 'Saved'
export const FAILED_TITLE = 'Failed'
export const LOAD_FAILED_TITLE = 'Could not load CRM users'
export const STATUS_CHANGED = 'Status changed'
export const STATUS_FAILED_TITLE = 'Could not change the status'
export const USER_REMOVED = 'User removed'
export const REMOVE_FAILED_TITLE = 'Could not remove the user'
export const USER_CREATED = 'CRM user created'
export const USER_SAVED = 'Saved'
export const PASSWORD_RESET = 'Password reset'
export const ROLES_UPDATED = 'Roles updated'

export const REMOVE_CONFIRM = {
  title: 'Remove this CRM user?',
  description:
    'Suspending is usually what you want. Removing takes their name off the record of every player whose contact details they read — that trail cannot be restored.',
  confirmLabel: 'Remove',
  cancelLabel: 'Cancel',
  tone: 'danger',
} as const

export function editTitle(name: string | undefined): string {
  return `Edit ${name ?? ''}`
}

export function resetTitle(name: string | undefined): string {
  return `Reset password for ${name ?? ''}`
}

export function rolesTitle(name: string | undefined): string {
  return `Roles for ${name ?? ''}`
}

// ---------- forms ----------

export const PASSWORD_MIN = 10
const PASSWORD_MESSAGE = 'At least 10 characters'

/** antd's `min` rule (async-validator) counted a supplementary-plane character once, as code points do. */
function codePointLength(value: string): number {
  return Array.from(value).length
}

/**
 * `{ required: true, min: 10, message: 'At least 10 characters' }`: one message for both an empty and a short
 * password. `required` meant a non-empty string (whitespace counted).
 */
function passwordIssue(value: string): string | null {
  return !value || codePointLength(value) < PASSWORD_MIN ? PASSWORD_MESSAGE : null
}

interface Issue<F extends string> {
  path: F
  message: string
}

interface IssueSink {
  addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void
}

function addIssues<F extends string>(issues: Issue<F>[], context: IssueSink) {
  for (const issue of issues) {
    context.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
  }
}

export interface CreateUserValues {
  name: string
  username: string
  password: string
  email: string
  roleIds: string[]
}

export const EMPTY_CREATE_USER: CreateUserValues = { name: '', username: '', password: '', email: '', roleIds: [] }

/** The legacy rules, in field order; antd's English `required` template is `Please enter ${label}`. */
export function createUserIssues(values: CreateUserValues): Issue<keyof CreateUserValues>[] {
  const issues: Issue<keyof CreateUserValues>[] = []
  if (!values.name) issues.push({ path: 'name', message: 'Please enter Name' })
  if (!values.username) issues.push({ path: 'username', message: 'Please enter Username' })
  const password = passwordIssue(values.password)
  if (password) issues.push({ path: 'password', message: password })
  return issues
}

export const createUserSchema = z
  .object({
    name: z.string(),
    username: z.string(),
    password: z.string(),
    email: z.string(),
    roleIds: z.array(z.string()),
  })
  .superRefine((values, context) => addIssues(createUserIssues(values), context))

export interface CreateUserVariables {
  tenant: string | null
  input: { name: string; username: string; password: string; email?: string; roleIds: string[] }
}

/**
 * WhitelabelCrmCreateUser: `{ ...values, roleIds: values.roleIds ?? [] }` in the legacy field order. An
 * untouched Email was not in antd's values, so it was not sent; an empty one is left out here too.
 */
export function createUserVariables(tenant: string | undefined, values: CreateUserValues): CreateUserVariables {
  const { name, username, password } = values
  const roleIds = values.roleIds ?? []
  const input = values.email !== ''
    ? { name, username, password, email: values.email, roleIds }
    : { name, username, password, roleIds }
  return { tenant: tenantVariable(tenant), input }
}

export interface EditUserValues {
  name: string
  email: string
  phone: string
}

/** The record seeds the form (legacy `setFieldsValue({ name, email, phone })`); a missing value is empty. */
export function editUserInitialValues(user: CrmUserRow): EditUserValues {
  return { name: user.name, email: user.email ?? '', phone: user.phone ?? '' }
}

export function editUserIssues(values: EditUserValues): Issue<keyof EditUserValues>[] {
  return values.name ? [] : [{ path: 'name', message: 'Please enter Name' }]
}

export const editUserSchema = z
  .object({ name: z.string(), email: z.string(), phone: z.string() })
  .superRefine((values, context) => addIssues(editUserIssues(values), context))

/**
 * antd kept a field set from a `null` record value as `null` until it was typed in, and a cleared field as
 * `''`. The kit fields hold strings, so an empty field whose record value was missing goes back as `null`;
 * any other value is sent as typed.
 */
function asSent(value: string, original: string | null | undefined): string | null {
  return value === '' && original == null ? null : value
}

export interface EditUserVariables {
  tenant: string | null
  input: { id: string; name: string; email: string | null; phone: string | null }
}

/** WhitelabelCrmUpdateUser: `{ id, ...values }` in the legacy order. */
export function editUserVariables(tenant: string | undefined, user: CrmUserRow, values: EditUserValues): EditUserVariables {
  return {
    tenant: tenantVariable(tenant),
    input: {
      id: user.id,
      name: values.name,
      email: asSent(values.email, user.email),
      phone: asSent(values.phone, user.phone),
    },
  }
}

export interface ResetPasswordValues {
  newPassword: string
}

export const EMPTY_RESET_PASSWORD: ResetPasswordValues = { newPassword: '' }

export function resetPasswordIssues(values: ResetPasswordValues): Issue<keyof ResetPasswordValues>[] {
  const password = passwordIssue(values.newPassword)
  return password ? [{ path: 'newPassword', message: password }] : []
}

export const resetPasswordSchema = z
  .object({ newPassword: z.string() })
  .superRefine((values, context) => addIssues(resetPasswordIssues(values), context))

/** WhitelabelCrmResetPassword: the server sets the new password and asks for a fresh one at next sign-in. */
export function resetPasswordVariables(
  tenant: string | undefined,
  user: CrmUserRow,
  values: ResetPasswordValues,
): { tenant: string | null; id: string; newPassword: string } {
  return { tenant: tenantVariable(tenant), id: user.id, newPassword: values.newPassword }
}

export interface RolesValues {
  roleIds: string[]
}

/** The Roles field had no rule. */
export const rolesSchema = z.object({ roleIds: z.array(z.string()) })

export function rolesInitialValues(user: CrmUserRow): RolesValues {
  return { roleIds: [...user.roleIds] }
}

export function rolesVariables(
  tenant: string | undefined,
  user: CrmUserRow,
  values: RolesValues,
): { tenant: string | null; id: string; roleIds: string[] } {
  return { tenant: tenantVariable(tenant), id: user.id, roleIds: values.roleIds ?? [] }
}

export function statusVariables(
  tenant: string | undefined,
  user: CrmUserRow,
): { tenant: string | null; id: string; status: 'SUSPENDED' | 'ACTIVE' } {
  return { tenant: tenantVariable(tenant), id: user.id, status: nextStatus(user.status) }
}

export function removeVariables(tenant: string | undefined, user: CrmUserRow): { tenant: string | null; id: string } {
  return { tenant: tenantVariable(tenant), id: user.id }
}
