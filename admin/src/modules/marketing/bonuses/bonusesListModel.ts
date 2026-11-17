import type { TableExportColumn } from '@/shared/utils/tableExport'
import { OFFERED_BONUS_TYPES } from './bonusCreateModel'

/* The pure model behind /bonuses (W6 Task 170). The legacy antd page and its three components
 * (pre-images in .backups/page-migration-2026-09-22/task-170) are the contract: the query variables,
 * filter lists, cell rules, statistics, export columns and every piece of copy here are transcribed
 * from them. It holds no React. */

export interface BonusCampaignRow {
  id: string
  name: string
  domain: string
  type: string
  status: string
  budgetNumeric?: number | string | null
  currency: string
  validFrom?: string | null
  validTo?: string | null
  createdAt?: string | null
  directSubType?: string | null
  depositConditionType?: string | null
  depositConditionAmount?: number | null
  distributionType?: string | null
  amountType?: string | null
  amount?: number | null
  percentage?: number | null
  numberOfPlayers?: number | null
  usagePerPlayer?: number | null
  startDate?: string | null
  endDate?: string | null
  wagering?: number | null
  distributedAt?: string | null
}

export interface BonusListFilters {
  search: string
  status: string
  domain: string
  type: string
}

export const EMPTY_BONUS_FILTERS: BonusListFilters = { search: '', status: '', domain: '', type: '' }

/** The legacy memoised variables, key for key: an unset filter is left out, the search is trimmed. */
export function buildBonusCampaignsVariables(filters: BonusListFilters): Record<string, string> {
  const vars: Record<string, string> = {}
  if (filters.status) vars.status = filters.status.toLowerCase() // GraphQL enum expects lowercase: draft, active, paused, ended
  if (filters.domain) vars.domain = filters.domain.toLowerCase() // GraphQL enum expects lowercase: sports, casino, matka, global
  if (filters.type) vars.type = filters.type
  if (filters.search && filters.search.trim().length > 0) vars.search = filters.search.trim()
  return vars
}

/** The legacy badge: each set filter counts once, the raw (untrimmed) search included. */
export function activeBonusFilterCount(filters: BonusListFilters): number {
  return [filters.search, filters.status, filters.domain, filters.type].filter(Boolean).length
}

export interface FilterOption {
  value: string
  label: string
}

/* The legacy option lists in their legacy order. The native select's empty choice replaces antd's
   placeholder-plus-clear (`Status`, `Domain`, `Type`). */
export const STATUS_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: '', label: 'All statuses' },
  { label: 'Draft', value: 'draft' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Ended', value: 'ended' },
]

export const DOMAIN_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: '', label: 'All domains' },
  { label: 'Sports', value: 'sports' },
  { label: 'Casino', value: 'casino' },
  { label: 'Matka', value: 'matka' },
  { label: 'Global', value: 'global' },
]

/* Every type the create form offers, labelled as the table labels it (MAR-03). The legacy list was
   hard-coded and left out First Day First Time Deposit, Losing Bonus and Special Bonus, while
   offering Referral Deposit, which the form never creates. */
export const TYPE_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: '', label: 'All types' },
  ...OFFERED_BONUS_TYPES.map((type) => ({ value: type, label: formatBonusType(type) })),
]

export interface PageSlice<T> {
  rows: T[]
  page: number
}

/**
 * Client-side paging over the whole list, as before. A page past the end (a filter or a delete
 * shrank the list) is clamped to the last page, which is the page the kit Pagination shows.
 */
export function bonusPageSlice<T>(rows: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const size = Math.max(1, Math.trunc(pageSize) || 1)
  const lastPage = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), lastPage)
  const start = (current - 1) * size
  return { rows: rows.slice(start, start + size), page: current }
}

export interface BonusCampaignStats {
  total: number
  active: number
  /** Active by status but past their end date: players can no longer use them (MAR-18). */
  expired: number
  draft: number
  paused: number
  totalBudget: number
  activeRate: number
}

type CampaignItem = { status?: string; budgetNumeric?: string | number | null; endDate?: string | null }

/**
 * Whether a campaign is active by status but past its end date. Nothing moves such a campaign to
 * ended (only End does), while the player side already treats it as over, so the list read it as
 * live (MAR-18). `now` is a parameter so the rule is testable.
 */
export function isPastEnd(campaign: { status?: string; endDate?: string | null }, now: number = Date.now()): boolean {
  if (campaign.status !== 'active' || !campaign.endDate) return false
  const end = Date.parse(campaign.endDate)
  return Number.isFinite(end) && end < now
}

/** The legacy StatsCards arithmetic, except that Active counts only campaigns still running. */
export function bonusCampaignStats(campaigns: readonly CampaignItem[], now: number = Date.now()): BonusCampaignStats {
  const total = campaigns.length
  const expired = campaigns.filter((c) => isPastEnd(c, now)).length
  const active = campaigns.filter((c) => c.status === 'active').length - expired
  const draft = campaigns.filter((c) => c.status === 'draft').length
  const paused = campaigns.filter((c) => c.status === 'paused').length

  const totalBudget = campaigns.reduce((sum, c) => sum + Number(c.budgetNumeric || 0), 0)
  const activeRate = total > 0 ? Math.round((active / total) * 100) : 0

  return { total, active, expired, draft, paused, totalBudget, activeRate }
}

/** The Active card's note; campaigns past their end date are named rather than counted as active. */
export function activeShareNote(stats: BonusCampaignStats): string {
  return stats.expired > 0
    ? `${stats.expired} past end date, ${stats.total} total`
    : `${stats.active} campaigns, ${stats.total} total`
}

export function pausedShareNote(stats: BonusCampaignStats): string {
  return stats.total > 0 ? `${Math.round((stats.paused / stats.total) * 100)}% of total` : '—'
}

export type BonusStatusKey = 'active' | 'draft' | 'paused' | 'ended' | 'expired'

/** The legacy tag: Active, Draft and Paused by name; every other status read as Ended. */
export function bonusStatusKey(status: string): BonusStatusKey {
  if (status === 'active' || status === 'draft' || status === 'paused') return status
  return 'ended'
}

const STATUS_LABELS: Record<BonusStatusKey, string> = {
  active: 'Active',
  draft: 'Draft',
  paused: 'Paused',
  ended: 'Ended',
  expired: 'Expired',
}

export function bonusStatusLabel(status: string): string {
  return STATUS_LABELS[bonusStatusKey(status)]
}

/** The status a row shows: its stored one, except that an active campaign past its end date reads Expired. */
export function bonusDisplayStatusKey(campaign: { status: string; endDate?: string | null }, now: number = Date.now()): BonusStatusKey {
  return isPastEnd(campaign, now) ? 'expired' : bonusStatusKey(campaign.status)
}

export function bonusDisplayStatusLabel(campaign: { status: string; endDate?: string | null }, now: number = Date.now()): string {
  return STATUS_LABELS[bonusDisplayStatusKey(campaign, now)]
}

function titleCaseWords(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** The table's Type cell. */
export function formatBonusType(type: string): string {
  if (type === 'direct_amount') return 'Direct Bonus'
  if (type === 'losing_bonus') return 'Losing Bonus'
  if (type === 'special') return 'Special Bonus'
  if (type === 'daily_first_deposit') return 'First Day First Time Deposit'
  return titleCaseWords(type)
}

/** The table's Distribution cell. */
export function formatDistributionType(type?: string | null): string {
  if (!type) return '—'
  return titleCaseWords(type)
}

/** The domain under the campaign name: `All` for a global campaign, otherwise upper case. */
export function bonusDomainLabel(domain: string): string {
  return domain === 'global' ? 'All' : domain.toUpperCase()
}

type FormatAmount = (amount: number, currency?: string) => string

/** The table's Amount cell. */
export function bonusAmountDisplay(campaign: BonusCampaignRow, formatAmount: FormatAmount): string {
  if (campaign.amountType === 'percentage') {
    return `${campaign.percentage || 0}%`
  } else if (campaign.amountType === 'fixed') {
    return formatAmount(campaign.amount || 0, campaign.currency)
  }
  return '—'
}

/** The caption under the amount, only when the campaign has an amount type. */
export function bonusAmountTypeLabel(campaign: BonusCampaignRow): string | null {
  if (!campaign.amountType) return null
  return campaign.amountType === 'fixed' ? 'Fixed' : 'Percentage'
}

export interface PlayersCell {
  count: string
  perPlayer: string | null
}

/** The table's Players cell: the cap (or ∞) and, where the legacy cell showed it, the per-player use. */
export function bonusPlayersCell(campaign: BonusCampaignRow): PlayersCell {
  const usage = campaign.usagePerPlayer ? `(${campaign.usagePerPlayer}/player)` : null
  if (campaign.numberOfPlayers) {
    return { count: campaign.numberOfPlayers.toLocaleString(), perPlayer: usage }
  }
  return {
    count: '∞',
    perPlayer: usage && !['signup', 'direct_amount'].includes(campaign.type) ? usage : null,
  }
}

/** Direct bonuses that have not been distributed offer Distribute. */
export function canDistribute(campaign: BonusCampaignRow): boolean {
  return campaign.type === 'direct_amount' && !campaign.distributedAt
}

/** Direct bonuses that have been distributed carry the Distributed tag. */
export function isDistributed(campaign: BonusCampaignRow): boolean {
  return campaign.type === 'direct_amount' && Boolean(campaign.distributedAt)
}

export interface StatusConfirmCopy {
  action: 'activate' | 'deactivate'
  tooltip: string
  title: string
  description: string
}

/**
 * An active campaign offers Deactivate (to paused); any other offers Activate, with the legacy
 * Popconfirm copy. An ended campaign can be activated again (the server allows it), so its copy says
 * that it is reviving an ended campaign rather than reading like a first start (MAR-07).
 */
export function bonusStatusAction(campaign: BonusCampaignRow): StatusConfirmCopy {
  if (campaign.status === 'active') {
    return {
      action: 'deactivate',
      tooltip: 'Deactivate',
      title: 'Deactivate campaign?',
      description: 'This will pause the campaign and prevent new awards.',
    }
  }
  if (campaign.status === 'ended') {
    return {
      action: 'activate',
      tooltip: 'Reactivate',
      title: 'Reactivate campaign?',
      description: 'This ended campaign becomes active again and allows new awards.',
    }
  }
  return {
    action: 'activate',
    tooltip: 'Activate',
    title: 'Activate campaign?',
    description: 'This will make the campaign active and allow new awards.',
  }
}

/**
 * The list's last action ends a campaign; it never deleted one (deleteBonusCampaign sets status
 * ended, on purpose, and the row stays). It was labelled Delete under "This action cannot be
 * undone", while Activate brought the campaign straight back (MAR-07). An ended campaign has
 * nothing left to end.
 */
export const END_CONFIRM = {
  title: 'End campaign?',
  description: 'It stops new awards. The campaign stays in the list and can be activated again.',
} as const

export function canEnd(campaign: Pick<BonusCampaignRow, 'status'>): boolean {
  return campaign.status !== 'ended'
}

/** The legacy Popconfirm buttons. */
export const CONFIRM_LABELS = { confirmLabel: 'Yes', cancelLabel: 'No' } as const

export function campaignCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'campaign' : 'campaigns'}`
}

export interface DistributionPreview {
  eligibleCount: number
  campaignName: string
  campaignType: string
  alreadyDistributed: boolean
  distributedAt: string | null
}

/** The legacy OK button rule: nothing to distribute until a usable preview is here. */
export function distributeBlocked(previewLoading: boolean, preview: DistributionPreview | null): boolean {
  return previewLoading || !preview || preview.alreadyDistributed || preview.eligibleCount === 0
}

export function distributedMessage(distributedCount: number | null | undefined): string {
  return `Distributed to ${distributedCount ?? 0} users`
}

/**
 * The legacy Export Excel columns, getter for getter, except Type and Status, which now read as the
 * table reads them. The export had its own Type mapping that knew three labels and wrote every other
 * type as its raw code ('deposit', 'daily_first_deposit'), and wrote the raw status (MAR-05).
 */
export function bonusExportColumns(
  formatAmount: FormatAmount,
  formatDateDisplay: (date?: string | null) => string,
  now?: number,
): TableExportColumn<BonusCampaignRow>[] {
  return [
    { header: 'Campaign', key: 'name', width: 24, getter: (c) => c.name ?? '' },
    { header: 'Domain', key: 'domain', width: 10, getter: (c) => (c.domain === 'global' ? 'All' : c.domain?.toUpperCase() ?? '') },
    { header: 'Type', key: 'type', width: 16, getter: (c) => (c.type ? formatBonusType(c.type) : '') },
    { header: 'Status', key: 'status', width: 10, getter: (c) => (c.status ? bonusDisplayStatusLabel(c, now ?? Date.now()) : '') },
    { header: 'Distribution', key: 'distributionType', width: 14, getter: (c) => (c.distributionType ?? '').replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) },
    {
      header: 'Amount',
      key: 'amount',
      width: 14,
      getter: (c) => (c.amountType === 'percentage' ? `${c.percentage ?? 0}%` : c.amountType === 'fixed' && c.amount != null ? formatAmount(c.amount, c.currency) : '—'),
    },
    { header: 'Players', key: 'numberOfPlayers', width: 10, getter: (c) => (c.numberOfPlayers != null ? c.numberOfPlayers : '—') },
    { header: 'Start Date', key: 'startDate', width: 18, getter: (c) => formatDateDisplay(c.startDate) },
    { header: 'End Date', key: 'endDate', width: 18, getter: (c) => formatDateDisplay(c.endDate) },
    { header: 'Currency', key: 'currency', width: 10, getter: (c) => c.currency ?? '' },
  ]
}
