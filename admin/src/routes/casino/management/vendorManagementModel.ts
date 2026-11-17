/* Casino Vendor Management (/casino/vendors): the page's logic, kept free of React so it can be tested on
   its own. Every rule here is the legacy page's (VendorManagementPage.tsx before Task 144), moved verbatim
   unless a comment says otherwise. */

export type VendorCategory = 'LIVE_CASINO' | 'CASINO' | 'SLOTS'

export interface VendorWithSettings {
  id: string
  name: string
  slug: string
  enabled: boolean | null
  gamesCount: number
  enabledGamesCount: number
  displayOrder: number | null
}

export interface CasinoApiProvider {
  id: string
  key?: string | null
  name: string
  status?: string | null
  lastSyncAt?: string | null
}

export interface CasinoVendorsWithSettingsData {
  casinoVendorsWithSettings?: VendorWithSettings[] | null
}

export interface CasinoApiProvidersData {
  casinoApiProviders?: CasinoApiProvider[] | null
}

export interface VendorMutationPayload {
  success: boolean
  message?: string | null
}

export interface ToggleCasinoVendorEnabledData {
  toggleCasinoVendorEnabled?: VendorMutationPayload | null
}

export interface BulkUpdateVendorSettingsData {
  bulkUpdateVendorSettings?: VendorMutationPayload | null
}

export interface VendorStats {
  total: number
  enabled: number
  disabled: number
}

export interface SelectAllState {
  checked: boolean
  indeterminate: boolean
}

export interface BulkConfirmCopy {
  title: string
  confirmLabel: string
  cancelLabel: string
}

export const PAGE_TITLE = 'Casino Vendor Management'
export const PAGE_SUB = 'Manage vendors and their game configurations'

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 20

/* The legacy page raised antd notifications (4.5 s by default) and one antd message (3 s by default);
   the kit toasts keep those timings, as shared/services/notification.ts does. */
export const NOTIFICATION_DURATION_MS = 4500
export const MESSAGE_DURATION_MS = 3000

export const TOGGLE_ERROR_FALLBACK = 'Failed to update vendor'
export const BULK_ERROR_FALLBACK = 'Failed to update vendors'

export const CATEGORY_OPTIONS: ReadonlyArray<{ value: VendorCategory; label: string }> = [
  { value: 'LIVE_CASINO', label: 'Live Casino' },
  { value: 'CASINO', label: 'Casino' },
  { value: 'SLOTS', label: 'Slots' },
]

/* The legacy selects were placeholder-only with a clear button; their placeholder is now the option that
   clears the filter, so the unfiltered state reads exactly as before. */
export const PROVIDER_PLACEHOLDER = 'Filter by Provider'
export const CATEGORY_PLACEHOLDER = 'Filter by Category'

/** A role naming a whitelabel or a tenant marks a whitelabel admin, who sees no provider filter. */
export function isWhitelabelAdminRoles(roles: readonly string[] | null | undefined): boolean {
  return Boolean(
    roles?.some((r: string) => r.toLowerCase().includes('whitelabel') || r.toLowerCase().includes('tenant')),
  )
}

export function isVendorCategory(value: string): value is VendorCategory {
  return CATEGORY_OPTIONS.some((option) => option.value === value)
}

export function providerOptions(providers: readonly CasinoApiProvider[]): Array<{ value: string; label: string }> {
  return providers.map((p) => ({ value: p.id, label: p.name }))
}

/** Name or slug, case-insensitive, untrimmed: the legacy local search. */
export function filterVendors(vendors: readonly VendorWithSettings[], searchText: string): VendorWithSettings[] {
  if (!searchText) return [...vendors]
  const searchLower = searchText.toLowerCase()
  return vendors.filter(
    (v) => v.name.toLowerCase().includes(searchLower) || v.slug.toLowerCase().includes(searchLower),
  )
}

/** By default (null) a vendor counts as enabled. */
export function isVendorEnabled(enabled: boolean | null | undefined): boolean {
  return enabled !== false
}

export function vendorStatusLabel(enabled: boolean | null | undefined): 'Enabled' | 'Disabled' {
  return enabled === false ? 'Disabled' : 'Enabled'
}

/* Core mode (a Super Admin with no whitelabel selected) reads every whitelabel at once: a vendor's
   enabled flag and enabled-game count belong to one whitelabel and come back empty, and the switches
   would write the pseudo-whitelabel "default". The server refuses those writes, and the page offers
   none of them there. */
export const CORE_MODE_VENDOR_HINT =
  'Core mode lists every vendor on the platform. Select a whitelabel in the top bar to switch vendors on or off for it.'

/** The vendors' total games, the one per-vendor figure that is not a whitelabel setting. */
export function totalVendorGames(vendors: readonly VendorWithSettings[]): number {
  return vendors.reduce((sum, v) => sum + (Number(v.gamesCount) || 0), 0)
}

/** Counted over every vendor the query returned, not the searched subset. */
export function vendorStats(vendors: readonly VendorWithSettings[]): VendorStats {
  const total = vendors.length
  const enabled = vendors.filter((v) => v.enabled !== false).length
  const disabled = vendors.filter((v) => v.enabled === false).length
  return { total, enabled, disabled }
}

export function vendorCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'vendor' : 'vendors'}`
}

/* ---------- selection (kept in the order the boxes were ticked, as the legacy array was) ---------- */

export function toggleVendorSelection(selected: readonly string[], vendorId: string, checked: boolean): string[] {
  if (checked) return selected.includes(vendorId) ? [...selected] : [...selected, vendorId]
  return selected.filter((k) => k !== vendorId)
}

/** The header box selects every vendor the search leaves (on every page), and clears the whole selection. */
export function toggleAllVendors(filtered: readonly VendorWithSettings[], checked: boolean): string[] {
  return checked ? filtered.map((v) => v.id) : []
}

export function selectAllState(filtered: readonly VendorWithSettings[], selected: readonly string[]): SelectAllState {
  const some = filtered.some((v) => selected.includes(v.id))
  const every = filtered.every((v) => selected.includes(v.id))
  return {
    checked: filtered.length > 0 && every,
    indeterminate: some && !every,
  }
}

/* ---------- mutations ---------- */

export function buildToggleVariables(vendorId: string, enabled: boolean): { vendorId: string; enabled: boolean } {
  return { vendorId, enabled }
}

export function buildBulkVariables(
  selected: readonly string[],
  enabled: boolean,
): { vendorIds: string[]; enabled: boolean } {
  return { vendorIds: selected.map(String), enabled }
}

export function mutationErrorMessage(error: { message?: string } | null | undefined, fallback: string): string {
  return error?.message || fallback
}

export function bulkConfirmCopy(enabled: boolean): BulkConfirmCopy {
  return {
    title: enabled ? 'Enable selected vendors?' : 'Disable selected vendors?',
    confirmLabel: 'Yes',
    cancelLabel: 'No',
  }
}

export function bulkEmptySelectionWarning(enabled: boolean): string {
  return enabled ? 'Please select vendors to enable' : 'Please select vendors to disable'
}

export function bulkButtonLabel(enabled: boolean, count: number): string {
  return `${enabled ? 'Enable' : 'Disable'} Selected (${count})`
}

/** The row action flips the current state: a disabled vendor is enabled, any other is disabled. */
export function rowToggleTarget(enabled: boolean | null | undefined): boolean {
  return enabled === false
}

/* New accessible names: the legacy switch and the icon-only toggle had none. */
export function statusSwitchLabel(name: string): string {
  return `${name} enabled`
}

export function rowToggleLabel(name: string, enabled: boolean | null | undefined): string {
  return `${rowToggleTarget(enabled) ? 'Enable' : 'Disable'} ${name}`
}

/* ---------- filters and paging ---------- */

export function countVendorFilters(
  searchText: string,
  providerId: string | undefined,
  category: VendorCategory | undefined,
): number {
  return Number(searchText !== '') + Number(Boolean(providerId)) + Number(Boolean(category))
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
}

/** A page left past the end (the search or a filter shrank the list) shows the last page instead. */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), pageCount(total, pageSize))
}

export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = (clampPage(page, rows.length, pageSize) - 1) * pageSize
  return rows.slice(start, start + pageSize)
}
