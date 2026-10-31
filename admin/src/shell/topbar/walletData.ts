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

export type SettlementDomainLabel = 'Sports' | 'Casino' | 'Matka'

export interface SettlementSummary {
  balance: number
  rows: ReadonlyArray<{ domain: SettlementDomainLabel; amount: number }>
}

export interface SettlementPayload {
  settlementBalance?: number | null
  settlementBalanceSports?: number | null
  settlementBalanceCasino?: number | null
  settlementBalanceMatka?: number | null
}

/**
 * Unlike this file's other functions, there is no working legacy component to port this from:
 * AgentCreditIndicator.tsx's "Settlement" tab currently renders dead/unreachable code (its tab
 * button never wires to a rendered pane), and no other component has a settlement view at all.
 * This maps the `settlementBalance*` fields straight from the GraphQL schema (agentCredit.ts),
 * not from an observed old-component behavior — verify against the product/backend contract
 * directly rather than assuming behavior parity with anything currently shipped.
 */
export function toSettlementSummary(payload: SettlementPayload): SettlementSummary {
  return {
    balance: payload.settlementBalance || 0,
    rows: [
      { domain: 'Sports', amount: payload.settlementBalanceSports || 0 },
      { domain: 'Casino', amount: payload.settlementBalanceCasino || 0 },
      { domain: 'Matka', amount: payload.settlementBalanceMatka || 0 },
    ],
  }
}

export type AmountSign = 'positive' | 'negative' | 'zero'

export function amountSign(amount: number): AmountSign {
  if (amount > 0) return 'positive'
  if (amount < 0) return 'negative'
  return 'zero'
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
