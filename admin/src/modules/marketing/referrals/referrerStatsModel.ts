/* Pure logic of /referrals/referrers/:referrerId (W6 Task 180): the period and its variables, the referrer
   facts, the four figures' copy and the rule-type rows. React-free, so the page and its tests share one
   reading of the legacy page. */
import { istDayEnd, istDayStart, isDayString } from '@/ui/components/istDate'

export interface RuleTypeEarning {
  ruleType: string
  totalEarnings: number
  count: number
}

/** `referrerStats`, exactly the fields the page's document selects. */
export interface ReferrerStatsData {
  referrerId: number | string
  totalEarnings: number
  grossEarnings: number
  totalReferrals: number
  activeReferrals: number
  totalTransactions: number
  totalClicks: number
  totalAttributions: number
  conversionRate: number
  earningsByRuleType?: readonly RuleTypeEarning[] | null
}

/** `user`, exactly the fields the page's document selects. */
export interface ReferrerUser {
  id: string
  name?: string | null
  email?: string | null
  phone?: string | null
  username?: string | null
}

/** The applied period: two IST `yyyy-MM-dd` days, or neither (every date, the legacy default). */
export interface ReferrerStatsDateRange {
  from?: string
  to?: string
}

export type ReferrerStatsDatePreset = 'all' | 'custom'

/** The legacy picker had no presets; its cleared state meant every date. */
export const REFERRER_STATS_DATE_PRESETS: ReadonlyArray<{ value: ReferrerStatsDatePreset; label: string }> = [
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom range' },
]

export function normalizeReferrerStatsRange(range: ReferrerStatsDateRange | null | undefined): ReferrerStatsDateRange {
  if (!range || !isDayString(range.from) || !isDayString(range.to)) return {}
  return range.from <= range.to ? { from: range.from, to: range.to } : { from: range.to, to: range.from }
}

export function referrerStatsDatePreset(range: ReferrerStatsDateRange | null | undefined): ReferrerStatsDatePreset {
  return normalizeReferrerStatsRange(range).from ? 'custom' : 'all'
}

/**
 * The period as the instants the stats document takes: the start of the first IST day and the end of
 * the last. Named change: the legacy picker sent each picked day's browser midnight, so the last day was
 * left out and a one-day range matched nothing.
 */
export function referrerStatsPeriod(range: ReferrerStatsDateRange | null | undefined): { from?: string; to?: string } {
  const applied = normalizeReferrerStatsRange(range)
  return applied.from && applied.to ? { from: istDayStart(applied.from), to: istDayEnd(applied.to) } : {}
}

/** The rule types the page lists: every one but revenue share, in the server's order. */
export function visibleRuleEarnings(rows: readonly RuleTypeEarning[] | null | undefined): RuleTypeEarning[] {
  return (rows ?? []).filter((row) => row.ruleType !== 'REVSHARE')
}

export function ruleTypeLabel(type: string | null | undefined): string {
  return (type ?? '').replace(/_/g, ' ')
}

export function ruleCountText(count: number): string {
  return `${count} ${count === 1 ? 'rule' : 'rules'}`
}

export interface ReferrerFact {
  key: string
  term: string
  value: string
  /** The username was printed in a monospace face. */
  code?: boolean
}

/** The legacy info bar: ID, name, email and phone (`N/A` when missing), and the username only when present. */
export function referrerFacts(referrerId: string | undefined, user: ReferrerUser): ReferrerFact[] {
  const facts: ReferrerFact[] = [
    { key: 'id', term: 'Referrer ID', value: referrerId ?? '' },
    { key: 'name', term: 'Name', value: user.name || 'N/A' },
    { key: 'email', term: 'Email', value: user.email || 'N/A' },
    { key: 'phone', term: 'Phone', value: user.phone || 'N/A' },
  ]
  if (user.username) facts.push({ key: 'username', term: 'Username', value: user.username, code: true })
  return facts
}

/* The figures' copy, as the legacy cards printed it. */
export function conversionRateText(rate: number | null | undefined): string {
  return `${Number(rate).toFixed(2)}%`
}

export function activeReferralsNote(active: number | null | undefined): string {
  return `${active} active`
}

export function signupsOverClicksNote(attributions: number | null | undefined, clicks: number | null | undefined): string {
  return `${attributions} / ${clicks} signups/clicks`
}

export function clicksNote(clicks: number | null | undefined): string {
  return `${clicks} clicks`
}

export function referrerStatsSub(referrerId: string | undefined): string {
  return `Detailed performance metrics for referrer #${referrerId ?? ''}`
}
