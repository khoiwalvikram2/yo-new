import type { Matka } from '@/modules/matka/types'

/** Pure contracts for `/matka/list` and `/matka/management`.
 *
 * The API currently returns upper-case status values while the historical client type declares
 * lower-case values.  This model intentionally accepts both spellings and keeps the GraphQL enum
 * values upper-case at mutation/query boundaries.
 */

export type MatkaRecord = Omit<Matka, 'status'> & {
  status: Matka['status'] | 'ACTIVE' | 'INACTIVE' | 'SUSPEND' | string
}

export type ApplyMode = 'overwrite' | 'fill-empty' | 'replace-all'
export type DrawerStatus = boolean | 'suspend'
export type SettingsTab = 'stake' | 'bid' | 'exposure' | 'risk'

export interface MatkaListFilters {
  query?: string
  status?: string
  page: number
  limit: number
}

export interface CoreTotals {
  total: number
  active: number
  inactive: number
  suspended: number
}

export interface SettingsValues {
  mode?: ApplyMode
  tier?: string | null
  minBet?: number | string | null
  maxBet?: number | string | null
  exposureDaily?: number | string | null
  exposureWeekly?: number | string | null
  exposureCap?: number | string | null
  riskLevel?: string | null
  riskThreshold?: number | string | null
}

export interface RateEntry {
  betType: string
  payoutMultiplier: number
  minOdds?: number | null
  maxOdds?: number | null
}

export interface RateRow extends RateEntry {
  minOdds: number | null
  maxOdds: number | null
}

export interface BidRuleDraft {
  bidType: string
  percentage: number | null
  status: boolean
  includeAll: boolean
  includedPlayers: string[]
  notes?: string
}

export const MATKA_PAGE_SIZES = [10, 20, 50, 100] as const

export const MATKA_STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPEND', label: 'Suspend' },
] as const

export const APPLY_MODE_OPTIONS = [
  { value: 'overwrite', label: 'Overwrite unchanged' },
  { value: 'fill-empty', label: 'Only set where empty' },
  { value: 'replace-all', label: 'Replace all' },
] as const

export const RISK_LEVEL_OPTIONS = [
  { value: '', label: 'Select risk level' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const

export const BET_TYPES = [
  { key: 'SINGLE', label: 'Single' },
  { key: 'JODI', label: 'Jodi' },
  { key: 'SINGLE_PANNA', label: 'Single Pana' },
  { key: 'DOUBLE_PANNA', label: 'Double Pana' },
  { key: 'TRIPLE_PANNA', label: 'Triple Pana' },
  { key: 'HALF_SANGAM', label: 'Half Sangam' },
  { key: 'FULL_SANGAM', label: 'Full Sangam' },
  { key: 'AB', label: 'Satta AB' },
  { key: 'A', label: 'Satta A' },
  { key: 'B', label: 'Satta B' },
] as const

export const BID_TYPE_OPTIONS = BET_TYPES.map(({ key, label }) => ({ value: key, label }))

export type BidRuleMarketKind = 'worli' | 'starline' | 'jackpot' | 'sattaMatka'

/** The bid types admin-backend accepts in a rule for each market kind: allowedBids in shared/src/matka/rules.ts,
 *  which the bid-rule save checks ("This bid type is unavailable for the market"). Keep the two in step. */
const BIDS_BY_KIND: Record<BidRuleMarketKind, readonly string[]> = {
  worli: ['SINGLE', 'JODI', 'SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA', 'HALF_SANGAM', 'FULL_SANGAM'],
  starline: ['SINGLE', 'SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA'],
  jackpot: ['JODI'],
  sattaMatka: ['AB', 'A', 'B'],
}

/** A market's kind as the server reads it (matkaKind in shared/src/matka/rules.ts): settings.matkaType in any case,
 *  Worli when unset; null for a kind the server does not know. */
export function bidRuleMarketKind(settings: unknown): BidRuleMarketKind | null {
  const value = String((settings as { matkaType?: unknown } | null | undefined)?.matkaType || 'worli').toLowerCase()
  if (value === 'sattamatka' || value === 'satta_matka') return 'sattaMatka'
  if (value === 'worli' || value === 'starline' || value === 'jackpot') return value
  return null
}

/** The Bid Type choices for a market: only its kind's bid types (a Worli market offered Satta AB, A and B, which the
 *  server refused). A kind the server does not know keeps the full list; the server's refusal then names it. */
export function bidTypeOptionsFor(settings: unknown): readonly { value: string; label: string }[] {
  const kind = bidRuleMarketKind(settings)
  if (!kind) return BID_TYPE_OPTIONS
  return BID_TYPE_OPTIONS.filter((option) => BIDS_BY_KIND[kind].includes(option.value))
}

export function buildMatkaFilters(
  debouncedQuery: string,
  status: string,
  page: number,
  limit: number,
): MatkaListFilters {
  const trimmed = debouncedQuery.trim()
  return {
    query: trimmed.length >= 2 ? trimmed : undefined,
    status: status || undefined,
    page,
    limit,
  }
}

export function countMatkaFilters(query: string, status: string): number {
  return Number(Boolean(query)) + Number(Boolean(status))
}

export function sortMatkasByPriority<T extends Pick<MatkaRecord, 'priority'>>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0))
}

export function reorderMatkaRows<T extends Pick<MatkaRecord, 'id' | 'priority'>>(
  items: readonly T[],
  activeId: string,
  overId: string,
): T[] {
  const oldIndex = items.findIndex((item) => item.id === activeId)
  const newIndex = items.findIndex((item) => item.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return [...items]
  const next = [...items]
  const [moved] = next.splice(oldIndex, 1)
  next.splice(newIndex, 0, moved)
  return next.map((item, index) => ({ ...item, priority: index + 1 }))
}

export function reorderMutationInput(items: readonly Pick<MatkaRecord, 'id'>[]): Array<{ id: string; priority: number }> {
  return items.map((item, index) => ({ id: item.id, priority: index + 1 }))
}

export function toggleMatkaSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Keeps the historical page-level rule: an exact page-size selection clears; otherwise this page replaces it. */
export function toggleCurrentPageSelection(
  selected: ReadonlySet<string>,
  items: readonly Pick<MatkaRecord, 'id'>[],
): Set<string> {
  return selected.size === items.length ? new Set() : new Set(items.map((item) => item.id))
}

export function matkaStatus(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export function statusLabel(value: unknown): string {
  const status = matkaStatus(value)
  if (status === 'ACTIVE') return 'ACTIVE'
  if (status === 'INACTIVE') return 'INACTIVE'
  if (status === 'SUSPEND') return 'SUSPEND'
  return status || '—'
}

export function statusTone(value: unknown): 'ok' | 'muted' | 'warn' | 'neutral' {
  const status = matkaStatus(value)
  if (status === 'ACTIVE') return 'ok'
  if (status === 'INACTIVE') return 'muted'
  if (status === 'SUSPEND') return 'warn'
  return 'neutral'
}

export function drawerStatusFor(value: unknown): DrawerStatus {
  const status = matkaStatus(value)
  if (status === 'SUSPEND') return 'suspend'
  return status === 'ACTIVE'
}

export function statusMutationTarget(status: DrawerStatus): 'ACTIVE' | 'INACTIVE' | 'SUSPEND' {
  return status === 'suspend' ? 'SUSPEND' : status ? 'ACTIVE' : 'INACTIVE'
}

export function coreTotalsFrom(items: readonly Pick<MatkaRecord, 'status'>[]): CoreTotals {
  const total = items.length
  const active = items.filter((item) => matkaStatus(item.status) === 'ACTIVE').length
  const inactive = items.filter((item) => matkaStatus(item.status) === 'INACTIVE').length
  const suspended = items.filter((item) => matkaStatus(item.status) === 'SUSPEND').length
  return { total, active, inactive, suspended }
}

export function percentage(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '—'
}

export function scheduleSummary(schedule: Record<string, unknown> | null | undefined): string {
  const days = Array.isArray(schedule?.daysOfWeek) ? schedule.daysOfWeek.map(Number) : null
  if (!days) return '—'
  if (days.length === 7) return 'Daily'
  if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) return 'Weekdays'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekend'
  return `${days.length} days/week`
}

export function scheduleTimeRange(schedule: Record<string, unknown> | null | undefined): string {
  return schedule?.openTime && schedule?.closeTime
    ? `${String(schedule.openTime)} - ${String(schedule.closeTime)}`
    : '—'
}

export function scheduleWeekdays(schedule: Record<string, unknown> | null | undefined): string {
  if (!Array.isArray(schedule?.daysOfWeek)) return '—'
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return schedule.daysOfWeek.map(Number).map((day) => names[day]).filter(Boolean).join(', ') || '—'
}

export function subtractMinutes(time: string, minutes: number): string {
  if (!time || !minutes) return ''
  const [hours, mins] = time.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return ''
  const value = ((hours * 60 + mins - minutes) % (24 * 60) + 24 * 60) % (24 * 60)
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

const LIMIT_KEYS = ['minBet', 'maxBet', 'exposureDaily', 'exposureWeekly', 'exposureCap'] as const
const RISK_KEYS = ['riskLevel', 'riskThreshold'] as const
type LimitKey = typeof LIMIT_KEYS[number]
type RiskKey = typeof RISK_KEYS[number]

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

export function settingsPayload(values: SettingsValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const key of [...LIMIT_KEYS, ...RISK_KEYS]) {
    if (present(values[key])) payload[key] = values[key]
  }
  return payload
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function convertedValue(key: LimitKey | RiskKey, value: unknown): unknown {
  return key === 'riskLevel' ? value : Number(value)
}

function patchRecord<K extends LimitKey | RiskKey>(
  current: Record<string, unknown>,
  payload: Record<string, unknown>,
  keys: readonly K[],
  mode: ApplyMode,
): Record<string, unknown> {
  const next = { ...current }
  for (const key of keys) {
    if (!(key in payload)) continue
    if (mode === 'fill-empty' && !isEmpty(current[key])) continue
    if (mode === 'overwrite' && current[key] === payload[key]) continue
    next[key] = convertedValue(key, payload[key])
  }
  return next
}

export function patchLimits(
  current: Record<string, unknown>,
  payload: Record<string, unknown>,
  mode: ApplyMode,
): Record<string, unknown> {
  return patchRecord(current, payload, LIMIT_KEYS, mode)
}

export function patchRisk(
  current: Record<string, unknown>,
  payload: Record<string, unknown>,
  mode: ApplyMode,
): Record<string, unknown> {
  return patchRecord(current, payload, RISK_KEYS, mode)
}

/** Tier writes historically send every supplied key regardless of apply mode or current base value. */
export function tierPatch(payload: Record<string, unknown>, kind: 'limits' | 'risk'): Record<string, unknown> {
  const keys = kind === 'limits' ? LIMIT_KEYS : RISK_KEYS
  const patch: Record<string, unknown> = {}
  for (const key of keys) {
    if (key in payload) patch[key] = convertedValue(key, payload[key])
  }
  return patch
}

export function recordChanged(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) !== JSON.stringify(right)
}

export function settingsInitialValues(matka: MatkaRecord | null): SettingsValues {
  const limits = (matka?.limits ?? {}) as Record<string, unknown>
  const settings = (matka?.settings ?? {}) as Record<string, unknown>
  return {
    mode: 'overwrite',
    tier: 'default',
    minBet: numberOrNull(limits.minBet),
    maxBet: numberOrNull(limits.maxBet),
    exposureDaily: numberOrNull(limits.exposureDaily),
    exposureWeekly: numberOrNull(limits.exposureWeekly),
    exposureCap: numberOrNull(limits.exposureCap),
    riskLevel: present(settings.riskLevel) ? String(settings.riskLevel) : null,
    riskThreshold: numberOrNull(settings.riskThreshold),
  }
}

export function emptySettingsValues(): SettingsValues {
  return { mode: 'overwrite', tier: 'default' }
}

function numberOrNull(value: unknown): number | null {
  return present(value) && Number.isFinite(Number(value)) ? Number(value) : null
}

export function hydrateRateRows(entries: readonly RateEntry[]): RateRow[] {
  const legacyTypes: Record<string, string> = { SINGLE_PAANA: 'SINGLE_PANNA', DOUBLE_PAANA: 'DOUBLE_PANNA', TRIPLE_PAANA: 'TRIPLE_PANNA' }
  const byType = new Map(entries.map((entry) => [legacyTypes[entry.betType] ?? entry.betType, entry]))
  return BET_TYPES.map(({ key }) => {
    const entry = byType.get(key)
    return {
      betType: key,
      payoutMultiplier: Number(entry?.payoutMultiplier ?? 0),
      minOdds: entry?.minOdds ?? null,
      maxOdds: entry?.maxOdds ?? null,
    }
  })
}

export function defaultRatesInput(rows: readonly RateRow[]): RateEntry[] {
  return rows.filter(row => row.payoutMultiplier !== 0).map((row) => ({
    betType: row.betType,
    payoutMultiplier: Number(row.payoutMultiplier || 0),
    minOdds: row.minOdds ?? null,
    maxOdds: row.maxOdds ?? null,
  }))
}

export function initialBidRuleDraft(): BidRuleDraft {
  return { bidType: '', percentage: null, status: true, includeAll: true, includedPlayers: [] }
}

export function bidRuleError(draft: BidRuleDraft): string | null {
  if (!draft.bidType) return 'Please select bid type'
  if (draft.percentage === null || !Number.isFinite(draft.percentage)) return 'Please enter percentage'
  return null
}

export function bidRuleInput(matka: Pick<MatkaRecord, 'id' | 'name'> & { settings?: unknown }, draft: BidRuleDraft) {
  const playerIds = draft.includeAll ? [] : draft.includedPlayers
  return {
    matkaId: matka.id,
    // The market's own kind (the server keeps the market's kind whatever is sent).
    matkaType: String((matka.settings as { matkaType?: unknown } | null | undefined)?.matkaType || 'worli'),
    marketName: matka.name,
    marketSession: null,
    bidType: draft.bidType,
    percentage: Number(draft.percentage),
    includeAll: draft.includeAll,
    includedPlayers: playerIds.length ? { playerIds } : null,
    minStake: null,
    maxStake: null,
    exposureCap: null,
    status: draft.status ? 'active' : 'inactive',
    notes: draft.notes || null,
  }
}

/**
 * What a refused Matka mutation tells the operator: the server's own reason (the first GraphQL error), not a
 * catch-all. The mutation error link toasts nothing for mutations, so each page reports its own. A driver
 * error ("Failed query: <SQL> params: <values>") is never shown; the fallback stands in for it.
 */
export function matkaErrorText(error: unknown, fallback: string): string {
  const graphQLErrors = (error as { graphQLErrors?: Array<{ message?: unknown }> } | null)?.graphQLErrors
  const first = Array.isArray(graphQLErrors) ? graphQLErrors.find((entry) => typeof entry?.message === 'string' && entry.message) : undefined
  const message = typeof first?.message === 'string' ? first.message : error instanceof Error ? error.message : ''
  if (!message.trim() || /^Failed query|\bparams:/i.test(message)) return fallback
  return message
}

export function cloneVariables(matka: Pick<MatkaRecord, 'id' | 'name' | 'code'>) {
  return { id: matka.id, name: `${matka.name} Copy`, code: `${matka.code}-copy` }
}

