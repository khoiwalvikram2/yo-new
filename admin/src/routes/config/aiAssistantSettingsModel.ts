/* The rules of /config/ai-assistant (AiAssistantSettingsPage.tsx), kept free of React so they are tested on
 * their own. Every setting key, default, period, message and variable is the legacy antd page's; where the
 * kit's controls behave differently from antd's, the difference is absorbed here and named in the comment.
 * The page only reads and writes these allowances; it never talks to the assistant itself. */

export interface AiSettingsRow {
  tenant: string
  enabled: boolean
  chatLimit: number
  limitPeriod: string
  used: number
  remaining: number
  updatedBy?: string | null
  updatedAt?: string | null
}

/** Edits held locally until saved, so a half-typed limit is never applied (legacy `drafts`). */
export type AiSettingsDrafts = Record<string, Partial<AiSettingsRow>>

export type AiDraftField = 'enabled' | 'chatLimit' | 'limitPeriod'

export const PERIODS = [
  { value: 'monthly', label: 'Per month' },
  { value: 'daily', label: 'Per day' },
  { value: 'total', label: 'One-off total' },
] as const

/** The legacy InputNumber floor (`min={0}`). */
export const CHAT_LIMIT_MIN = 0

/**
 * Whitelabels that have never been configured still need a row, otherwise there is no way to grant them
 * anything from this screen. They start closed: off, a zero allowance, renewing monthly. Rows are sorted by
 * tenant (legacy `useMemo`).
 */
export function settingsRows(
  configured: readonly AiSettingsRow[] | null | undefined,
  whitelabels: ReadonlyArray<{ id: string; name?: string }> | null | undefined,
): AiSettingsRow[] {
  const known = new Set((configured ?? []).map((r) => r.tenant))
  const unconfigured: AiSettingsRow[] = (whitelabels ?? [])
    .filter((w) => !known.has(w.id))
    .map((w) => ({
      tenant: w.id,
      enabled: false,
      chatLimit: 0,
      limitPeriod: 'monthly',
      used: 0,
      remaining: 0,
    }))
  return [...(configured ?? []), ...unconfigured].sort((a, b) => a.tenant.localeCompare(b.tenant))
}

/** Legacy `valueFor`: the draft when there is one, else the stored value. */
export function draftValue(row: AiSettingsRow, drafts: AiSettingsDrafts, key: 'enabled'): boolean
export function draftValue(row: AiSettingsRow, drafts: AiSettingsDrafts, key: 'chatLimit'): number
export function draftValue(row: AiSettingsRow, drafts: AiSettingsDrafts, key: 'limitPeriod'): string
export function draftValue(row: AiSettingsRow, drafts: AiSettingsDrafts, key: AiDraftField): boolean | number | string {
  return drafts[row.tenant]?.[key] ?? row[key]
}

/** Legacy `isDirty`: a row has unsaved edits once anything was edited, even back to the stored value. */
export function isDirty(drafts: AiSettingsDrafts, tenant: string): boolean {
  return Boolean(drafts[tenant])
}

/** Legacy `update`. */
export function withEdit(drafts: AiSettingsDrafts, tenant: string, patch: Partial<AiSettingsRow>): AiSettingsDrafts {
  return { ...drafts, [tenant]: { ...drafts[tenant], ...patch } }
}

/** A saved row, or Undo, drops the row's draft. */
export function withoutDraft(drafts: AiSettingsDrafts, tenant: string): AiSettingsDrafts {
  const next = { ...drafts }
  delete next[tenant]
  return next
}

/** Legacy `update(row.tenant, { chatLimit: Number(chatLimit ?? 0) })`: a cleared field means 0. */
export function allowanceFromInput(value: number | null): number {
  return Number(value ?? 0)
}

/**
 * antd's InputNumber never reported a value below its `min={0}` while typing and raised it on blur, so a draft
 * never held one. The kit NumberField reports what is typed (and rounds to whole messages on blur, as
 * `precision={0}` did); the page raises each typed value with `withTypedAllowance` and a negative draft to 0 on
 * blur with this.
 */
export function withAllowanceClamped(drafts: AiSettingsDrafts, tenant: string): AiSettingsDrafts {
  const chatLimit = drafts[tenant]?.chatLimit
  if (chatLimit === undefined || chatLimit >= CHAT_LIMIT_MIN) return drafts
  return withEdit(drafts, tenant, { chatLimit: CHAT_LIMIT_MIN })
}

/**
 * The drafts after the kit field reports a typed value, so a draft never holds a negative allowance. An entry of
 * at least 0 is the draft, as antd's onChange made it (a cleared field means 0). A negative entry is raised to 0
 * now rather than on blur (antd held it back while typing, then set 0 on blur); when 0 is already the value
 * shown nothing is edited and the row does not turn dirty, as antd then reported no change.
 */
export function withTypedAllowance(drafts: AiSettingsDrafts, row: AiSettingsRow, input: number | null): AiSettingsDrafts {
  const entered = allowanceFromInput(input)
  const next = Math.max(CHAT_LIMIT_MIN, entered)
  if (next !== entered && next === draftValue(row, drafts, 'chatLimit')) return drafts
  return withEdit(drafts, row.tenant, { chatLimit: next })
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
 * antd stepped no lower than `min={0}`. The kit NumberField steps from the number shown, unbounded unless it
 * gets `min` (which prints `Minimum: 0.` under every row), and raising its result afterwards would leave the
 * stepped number on screen. The page asks this before the kit steps: `null` lets the kit take a step that stays
 * at 0 or above (rounding to whole messages as before); otherwise the page takes the step itself and sets the
 * value returned: the step from the draft, stopped at 0 (the draft itself when it already sits there).
 */
export function boundedAllowanceStep(raw: string, current: number, direction: 1 | -1, multiplier: number): number | null {
  const base = enteredNumber(raw, current)
  if (base >= CHAT_LIMIT_MIN && base + direction * multiplier >= CHAT_LIMIT_MIN) return null
  return Math.max(CHAT_LIMIT_MIN, current + direction * multiplier)
}

export interface AiSettingsVariables {
  tenant: string
  enabled: boolean
  chatLimit: number
  limitPeriod: string
}

/**
 * SetAiWhitelabelSettings, as the legacy `commit` built it. The floor at 0 is antd's `min`, which a legacy draft
 * could never pass; the blur clamp above keeps it so here, and this repeats it in case a save ever beats a blur.
 */
export function saveVariables(row: AiSettingsRow, drafts: AiSettingsDrafts): AiSettingsVariables {
  return {
    tenant: row.tenant,
    enabled: Boolean(draftValue(row, drafts, 'enabled')),
    chatLimit: Math.max(CHAT_LIMIT_MIN, Number(draftValue(row, drafts, 'chatLimit')) || 0),
    limitPeriod: String(draftValue(row, drafts, 'limitPeriod')),
  }
}

export const SAVED_TITLE = 'Settings saved'
export const SAVE_FAILED_TITLE = 'Could not save settings'

/** The legacy success toast text. */
export function savedMessage(row: Pick<AiSettingsRow, 'tenant' | 'enabled' | 'chatLimit' | 'limitPeriod'>): string {
  return row.enabled
    ? `${row.tenant} can send ${row.chatLimit} message${row.chatLimit === 1 ? '' : 's'} ${
        row.limitPeriod === 'total' ? 'in total' : `per ${row.limitPeriod.replace('ly', '')}`
      }.`
    : `The assistant is switched off for ${row.tenant}.`
}

export const LOAD_FAILED_TITLE = 'Could not load assistant settings'

/** The resolver refuses anyone but a Super Admin; that refusal reads as who manages the settings. */
export function loadErrorText(message: string): string {
  return /Super Admin/i.test(message) ? 'These settings are managed by a Super Admin.' : message
}

export type UsageTone = 'acc' | 'warn' | 'neg'

/**
 * The Used cell, from the stored allowance (not the draft), as before. `null` is the legacy dash (no
 * allowance). The bar's colour steps were red at 100%, amber from 80%, indigo below: the kit Meter's neg, warn
 * and accent tones.
 */
export function usage(row: AiSettingsRow): { percent: number; tone: UsageTone; text: string } | null {
  if (row.chatLimit <= 0) return null
  const percent = Math.min(100, (row.used / row.chatLimit) * 100)
  return {
    percent,
    tone: percent >= 100 ? 'neg' : percent >= 80 ? 'warn' : 'acc',
    text: `${row.used} of ${row.chatLimit} · ${row.remaining} left`,
  }
}

/**
 * The Status column: Active only for a row stored on with an allowance, else Off (the legacy tags). It reads the
 * stored row, not the draft, so an unsaved edit shows beside the state it would change; Save and Undo sit in the
 * row actions while the row `isDirty`.
 */
export function storedState(row: Pick<AiSettingsRow, 'enabled' | 'chatLimit'>): 'active' | 'off' {
  return row.enabled && row.chatLimit > 0 ? 'active' : 'off'
}
