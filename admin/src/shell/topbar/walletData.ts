export type DomainKey = 'sports' | 'casino' | 'matka'

export const DOMAIN_KEYS: readonly DomainKey[] = ['sports', 'casino', 'matka']

export interface DomainRow {
  domain: DomainKey
  rate: number
  allTime: number
  currentPeriod: number
}

export interface RatesPayload {
  rates?: ReadonlyArray<{ domain?: string | null; rate?: number | null } | null> | null
  allTimeTotals?: ReadonlyArray<{ domain?: string | null; totalAmount?: number | null } | null> | null
  currentPeriodTotals?: ReadonlyArray<{ domain?: string | null; totalAmount?: number | null } | null> | null
  currency?: string | null
}

/**
 * Hides a domain when its rate is falsy (no entry, or an entry with rate 0) and both totals are
 * zero (R2 §4). This is an intentional, spec-mandated divergence from the four legacy components
 * it replaces (WhitelabelCreditIndicator, AgentCreditIndicator, AgentSharingIndicator,
 * AgentCommissionIndicator): those check only whether a rate ENTRY exists, so a `{ domain, rate: 0 }`
 * entry with zero totals still renders a blank row today. Do not "fix" this to match the old
 * entry-existence check — R2 §4 explicitly wants an explicit-zero-rate domain hidden too.
 */
export function toDomainRows(payload: RatesPayload): DomainRow[] {
  const rows: DomainRow[] = []
  for (const domain of DOMAIN_KEYS) {
    const rateEntry = payload.rates?.find((r) => r?.domain === domain)
    const allTimeEntry = payload.allTimeTotals?.find((t) => t?.domain === domain)
    const currentPeriodEntry = payload.currentPeriodTotals?.find((t) => t?.domain === domain)
    const rate = rateEntry?.rate || 0
    const allTime = allTimeEntry?.totalAmount || 0
    const currentPeriod = currentPeriodEntry?.totalAmount || 0
    if (!rate && allTime === 0 && currentPeriod === 0) continue
    rows.push({ domain, rate, allTime, currentPeriod })
  }
  return rows
}

export function sumCurrentPeriod(totals: RatesPayload['currentPeriodTotals']): number {
  if (!totals) return 0
  return totals.reduce((sum, t) => sum + (t?.totalAmount ?? 0), 0)
}

export interface SharingSummary {
  currency: string
  currentPeriodTotal: number
  rows: DomainRow[]
}

export function toSharingSummary(payload: RatesPayload): SharingSummary {
  return {
    currency: payload.currency || 'INR',
    currentPeriodTotal: sumCurrentPeriod(payload.currentPeriodTotals),
    rows: toDomainRows(payload),
  }
}

export type CreditStatus = 'healthy' | 'warning' | 'critical'

export const CREDIT_STATUS_LABEL: Readonly<Record<CreditStatus, 'Healthy' | 'Warning' | 'Critical'>> = {
  healthy: 'Healthy',
  warning: 'Warning',
  critical: 'Critical',
}

export interface CreditFigures {
  creditAvailable: number
  creditLimit: number
  creditUsed: number
  usagePercentage: number
  isNearLimit: boolean
  isCritical: boolean
  status: CreditStatus
}

export interface CreditPayload {
  creditLimit?: number | null
  creditUsed?: number | null
  creditAvailable?: number | null
  usagePercentage?: number | null
  isNearLimit?: boolean | null
}

/** isCritical = usage >= 90; status critical > warning (isNearLimit) > healthy. */
export function toCreditFigures(payload: CreditPayload): CreditFigures {
  const usagePercentage = payload.usagePercentage || 0
  const isNearLimit = payload.isNearLimit || false
  const isCritical = usagePercentage >= 90
  const status: CreditStatus = isCritical ? 'critical' : isNearLimit ? 'warning' : 'healthy'
  return {
    creditAvailable: payload.creditAvailable || 0,
    creditLimit: payload.creditLimit || 0,
    creditUsed: payload.creditUsed || 0,
    usagePercentage,
    isNearLimit,
    isCritical,
    status,
  }
}

/**
 * A CREDIT agent's wallet on Deposit/Withdraw chips (spec 2026-11-02 §2): its own balance, what its
 * downline holds, its credit reference and Ref P/L (balance + downline − credit reference). The old
 * settlement balance is retired for the scheme, so the wallet no longer has a Settlement tab.
 */
export interface ChipWalletFigures {
  currency: string
  balance: number
  downlineBalance: number
  creditReference: number
  refPnl: number
}

/** 'Credit limit nearly exhausted' when critical, a rounded percentage when only near the limit, else null. */
export function creditAlertText(credit: CreditFigures): string | null {
  if (!credit.isNearLimit && !credit.isCritical) return null
  if (credit.isCritical) return 'Credit limit nearly exhausted'
  return `${credit.usagePercentage.toFixed(0)}% of limit reached`
}

/**
 * True for the wallet subscriptions' known-noisy transport-disconnect messages (a dropped stream on
 * tab close/network change), which every wallet hook's onError already treats as non-critical — the
 * 60s/10s poll or the next subscription event covers it. Shared so the "what counts as noisy" list
 * lives in one place instead of three near-identical copies.
 */
export function isNoisyDisconnectError(err: unknown): boolean {
  const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message) : ''
  return message.includes('EOF') || message.includes('stream.push')
}
