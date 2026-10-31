/* The rules of /config/crm-access (CrmAccessPage.tsx), kept free of React so they are tested on their own.
 * Every value, default, message and variable is the legacy antd page's; where the kit's controls behave
 * differently from antd's, the difference is absorbed here and named in the comment.
 *
 * Nothing here logs, stores or copies the temporary password: the functions take the typed values and
 * return messages or the mutation variables. */
import { z } from 'zod'

export interface CrmAccessRow {
  tenant: string
  name: string
  domain: string | null
  enabled: boolean
  seatLimit: number
  seatsUsed: number
}

/** Edits held locally until saved, so a half-typed seat count is never applied (legacy `drafts`). */
export type CrmAccessDrafts = Record<string, Partial<CrmAccessRow>>

export type CrmAccessDraftField = 'enabled' | 'seatLimit'

/** The legacy InputNumber bounds (`min={0} max={500}`). */
export const SEAT_LIMIT_MIN = 0
export const SEAT_LIMIT_MAX = 500

/** Legacy `valueOf`: the draft when there is one, else the stored value. */
export function draftValue(row: CrmAccessRow, drafts: CrmAccessDrafts, field: 'enabled'): boolean
export function draftValue(row: CrmAccessRow, drafts: CrmAccessDrafts, field: 'seatLimit'): number
export function draftValue(row: CrmAccessRow, drafts: CrmAccessDrafts, field: CrmAccessDraftField): boolean | number {
  return drafts[row.tenant]?.[field] ?? row[field]
}

/** Legacy `dirty`: a row has unsaved edits once anything was edited, even back to the stored value. */
export function isDirty(drafts: CrmAccessDrafts, tenant: string): boolean {
  return !!drafts[tenant]
}

/** Legacy `edit`. */
export function withEdit(drafts: CrmAccessDrafts, tenant: string, patch: Partial<CrmAccessRow>): CrmAccessDrafts {
  return { ...drafts, [tenant]: { ...drafts[tenant], ...patch } }
}

/** The saved row's draft is dropped (legacy onCompleted). */
export function withoutDraft(drafts: CrmAccessDrafts, tenant: string): CrmAccessDrafts {
  const next = { ...drafts }
  delete next[tenant]
  return next
}

/** Legacy `onChange={(v) => edit(..., { seatLimit: Number(v ?? 0) })}`: a cleared field means 0. */
export function seatLimitFromInput(value: number | null): number {
  return Number(value ?? 0)
}

export function clampSeatLimit(value: number): number {
  return Math.min(SEAT_LIMIT_MAX, Math.max(SEAT_LIMIT_MIN, value))
}

/**
 * antd's InputNumber never reported a value outside 0-500 while typing and clamped it on blur, so a draft
 * never held one. The kit NumberField reports what is typed; the page clamps each typed value with
 * `withTypedSeatLimit` and again on blur with this, which returns the clamped draft (unchanged when there is no
 * draft or it is in range).
 */
export function withSeatLimitClamped(drafts: CrmAccessDrafts, tenant: string): CrmAccessDrafts {
  const seatLimit = drafts[tenant]?.seatLimit
  if (seatLimit === undefined || clampSeatLimit(seatLimit) === seatLimit) return drafts
  return withEdit(drafts, tenant, { seatLimit: clampSeatLimit(seatLimit) })
}

/**
 * The draft after the kit field reports a typed value, so the draft and the In use pill never leave 0-500. An
 * in-range entry is the draft, as antd's onChange made it (a cleared field means 0). An out-of-range entry is
 * clamped now rather than on blur (antd held it back while typing, then set the clamped value on blur); when
 * the clamped value is the one already shown nothing is edited and the row does not turn dirty, as antd then
 * reported no change.
 */
export function withTypedSeatLimit(drafts: CrmAccessDrafts, row: CrmAccessRow, input: number | null): CrmAccessDrafts {
  const entered = seatLimitFromInput(input)
  const next = clampSeatLimit(entered)
  if (next !== entered && next === draftValue(row, drafts, 'seatLimit')) return drafts
  return withEdit(drafts, row.tenant, { seatLimit: next })
}

/** The kit NumberField steps on ArrowUp and ArrowDown (ten at a time with Shift); anything else is not a step. */
export function stepDirection(key: string): 1 | -1 | null {
  if (key === 'ArrowUp') return 1
  if (key === 'ArrowDown') return -1
  return null
}

/** The number the field shows (its raw text while focused), or the draft when the text is empty or partial. */
export function enteredNumber(raw: string, current: number): number {
  const text = raw.trim()
  if (text === '') return current
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : current
}

/**
 * antd stepped within `min={0} max={500}`. The kit NumberField steps from the number shown, unbounded unless it
 * gets `min`/`max` (which print the range under every row), and clamping its result afterwards would leave the
 * stepped number on screen. The page asks this before the kit steps: `null` lets the kit take a step that stays
 * in range; otherwise the page takes the step itself and sets the value returned: the step from the draft,
 * stopped at the bound (the draft itself when it already sits there).
 */
export function boundedSeatStep(raw: string, current: number, direction: 1 | -1, multiplier: number): number | null {
  const base = enteredNumber(raw, current)
  const target = base + direction * multiplier
  if (clampSeatLimit(base) === base && clampSeatLimit(target) === target) return null
  return clampSeatLimit(current + direction * multiplier)
}

export interface CrmSettingsVariables {
  tenant: string
  enabled: boolean
  seatLimit: number
}

/** SetCrmWhitelabelSettings, in the legacy key order. The two optional arguments were never sent. */
export function saveVariables(row: CrmAccessRow, drafts: CrmAccessDrafts): CrmSettingsVariables {
  return {
    tenant: row.tenant,
    enabled: draftValue(row, drafts, 'enabled'),
    seatLimit: clampSeatLimit(draftValue(row, drafts, 'seatLimit')),
  }
}

export interface SavedCrmSettings {
  tenant: string
  enabled: boolean
  seatLimit: number
}

export const SAVED_TITLE = 'Saved'
export const SAVE_FAILED_TITLE = 'Could not save'

/** The legacy success toast text. */
export function savedMessage(row: SavedCrmSettings): string {
  return row.enabled
    ? `${row.tenant} may have up to ${row.seatLimit} CRM user${row.seatLimit === 1 ? '' : 's'}.`
    : `The CRM is switched off for ${row.tenant}.`
}

/** The second line of the Whitelabel cell: the CRM address, or the tenant when there is no domain. */
export function crmAddress(row: Pick<CrmAccessRow, 'domain' | 'tenant'>): string {
  return row.domain ? `crm.${row.domain.replace(/^https?:\/\//, '')}` : row.tenant
}

export type SeatUsageTone = 'neg' | 'info' | 'neutral'

/**
 * The In use cell. `null` is the legacy dash (switched off and nobody on it). The tone is the legacy Tag
 * colour: red when a limit is set and reached, blue while anyone is on it, grey otherwise. The limit is the
 * one on screen (the draft), as before.
 */
export function seatUsage(row: CrmAccessRow, limit: number): { text: string; tone: SeatUsageTone } | null {
  const used = row.seatsUsed
  if (!row.enabled && used === 0) return null
  return {
    text: `${used} of ${limit}`,
    tone: limit > 0 && used >= limit ? 'neg' : used > 0 ? 'info' : 'neutral',
  }
}

/** Offered only while the stored row is on and nobody holds a seat (legacy). */
export function canCreateFirstAdmin(row: CrmAccessRow): boolean {
  return row.enabled && row.seatsUsed === 0
}

// ---------- the first-administrator form ----------

export interface FirstAdminValues {
  name: string
  username: string
  password: string
  email: string
}

export type FirstAdminField = keyof FirstAdminValues

export const EMPTY_FIRST_ADMIN: FirstAdminValues = { name: '', username: '', password: '', email: '' }

export const FIRST_ADMIN_PASSWORD_MIN = 10

/** antd's `min` rule (async-validator) counted a supplementary-plane character once, as code points do. */
function codePointLength(value: string): number {
  return Array.from(value).length
}

export interface FirstAdminIssue {
  path: FirstAdminField
  message: string
}

/**
 * The legacy Form.Item rules, in field order. `required` used antd's English template
 * (`Please enter ${label}`) and meant a non-empty string (whitespace counted, `whitespace` was off). The
 * password's `min` rule was skipped for an empty value (async-validator), so an empty password reports only
 * the required message. Email had no rule.
 */
export function firstAdminIssues(values: FirstAdminValues): FirstAdminIssue[] {
  const issues: FirstAdminIssue[] = []
  if (!values.name) issues.push({ path: 'name', message: 'Please enter Full name' })
  if (!values.username) issues.push({ path: 'username', message: 'Please enter Username' })
  if (!values.password) {
    issues.push({ path: 'password', message: 'Please enter Temporary password' })
  } else if (codePointLength(values.password) < FIRST_ADMIN_PASSWORD_MIN) {
    issues.push({ path: 'password', message: 'At least 10 characters' })
  }
  return issues
}

export const firstAdminSchema = z
  .object({
    name: z.string(),
    username: z.string(),
    password: z.string(),
    email: z.string(),
  })
  .superRefine((values, context) => {
    for (const issue of firstAdminIssues(values)) {
      context.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
    }
  })

export interface FirstAdminVariables {
  tenant: string
  name: string
  username: string
  password: string
  email?: string
}

/**
 * CrmCreateFirstAdmin: `{ tenant, ...values }` in the legacy order. An untouched Email field was not in
 * antd's values, so it was not sent; an empty one is left out here too.
 */
export function firstAdminVariables(tenant: string, values: FirstAdminValues): FirstAdminVariables {
  const variables: FirstAdminVariables = {
    tenant,
    name: values.name,
    username: values.username,
    password: values.password,
  }
  if (values.email !== '') variables.email = values.email
  return variables
}

export function firstAdminTitle(name: string | undefined): string {
  return `First CRM administrator for ${name ?? ''}`
}

export const FIRST_ADMIN_CREATED_TITLE = 'Administrator created'
export const FIRST_ADMIN_CREATED_MESSAGE = 'They can sign in at the CRM and will set their own password.'
export const FIRST_ADMIN_FAILED_TITLE = 'Failed'
export const FIRST_ADMIN_FALLBACK_ERROR = 'Could not create the administrator'

export interface FirstAdminResult {
  ok?: boolean | null
  error?: string | null
}

/** The legacy reading of `{ ok, error }`. */
export function firstAdminOutcome(result: FirstAdminResult | null | undefined): { ok: true } | { ok: false; error: string } {
  if (result?.ok) return { ok: true }
  return { ok: false, error: result?.error ?? FIRST_ADMIN_FALLBACK_ERROR }
}
