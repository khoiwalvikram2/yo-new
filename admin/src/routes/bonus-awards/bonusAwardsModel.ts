/* The page logic of /bonus-awards (Bonus cards), kept free of React so it can be tested on its own.
 * Every label, fallback and rule here is the legacy page's, moved out of BonusAwardsListPage.tsx and its
 * two components (pre-images in .backups/page-migration-2026-09-22/task-141). */
import type { BonusAwardsPageFiltersInput } from '@/lib/graphql/bonusAwardsPage'
import { istDayOf } from '@/ui/components/istDate'

/* ---------- rows ---------- */

export type BonusAwardRow = {
  id: string
  campaignId: number
  campaignName: string
  userId: number
  userName: string | null
  userPhone: string | null
  domain: string
  type: string
  amount: number
  currency: string
  wageringReq: number
  currentWagering: number
  status: string
  awardedAt: string
  /** ISO from campaign expiry days + awarded at, when campaign has expiry bonus days */
  expiresAt?: string | null
  completedAt: string | null
  triggerAmount: number | null
  firstDepositRequired: boolean | null
  firstDepositUnlocked: boolean | null
  distributionType: string | null
  statusUpdatedAt?: string | null
  statusUpdatedByName?: string | null
  statusUpdatedByPhone?: string | null
  statusUpdatedByRemark?: string | null
}

/** The table columns, in the legacy order. The Actions column is the table's row-actions cell. */
export const BONUS_AWARD_COLUMNS = [
  'ID',
  'Campaign',
  'Player',
  'Domain',
  'Type',
  'Amount',
  'Wagering',
  'Wagering progress',
  'Status',
  'Changed by',
  'Actor phone',
  'Remark',
  'Status at',
  'Awarded',
  'Expires',
  'Details',
] as const

/** Percent complete toward wagering requirement; null if no requirement. */
export function wageringProgressPercent(current: number, required: number): number | null {
  const req = Number(required)
  if (!Number.isFinite(req) || req <= 0) return null
  const cur = Number(current)
  if (!Number.isFinite(cur) || cur <= 0) return 0
  return Math.min(100, Math.round((cur / req) * 1000) / 10)
}

/** One side of the legacy "current / required" wagering figure. */
export function formatWageringAmount(value: number): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** The legacy cell read `current / required`. */
export function formatWageringPair(current: number, required: number): string {
  return `${formatWageringAmount(current)} / ${formatWageringAmount(required)}`
}

/** The legacy tag capitalised the raw status with CSS; the label now carries the capital itself. */
export function bonusAwardStatusLabel(status: string): string {
  if (!status) return status
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function bonusAwardPlayerName(row: Pick<BonusAwardRow, 'userName' | 'userId'>): string {
  return row.userName || `User ${row.userId}`
}

export function bonusAwardPlayerContact(row: Pick<BonusAwardRow, 'userPhone' | 'userId'>): string {
  return row.userPhone || `ID ${row.userId}`
}

/** Which actions a row offers to a caller who may change bonus status. */
export type BonusAwardRowActionKind = 'pending' | 'active' | 'none'

export function bonusAwardRowActionKind(status: string): BonusAwardRowActionKind {
  if (status === 'pending') return 'pending'
  if (status === 'active') return 'active'
  return 'none'
}

/* ---------- filters ---------- */

export type BonusAwardsListFiltersState = {
  dateFrom: string
  dateTo: string
  status?: string[]
  domain: string
  playerSearch?: string
  agentUsername?: string
  campaignId?: number
}

export const BONUS_AWARD_STATUS_OPTIONS = ['pending', 'active', 'completed', 'expired', 'cancelled'] as const

export const BONUS_AWARD_DOMAIN_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'global', label: 'Global' },
  { value: 'sports', label: 'Sports' },
  { value: 'casino', label: 'Casino' },
  { value: 'matka', label: 'Matka' },
]

export type BonusAwardsDatePreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'custom'

export const BONUS_AWARDS_DATE_PRESETS: ReadonlyArray<{ value: BonusAwardsDatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 Days' },
  { value: 'last30days', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom Range' },
]

export interface BonusAwardsDateRange {
  from: string
  to: string
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** A `yyyy-MM-dd` calendar day moved by whole days (calendar arithmetic, no time zone involved). */
export function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const moved = new Date(Date.UTC(year, month - 1, date + days))
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`
}

/** Today in IST as `yyyy-MM-dd`, the legacy `todayISTString()` / `nowIST().format('YYYY-MM-DD')`. */
export function bonusAwardsToday(now: Date = new Date()): string {
  return istDayOf(now)
}

/** Today in IST for both ends and no domain: the legacy initial state and Clear all. */
export function initialBonusAwardsFilters(now: Date = new Date()): BonusAwardsListFiltersState {
  const t = bonusAwardsToday(now)
  return { dateFrom: t, dateTo: t, domain: '' }
}

/**
 * The legacy preset windows, inclusive IST calendar days: Last 7 Days is today and the six days before
 * it, Last 30 Days today and the 29 before. Custom applies nothing by itself (null).
 */
export function getBonusAwardsRangeForPreset(
  preset: BonusAwardsDatePreset,
  now: Date = new Date(),
): BonusAwardsDateRange | null {
  const today = bonusAwardsToday(now)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const yesterday = shiftDay(today, -1)
      return { from: yesterday, to: yesterday }
    }
    case 'last7days':
      return { from: shiftDay(today, -6), to: today }
    case 'last30days':
      return { from: shiftDay(today, -29), to: today }
    default:
      return null
  }
}

/** The preset a controlled range matches, or Custom Range. */
export function getBonusAwardsPresetFromRange(
  from: string,
  to: string,
  now: Date = new Date(),
): BonusAwardsDatePreset {
  const presets: readonly Exclude<BonusAwardsDatePreset, 'custom'>[] = [
    'today',
    'yesterday',
    'last7days',
    'last30days',
  ]
  for (const preset of presets) {
    const range = getBonusAwardsRangeForPreset(preset, now)
    if (range?.from === from && range.to === to) return preset
  }
  return 'custom'
}

/** The filters sent to both list queries, exactly as the legacy page built them. */
export function buildBonusAwardsFiltersPayload(
  listFilters: BonusAwardsListFiltersState,
  isAgent: boolean,
): BonusAwardsPageFiltersInput {
  return {
    dateFrom: listFilters.dateFrom,
    dateTo: listFilters.dateTo,
    status: listFilters.status?.length ? [...listFilters.status] : undefined,
    domain: listFilters.domain || undefined,
    playerSearch: listFilters.playerSearch?.trim() || undefined,
    agentUsername:
      !isAgent && listFilters.agentUsername?.trim() ? listFilters.agentUsername.trim() : undefined,
    campaignId: isAgent ? undefined : listFilters.campaignId,
  }
}

/** The legacy badge count: every chosen status counts, and the date range counts when it is not today. */
export function countActiveBonusAwardFilters(
  filters: BonusAwardsListFiltersState,
  isAgent: boolean,
  today: string,
): number {
  const hasNonDefaultDate = filters.dateFrom !== today || filters.dateTo !== today
  return (
    (filters.status?.length ?? 0) +
    (filters.domain ? 1 : 0) +
    (!isAgent && filters.campaignId != null ? 1 : 0) +
    (filters.playerSearch ? 1 : 0) +
    (!isAgent && filters.agentUsername ? 1 : 0) +
    (hasNonDefaultDate ? 1 : 0)
  )
}

/** A lookup's empty text: the legacy `notFoundContent` once loading is ruled out. */
export function lookupEmptyText(query: string, noun: 'agents' | 'players'): string {
  return query.trim().length < 2 ? 'Type 2+ letters' : `No ${noun}`
}

export interface LookupOption {
  value: string
  label: string
}

/** `Name (#id)`, valued by the numeric id the filter sends. */
export function toCampaignOptions(campaigns: ReadonlyArray<{ id: string; name: string }> | null | undefined): LookupOption[] {
  return (campaigns ?? []).map((c) => ({
    value: String(Number(c.id)),
    label: `${c.name} (#${c.id})`,
  }))
}

export function toAgentOptions(agents: ReadonlyArray<{ id: string; username: string }> | null | undefined): LookupOption[] {
  return (agents ?? []).map((a) => ({
    label: a.username,
    value: a.username,
  }))
}

export function toPlayerOptions(
  players: ReadonlyArray<{ id: number; username?: string; name?: string; phone?: string }> | null | undefined,
): LookupOption[] {
  return (players ?? []).map((p) => {
    const label = [p.username || p.name || `User ${p.id}`, p.phone ? `(${p.phone})` : ''].filter(Boolean).join(' ')
    const value = (p.username || p.name || String(p.id)).trim() || String(p.id)
    return { label, value }
  })
}

/* ---------- paging ---------- */

/** The offset to use once the server total is known: back to 0 when there are none, else at most the last page. */
export function clampBonusAwardsOffset(total: number, limit: number, offset: number): number {
  if (limit <= 0) return offset
  if (total === 0) return 0
  const lastPageIndex = Math.max(0, Math.ceil(total / limit) - 1)
  const maxOffset = lastPageIndex * limit
  return offset > maxOffset ? maxOffset : offset
}

/* ---------- remark dialog ---------- */

export type BonusRemarkModalState =
  | { mode: 'setStatus'; awardId: string; nextStatus: 'cancelled' | 'expired' }
  | { mode: 'activate'; row: BonusAwardRow }
  | { mode: 'switch'; row: BonusAwardRow }
  | { mode: 'forfeit'; row: BonusAwardRow }

export interface BonusRemarkModalMeta {
  title: string
  description: string
  okText: string
  danger: boolean
}

export function bonusRemarkModalMeta(remarkModal: BonusRemarkModalState): BonusRemarkModalMeta {
  if (remarkModal.mode === 'setStatus') {
    if (remarkModal.nextStatus === 'cancelled') {
      return {
        title: 'Cancel (revoke) this bonus card?',
        description:
          'The pending bonus will be cancelled. No wallet amount is removed (card was not active yet).',
        okText: 'Confirm',
        danger: true,
      }
    }
    return {
      title: 'Mark this bonus expired?',
      description: 'The pending bonus will be marked as expired.',
      okText: 'Confirm',
      danger: false,
    }
  }
  if (remarkModal.mode === 'activate') {
    return {
      title: 'Activate this bonus card?',
      description:
        'This runs the same activation rules as the user app (first deposit, expiry, wallet credit).',
      okText: 'Activate',
      danger: false,
    }
  }
  if (remarkModal.mode === 'forfeit') {
    return {
      title: 'Forfeit this active bonus?',
      description:
        'The player’s bonus wallet balance will be cleared to zero and this card will be marked cancelled — same as the player app “Forfeit” action.',
      okText: 'Forfeit bonus',
      danger: true,
    }
  }
  return {
    title: 'Switch to this bonus?',
    description:
      'The current active bonus will be cancelled and the bonus wallet balance cleared, then this card will be activated.',
    okText: 'Switch bonus',
    danger: true,
  }
}

export const SWITCH_BONUS_WARNING =
  'Another bonus is already active for this player. This cancels it and activates this card.'
export const REMARK_LABEL = 'Remark (required)'
export const REMARK_PLACEHOLDER = 'Internal note — appears in the Remark column on Bonus cards'
export const REMARK_MAX_LENGTH = 500
export const REMARK_REQUIRED_TITLE = 'Remark required'
export const REMARK_REQUIRED_MESSAGE = 'Please enter a remark before confirming this action.'

/** The four mutations' shared payload shape (setBonusAwardStatus has no code). */
export interface BonusAwardMutationPayload {
  success?: boolean | null
  message?: string | null
  code?: string | null
}

export type BonusRemarkOutcome =
  | { kind: 'success'; message: string }
  | { kind: 'switch' }
  | { kind: 'error'; title: string; message: string }
  | { kind: 'none' }

const SUCCESS_FALLBACK: Record<BonusRemarkModalState['mode'], string> = {
  setStatus: 'Updated',
  activate: 'Bonus activated',
  switch: 'Bonus switched',
  forfeit: 'Bonus forfeited',
}

const ERROR_TITLE: Record<BonusRemarkModalState['mode'], string> = {
  setStatus: 'Bonus card',
  activate: 'Activate bonus',
  switch: 'Switch bonus',
  forfeit: 'Forfeit bonus',
}

/**
 * What the dialog does with a mutation's answer, as the legacy handler did: success closes it with the
 * server message (or the fallback); an activation refused with ALREADY_ACTIVE_BONUS turns it into the
 * switch dialog; any other refusal with a message raises an error and keeps it open; a refusal without a
 * message does nothing.
 */
export function resolveBonusRemarkOutcome(
  mode: BonusRemarkModalState['mode'],
  payload: BonusAwardMutationPayload | null | undefined,
): BonusRemarkOutcome {
  if (payload?.success) {
    return { kind: 'success', message: payload.message ?? SUCCESS_FALLBACK[mode] }
  }
  if (mode === 'activate' && payload?.code === 'ALREADY_ACTIVE_BONUS') return { kind: 'switch' }
  if (payload?.message) return { kind: 'error', title: ERROR_TITLE[mode], message: payload.message }
  return { kind: 'none' }
}

/** The thrown-error toast text: the error's own message, else the legacy fallback. */
export function requestErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

/* ---------- stats ---------- */

/** The decorative tile hue each legacy card colour maps to (the kit has no grey step; grey takes indigo). */
export type BonusStatHue = 'ind' | 'red' | 'grn' | 'vio' | 'blu' | 'amb'

export interface BonusStatDef {
  key: string
  label: string
  value: string
  note?: string
  hue: BonusStatHue
}

export interface BonusKpis {
  totalIssued?: number | string | null
  totalRedeemed?: number | string | null
  totalExpired?: number | string | null
  totalCancelled?: number | string | null
  outstandingLiability?: number | string | null
  totalWagering?: number | string | null
  totalRevenue?: number | string | null
  awardCount?: number | null
  redemptionCount?: number | null
  playerCount?: number | null
  roi?: number | string | null
}

export interface BonusAwardsPageStats {
  total?: number | null
  pending?: number | null
  active?: number | null
  completed?: number | null
  expired?: number | null
  cancelled?: number | null
  totalBonusPaid?: number | null
  bonusWalletTotal?: number | null
  wageringRemaining?: number | null
  bonusUses?: number | null
  bonusToCashTransferred?: number | null
}

type FormatAmount = (amount: number, currency?: string) => string

/** Revenue ÷ issued as a percentage with two decimals; '0.00' without KPIs. */
export function bonusRoiPercent(k: BonusKpis | null | undefined): string {
  return k != null && Number.isFinite(Number(k.roi)) ? (Number(k.roi) * 100).toFixed(2) : '0.00'
}

/** The whitelabel-wide ledger cards, in the legacy order with the legacy copy. */
export function buildLedgerStats(
  k: BonusKpis | null | undefined,
  formatAmount: FormatAmount,
  displayCurrency: string,
): BonusStatDef[] {
  return [
    {
      key: 'bonusRevenue',
      label: 'Bonus revenue (GGR)',
      value: formatAmount(Number(k?.totalRevenue) || 0, displayCurrency),
      note: 'Expired + cancelled bonuses (date range)',
      hue: 'grn',
    },
    {
      key: 'bonusWagering',
      label: 'Bonus wagering (stakes)',
      value: formatAmount(Number(k?.totalWagering) || 0, displayCurrency),
      note: 'Turnover attributed to bonus activity',
      hue: 'blu',
    },
    {
      key: 'totalIssued',
      label: 'Total issued',
      value: formatAmount(Number(k?.totalIssued) || 0, displayCurrency),
      note: 'Bonus amounts issued in period',
      hue: 'vio',
    },
    {
      key: 'totalRedeemedLedger',
      label: 'Total redeemed',
      value: formatAmount(Number(k?.totalRedeemed) || 0, displayCurrency),
      note: 'Completed bonus amounts (awarded in range)',
      hue: 'grn',
    },
    {
      key: 'outstandingLiability',
      label: 'Outstanding liability',
      value: formatAmount(Number(k?.outstandingLiability) || 0, displayCurrency),
      note: 'Pending + active bonus amounts',
      hue: 'red',
    },
    {
      key: 'bonusRoi',
      label: 'Bonus ROI',
      value: `${bonusRoiPercent(k)}%`,
      note: 'Revenue ÷ issued (date range)',
      hue: 'ind',
    },
    {
      key: 'totalExpired',
      label: 'Expired',
      value: formatAmount(Number(k?.totalExpired) || 0, displayCurrency),
      note: 'Bonus amounts expired in period',
      hue: 'ind',
    },
    {
      key: 'totalCancelledLedger',
      label: 'Cancelled',
      value: formatAmount(Number(k?.totalCancelled) || 0, displayCurrency),
      note: 'Bonus amounts cancelled in period',
      hue: 'red',
    },
    {
      key: 'awardRedemptionCounts',
      label: 'Award / redemption events',
      value: `${(k?.awardCount ?? 0).toLocaleString()} / ${(k?.redemptionCount ?? 0).toLocaleString()}`,
      note: 'Total awards / completed redemptions',
      hue: 'vio',
    },
    {
      key: 'ledgerPlayerCount',
      label: 'Players',
      value: (k?.playerCount ?? 0).toLocaleString(),
      note: 'Distinct players with bonus awards in range',
      hue: 'blu',
    },
  ]
}

/** The filtered-list cards, in the legacy order with the legacy copy. */
export function buildCardStats(
  s: BonusAwardsPageStats | null | undefined,
  formatAmount: FormatAmount,
  displayCurrency: string,
): BonusStatDef[] {
  return [
    {
      key: 'totalBonusPaid',
      label: 'Total bonus paid',
      value: formatAmount(s?.totalBonusPaid ?? 0, displayCurrency),
      note: 'Award amounts — active + completed cards (filtered)',
      hue: 'grn',
    },
    {
      key: 'bonusWallet',
      label: 'Bonus dues',
      value: formatAmount(s?.bonusWalletTotal ?? 0, displayCurrency),
      note: 'Sum of bonus wallet balances for players in this scope',
      hue: 'blu',
    },
    {
      key: 'wageringRemaining',
      label: 'Wagering left to complete',
      value: formatAmount(s?.wageringRemaining ?? 0, displayCurrency),
      note: 'Active cards only: remaining wagering (req − progress), same filters as table',
      hue: 'red',
    },
    {
      key: 'bonusToCash',
      label: 'Bonus → cash transferred',
      value: formatAmount(s?.bonusToCashTransferred ?? 0, displayCurrency),
      note: 'Cash credits from bonus → cash for cards matching filters (same awarded-date scope as the table)',
      hue: 'ind',
    },
    {
      key: 'bonusUses',
      label: 'Bonus uses',
      value: (s?.bonusUses ?? 0).toLocaleString(),
      note: 'Cards active or completed',
      hue: 'vio',
    },
    { key: 'total', label: 'Total cards', value: (s?.total ?? 0).toLocaleString(), hue: 'blu' },
    { key: 'pending', label: 'Pending', value: (s?.pending ?? 0).toLocaleString(), hue: 'amb' },
    { key: 'active', label: 'Active', value: (s?.active ?? 0).toLocaleString(), hue: 'grn' },
    { key: 'completed', label: 'Completed', value: (s?.completed ?? 0).toLocaleString(), hue: 'vio' },
    { key: 'expired', label: 'Expired', value: (s?.expired ?? 0).toLocaleString(), hue: 'ind' },
    { key: 'cancelled', label: 'Cancelled', value: (s?.cancelled ?? 0).toLocaleString(), hue: 'red' },
  ]
}
