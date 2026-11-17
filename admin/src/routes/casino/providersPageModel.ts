/* Casino Providers (/casino/providers): the page's logic, kept free of React so it can be tested on its own.
   Every rule here is the legacy page's (ProvidersPage.tsx and the five routes/casino/components files it
   rendered, before Task 145), moved verbatim unless a comment says otherwise. */

import type { ProviderWithVendors } from '@/modules/casino/types'
import type { DataTableSort } from '@/ui/components/DataTable'
import type { DateRangePreset } from '@/ui/components/DateRangePanel'
import { istDayEnd, istDayStart } from '@/ui/components/istDate'

export const PAGE_TITLE = 'Casino Providers'
export const PAGE_SUB = 'Manage providers and vendor sharing configuration'

/** The games override list loads 20 games a page and appends each page as the list scrolls. */
export const GAME_PAGE_SIZE = 20

/* The legacy dashboard raised antd `message` toasts (3 s by default); the kit toasts keep that timing. */
export const MESSAGE_DURATION_MS = 3000

export interface Option {
  value: string
  label: string
}

/* ---------- roles ---------- */

/** "Super Admin", "super_admin", or any role naming both "super" and "admin" sees the per-whitelabel card. */
export function isSuperAdminRole(roles: readonly string[]): boolean {
  return roles.some((r) => {
    const roleLower = (r ?? '').toLowerCase()
    return r === 'Super Admin' || roleLower === 'super_admin' || (roleLower.includes('super') && roleLower.includes('admin'))
  })
}

/** A thrown value's message, or the fallback when it has none (`e?.message ?? fallback`, as the legacy handlers). */
export function messageOr(error: unknown, fallback: string): string {
  const message = (error as { message?: string } | null | undefined)?.message
  return message ?? fallback
}

/* ---------- options ---------- */

export function providerOptions(providers: readonly Pick<ProviderWithVendors, 'id' | 'name'>[]): Option[] {
  return providers.map((p) => ({ label: p.name, value: p.id }))
}

/** The breadcrumb's provider name: the chosen option's label, or '' when nothing (or nothing known) is chosen. */
export function selectedProviderLabel(options: readonly Option[], providerId: string | undefined): string {
  const opt = options.find((o) => o.value === providerId)
  return opt?.label || ''
}

/** The vendors of the provider the games list is filtered to; none until a provider is chosen. */
export function vendorOptionsFor(
  providers: readonly Pick<ProviderWithVendors, 'id' | 'vendors'>[],
  providerId: string | undefined,
): Option[] {
  if (!providerId) return []
  const p = providers.find((x) => x.id === providerId)
  return (p?.vendors ?? []).map((v: { id: string; name: string }) => ({ label: v.name, value: v.id }))
}

export function whitelabelOptions(whitelabels: readonly { id: string; name: string }[]): Option[] {
  return whitelabels.map((w) => ({ label: w.name, value: w.id }))
}

/* ---------- per-whitelabel visibility (Super Admin) ---------- */

export type OverrideTab = 'providers' | 'vendors' | 'games'

export const OVERRIDE_TABS: ReadonlyArray<{ value: OverrideTab; label: string }> = [
  { value: 'providers', label: 'Providers' },
  { value: 'vendors', label: 'Vendors' },
  { value: 'games', label: 'Games' },
]

export const VISIBILITY_TITLE = 'Per-whitelabel provider visibility'
export const VISIBILITY_HINT =
  'Select a whitelabel to enable or disable casino providers, vendors, or games for that brand.'

export interface ProviderSettingRow {
  id: string
  tenantId?: string | null
  providerId: number | string
  providerKey: string
  providerName: string
  enabled: boolean
  displayOrder?: number | null
}

export interface VendorOverrideRow {
  id: string
  tenantId?: string | null
  vendorId: number | string
  vendorName: string
  vendorSlug?: string | null
  providerId: number | string
  providerKey: string
  disabled: boolean
}

export interface GameOverrideRow {
  id: string
  tenantId?: string | null
  gameId: number | string
  gameName: string
  externalId?: string | null
  thumbnailUrl?: string | null
  vendorId?: number | string | null
  vendorName: string
  providerId?: number | string | null
  providerKey: string
  disabled: boolean
}

/** Name or key, case-insensitive; the search is trimmed, and a blank search keeps every row. */
export function filterProviderSettings(rows: readonly ProviderSettingRow[], search: string): readonly ProviderSettingRow[] {
  if (!search.trim()) return rows
  const q = search.trim().toLowerCase()
  return rows.filter(
    (r) => r.providerName?.toLowerCase().includes(q) || r.providerKey?.toLowerCase().includes(q),
  )
}

/** The provider filter first (ids compared as strings), then the trimmed vendor-name or provider-key search. */
export function filterVendorOverrides(
  rows: readonly VendorOverrideRow[],
  providerId: string | undefined,
  search: string,
): readonly VendorOverrideRow[] {
  let list = rows
  if (providerId) {
    list = list.filter((r) => String(r.providerId) === providerId)
  }
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    list = list.filter((r) => r.vendorName?.toLowerCase().includes(q) || r.providerKey?.toLowerCase().includes(q))
  }
  return list
}

/* The empty texts test the untrimmed search, as the legacy did. */
export function providerSettingsEmptyText(search: string): string {
  return search ? 'No providers match your search' : 'No providers'
}

export function vendorOverridesEmptyText(search: string, providerId: string | undefined): string {
  return search || providerId ? 'No vendors match filters' : 'No vendors'
}

export function gameOverridesEmptyText(search: string, providerId: string | undefined, vendorId: string | undefined): string {
  return search || providerId || vendorId
    ? 'No games match filters'
    : 'Select provider (and optionally vendor) to list games'
}

export function gameCountLabel(loaded: number, total: number): string {
  return `${loaded}${total > 0 ? ` of ${total}` : ''} games`
}

export function gameSubLine(row: Pick<GameOverrideRow, 'providerKey' | 'vendorName'>): string {
  return `${row.providerKey} • ${row.vendorName}`
}

/* New accessible name: the legacy switches had none. The column says what "on" means. */
export function overrideSwitchLabel(name: string): string {
  return `${name} disabled`
}

/** The legacy switches printed Yes / No inside their track; the kit prints it beside the track. */
export function yesNo(checked: boolean): 'Yes' | 'No' {
  return checked ? 'Yes' : 'No'
}

/* ---------- providers table ---------- */

export interface ProviderRow {
  id: string
  key: string
  name: string
  status: string
  lastSyncAt?: string
  vendorCount: number
  vendors: Array<{ id: string; name: string }>
}

export function toProviderRows(providers: readonly ProviderWithVendors[]): ProviderRow[] {
  return providers.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    status: p.status,
    lastSyncAt: p.lastSyncAt ?? undefined,
    vendorCount: p.vendors?.length ?? 0,
    vendors: p.vendors || [],
  }))
}

function compareValues(aVal: string | number, bVal: string | number): number {
  if (aVal < bVal) return -1
  if (aVal > bVal) return 1
  return 0
}

/* The legacy comparisons: names and statuses lower-cased, vendor counts as numbers. */
export const PROVIDER_COMPARATORS = {
  name: (a: ProviderRow, b: ProviderRow) => compareValues(a.name.toLowerCase(), b.name.toLowerCase()),
  status: (a: ProviderRow, b: ProviderRow) => compareValues(a.status.toLowerCase(), b.status.toLowerCase()),
  vendorCount: (a: ProviderRow, b: ProviderRow) => compareValues(a.vendorCount, b.vendorCount),
} as const

/**
 * The legacy headers sorted ascending on a first click and then flipped between ascending and descending; they
 * never cleared. The kit table asks for "no sort" after descending, which becomes ascending again here.
 */
export function legacySortCycle(current: DataTableSort | null, next: DataTableSort | null): DataTableSort | null {
  if (next) return next
  return current ? { key: current.key, dir: 'asc' } : null
}

export function providerCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'provider' : 'providers'}`
}

export const PROVIDER_STATUS_OPTIONS: readonly Option[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
]

/** A missing status reads as active; the select works in lower case. */
export function normaliseProviderStatus(status: string | null | undefined): string {
  return String(status || 'active').toLowerCase()
}

/**
 * The three statuses, plus the current one when the server sent another: antd showed an unknown value as its raw
 * text, while a native select would silently show the first option instead.
 */
export function providerStatusOptions(current: string): Option[] {
  return PROVIDER_STATUS_OPTIONS.some((o) => o.value === current)
    ? [...PROVIDER_STATUS_OPTIONS]
    : [...PROVIDER_STATUS_OPTIONS, { value: current, label: current }]
}

/**
 * The status as text, for anyone but the platform administrator: casino_api_providers has no whitelabel, so one
 * row serves every whitelabel and only `all:*` may change it (the server refuses everyone else).
 */
export function providerStatusLabel(status: string): string {
  return PROVIDER_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status
}

export const PROVIDER_STATUS_ERROR = 'Failed to update provider status'

export function providerStatusMessage(name: string, status: string): string {
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1)
  return `Provider "${name}" status updated to ${statusLabel}`
}

export function statusUpdateVariables(id: string, status: string): { id: string; input: { status: string } } {
  return { id, input: { status } }
}

/** The optimistic cache write: the one provider takes the new status. */
export function withProviderStatus<T extends { id: string; status: string }>(list: readonly T[], id: string, status: string): T[] {
  return list.map((p) => (p.id === id ? { ...p, status } : p))
}

export function vendorsSummary(vendors: readonly { id: string; name: string }[]) {
  const top = vendors.slice(0, 3)
  return {
    countLabel: `${vendors.length} vendor${vendors.length !== 1 ? 's' : ''}`,
    top,
    remaining: vendors.length - 3,
  }
}

export interface ProviderPerformance {
  totalGames: number
  activeGames: number
  vendorCount: number
}

export function providerPerformance(provider: ProviderWithVendors | undefined): ProviderPerformance {
  return {
    totalGames: provider?.vendorStats?.reduce((sum, vs) => sum + (vs.totalGames || 0), 0) ?? 0,
    activeGames: provider?.vendorStats?.reduce((sum, vs) => sum + (vs.activeGames || 0), 0) ?? 0,
    vendorCount: provider?.vendors?.length ?? 0,
  }
}

/* ---------- today's figures ---------- */

export type Trend = 'up' | 'down' | 'neutral'

/** The sign of a GGR figure, for its coloured dot: the house won, lost or broke even. */
export function ggrTrend(value: number): Trend {
  return value > 0 ? 'up' : value < 0 ? 'down' : 'neutral'
}

/* There is no "vs yesterday" figure. The legacy one divided today's GGR by a constant (10,000 for a provider,
   5,000 for a vendor) and called it a comparison, so it was removed rather than kept. */

export interface VendorBreakdownEntry {
  vendorId: string
  vendorName?: string | null
  ggr?: number | null
  shareAmount?: number | null
  transactionCount?: number | null
  /** The settled stakes in the range; absent when the query did not ask for them. */
  totalStake?: number | null
}

export function sumTransactions(breakdown: readonly VendorBreakdownEntry[]): number {
  return breakdown.reduce((sum: number, v) => sum + (v.transactionCount || 0), 0)
}

/* ---------- vendors table ---------- */

export interface VendorRow {
  id: string
  name: string
  slug: string
  providerId: string
  providerName: string
}

/** Every vendor of every provider, or of the chosen provider only. */
export function toVendorRows(providers: readonly ProviderWithVendors[], selectedProviderId: string | undefined): VendorRow[] {
  const allVendors: VendorRow[] = []
  providers.forEach((provider) => {
    if (selectedProviderId && provider.id !== selectedProviderId) return
    provider.vendors?.forEach((vendor) => {
      allVendors.push({
        id: vendor.id,
        name: vendor.name,
        slug: vendor.slug,
        providerId: provider.id,
        providerName: provider.name,
      })
    })
  })
  return allVendors
}

export const VENDOR_COMPARATORS = {
  name: (a: VendorRow, b: VendorRow) => compareValues(a.name.toLowerCase(), b.name.toLowerCase()),
  providerName: (a: VendorRow, b: VendorRow) => compareValues(a.providerName.toLowerCase(), b.providerName.toLowerCase()),
} as const

export function vendorRowKey(row: Pick<VendorRow, 'id' | 'providerId'>): string {
  return `${row.providerId}-${row.id}`
}

export function analyticsProviderIds(rows: readonly VendorRow[]): string[] {
  return [...new Set(rows.map((v) => v.providerId))]
}

export interface VendorAnalyticsData {
  ggr: number
  shareAmount: number
  transactionCount: number
  /** Null when the figures came without the stakes: the average bet is then not shown rather than guessed. */
  totalStake: number | null
}

/* A vendor missing from the batch had no settled bets in the range, so its stakes are a real 0. */
export const EMPTY_VENDOR_ANALYTICS: VendorAnalyticsData = { ggr: 0, shareAmount: 0, transactionCount: 0, totalStake: 0 }

export interface ProviderAnalyticsEntry {
  providerId?: string | number | null
  totalGGR?: number | null
  vendorBreakdown?: VendorBreakdownEntry[] | null
}

export function vendorAnalyticsKey(providerId: string, vendorId: string): string {
  return `${providerId}:${vendorId}`
}

/** One entry per provider and vendor, keyed `providerId:vendorId`; rows without both ids are skipped. */
export function vendorAnalyticsMap(list: readonly ProviderAnalyticsEntry[]): Map<string, VendorAnalyticsData> {
  const map = new Map<string, VendorAnalyticsData>()
  list.forEach((pa) => {
    const providerId = String(pa?.providerId ?? '')
    ;(pa?.vendorBreakdown ?? []).forEach((v) => {
      const vendorId = String(v?.vendorId ?? '')
      if (providerId && vendorId) {
        map.set(vendorAnalyticsKey(providerId, vendorId), {
          ggr: Number(v.ggr ?? 0),
          shareAmount: Number(v.shareAmount ?? 0),
          transactionCount: Number(v.transactionCount ?? 0),
          totalStake: v.totalStake != null ? Number(v.totalStake) : null,
        })
      }
    })
  })
  return map
}

export function vendorStatsFor(
  providers: readonly ProviderWithVendors[],
  providerId: string,
  vendorId: string,
): { totalGames?: number; activeGames?: number } | null {
  for (const provider of providers) {
    if (provider.id === providerId && provider.vendorStats) {
      const stats = provider.vendorStats.find((vs) => vs.vendorId === vendorId)
      if (stats) return stats
    }
  }
  return null
}

export function gamesLabel(count: number): string {
  return `${count} game${count !== 1 ? 's' : ''}`
}

export function vendorsCardSub(count: number, selectedProviderId: string | undefined, providerName: string | undefined): string {
  const counted = `${count} vendor${count !== 1 ? 's' : ''}`
  return selectedProviderId ? `${counted} for ${providerName ?? ''}` : `${counted} across all providers`
}

export function vendorsEmptyText(selectedProviderId: string | undefined): string {
  return selectedProviderId ? 'No vendors found for this provider' : 'No vendors found'
}

/**
 * The average stake of a settled bet, or null when the stakes are unknown or there were no bets. The legacy
 * figure was |GGR| / bets, which is no average bet (September: 89.04 against a true average stake of 5,539.62).
 */
export function avgBet(totalStake: number | null | undefined, transactionCount: number): number | null {
  return totalStake != null && transactionCount > 0 ? totalStake / transactionCount : null
}

/* ---------- statistics ---------- */

export interface ProviderStatsInput {
  id?: string
  status?: string
  vendors?: unknown[]
  vendorStats?: { activeGames?: number }[]
}

export interface ProviderStats {
  totalProviders: number
  activeProviders: number
  suspendedProviders: number
  totalVendors: number
  activeVendors: number
  activeRate: number
}

/** "Suspended" is every provider that is not ACTIVE; a vendor counts as active when it has an active game. */
export function providerStats(providers: readonly ProviderStatsInput[]): ProviderStats {
  const totalProviders = providers.length
  const activeProviders = providers.filter((p) => String(p.status ?? '').toUpperCase() === 'ACTIVE').length
  const suspendedProviders = totalProviders - activeProviders
  const totalVendors = providers.reduce((sum, p) => sum + (p.vendors?.length ?? 0), 0)
  const activeVendors = providers.reduce((sum, p) => {
    const activeVendorsInProvider = p.vendorStats?.filter((vs) => (vs.activeGames ?? 0) > 0).length ?? 0
    return sum + activeVendorsInProvider
  }, 0)
  const activeRate = totalProviders > 0 ? Math.round((activeProviders / totalProviders) * 100) : 0
  return { totalProviders, activeProviders, suspendedProviders, totalVendors, activeVendors, activeRate }
}

/* "Today's GGR" asks for the first provider only (legacy; listed for the owner). */
export function statsAnalyticsVariables(
  providerIds: readonly string[],
  start: string,
  end: string,
): { providerId: string; start: string; end: string } | undefined {
  return providerIds.length > 0 ? { providerId: providerIds[0], start, end } : undefined
}

/* ---------- vendor shares drawer ---------- */

export function shareDraft(
  vendors: readonly { id: string }[],
  shares: ReadonlyMap<string, number>,
): Record<string, number> {
  const draft: Record<string, number> = {}
  vendors.forEach((v) => {
    draft[v.id] = shares.get(v.id) ?? 0
  })
  return draft
}

export function totalShare(local: Readonly<Record<string, number>>): number {
  return Object.values(local).reduce((sum, val) => sum + Number(val), 0)
}

/** A change counts when any vendor moved by more than 0.01 percentage points. */
export function hasShareChanges(
  vendors: readonly { id: string }[],
  shares: ReadonlyMap<string, number>,
  local: Readonly<Record<string, number>>,
): boolean {
  return vendors.some((v) => {
    const original = shares.get(v.id) ?? 0
    const current = local[v.id] ?? 0
    return Math.abs(original - current) > 0.01
  })
}

export function configuredCount(local: Readonly<Record<string, number>>): number {
  return Object.values(local).filter((v) => v > 0).length
}

/** The legacy bar was green to 50%, amber to 80% and red beyond; the kit Meter has no green tone (accent instead). */
export function shareMeterTone(value: number): 'acc' | 'warn' | 'neg' {
  return value <= 50 ? 'acc' : value <= 80 ? 'warn' : 'neg'
}

/** The total's colour: red over 100%, amber over 80%, green otherwise. */
export function totalShareTone(total: number): 'neg' | 'warn' | 'pos' {
  return total > 100 ? 'neg' : total > 80 ? 'warn' : 'pos'
}

export function projectedShare(ggr: number, percentage: number): number {
  return ggr > 0 ? (ggr * percentage) / 100 : 0
}

/**
 * The field's value as the draft keeps it: empty is 0 (the legacy `Number(val || 0)`), and a decimal step's binary
 * artefact (0.1 + 0.2) is rounded away at 12 significant digits, as antd's decimal stepping never produced one.
 */
export function shareFromField(value: number | null): number {
  const n = Number(value || 0)
  return Number(n.toPrecision(12))
}

export function shareUpsertVariables(
  providerId: string,
  vendorId: string,
  percentage: number,
): { providerId: string; vendorId: string; sharePercentage: number } {
  return { providerId, vendorId, sharePercentage: Number(percentage) }
}

export const SHARES_SAVING = 'Saving vendor shares...'
export const SHARES_SAVED = 'Vendor shares saved'
export const SHARES_FAILED = 'Failed to save vendor shares'
/* antd message durations of the legacy save: 1.2 s on success, 2.5 s on failure. */
export const SHARES_SAVED_MS = 1200
export const SHARES_FAILED_MS = 2500

/* ---------- analytics drawer ---------- */

export type AnalyticsMode =
  | { type: 'provider'; providerId: string; title?: string }
  | { type: 'vendor'; providerId: string; vendorId: string; title?: string }

export function analyticsTitle(name: string): string {
  return `Analytics • ${name}`
}

export function analyticsDrawerTitle(mode: AnalyticsMode | null | undefined): string {
  return mode?.title || (mode?.type === 'vendor' ? 'Vendor Analytics' : 'Provider Analytics')
}

/** The legacy quick buttons: today, the last 7 and the last 30 days, each ending today (IST). */
export const ANALYTICS_PRESETS: readonly DateRangePreset[] = [
  { value: '1', label: 'Today' },
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: 'custom', label: 'Custom range' },
]

export const ANALYTICS_CUSTOM = 'custom'

export interface AnalyticsRange {
  preset: string
  /** IST calendar days, `yyyy-MM-dd`. */
  from: string
  to: string
}

/** A calendar day moved by n days (`yyyy-MM-dd` in and out; no time zone is involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function presetRange(preset: string, today: string): AnalyticsRange {
  const days = Number(preset)
  return { preset, from: addDays(today, -(days - 1)), to: today }
}

/** The instants the queries receive: the IST start of the first day and the IST end of the last. */
export function rangeVariables(range: Pick<AnalyticsRange, 'from' | 'to'>): { start: string; end: string } {
  return { start: istDayStart(range.from), end: istDayEnd(range.to) }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-07` → `Oct 07, 2026`, the legacy picker's "MMM DD, YYYY". */
export function formatRangeDay(day: string): string {
  const [y, m, d] = day.split('-')
  return `${MONTHS[Number(m) - 1] ?? m} ${d}, ${y}`
}

/** The range trigger's text: the preset (when one is applied) and the days it covers. */
export function rangeLabel(range: AnalyticsRange): string {
  const days = range.from === range.to ? formatRangeDay(range.from) : `${formatRangeDay(range.from)} – ${formatRangeDay(range.to)}`
  const preset = ANALYTICS_PRESETS.find((p) => p.value === range.preset && p.value !== ANALYTICS_CUSTOM)
  return preset ? `${preset.label} · ${days}` : days
}

export interface ProviderAnalyticsSummary {
  totalTransactions: number
  totalShare: number
  activeVendors: number
  vendorCount: number
  avgPerVendor: number
}

/** An active vendor took bets in the range; the legacy count was the vendors with a positive GGR. */
export function providerAnalyticsSummary(totalGGR: number, breakdown: readonly VendorBreakdownEntry[]): ProviderAnalyticsSummary {
  return {
    totalTransactions: sumTransactions(breakdown),
    totalShare: breakdown.reduce((sum: number, v) => sum + (v.shareAmount || 0), 0),
    activeVendors: breakdown.filter((v) => (v.transactionCount ?? 0) > 0).length,
    vendorCount: breakdown.length,
    avgPerVendor: breakdown.length > 0 ? totalGGR / breakdown.length : 0,
  }
}

/** Every vendor's |GGR| added up: the base a vendor's contribution is a share of. */
export function absoluteGgrTotal(breakdown: readonly VendorBreakdownEntry[]): number {
  return breakdown.reduce((sum: number, v) => sum + Math.abs(Number(v.ggr ?? 0)), 0)
}

/**
 * A vendor's signed share of the provider's result, out of every vendor's |GGR|; null when no vendor moved any
 * money. GGR nets the house's wins against its losses, so a share of the net total read 0% for every vendor when
 * the total was negative, and over 100% when it was small.
 */
export function contributionPercent(ggr: number, absoluteTotal: number): number | null {
  return absoluteTotal > 0 ? (ggr / absoluteTotal) * 100 : null
}

/* The headline figures carry no trend badge. The legacy badges were fixed numbers (12.5%, 8.3%, 15.2%, 10.8%)
   shown whatever the data, with no previous period behind them. */

/** Players are not tracked: 0 when there were no transactions, a dash otherwise. */
export function playersFigure(transactionCount: number): string {
  return transactionCount === 0 ? '0' : '—'
}

export function trendWord(trend: Trend): string {
  return trend === 'up' ? 'Up' : trend === 'down' ? 'Down' : 'No change'
}
