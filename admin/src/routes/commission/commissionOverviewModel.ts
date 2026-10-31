import dayjs from 'dayjs'

const IST = 'Asia/Kolkata'

export function commissionRateLabel(rate: number, precision = 2, normalizePercentage = false) {
  return `${(normalizePercentage && rate > 1 ? rate : rate * 100).toFixed(precision)}%`
}

/** One IST Monday->Monday commission cycle as commissionCyclesForAgent returns it. */
export interface CommissionCycleRow {
  from: string
  to: string
  status: string
  paidAmount?: number | null
  payableAmount?: number | null
  calculatedTotal?: number | null
  adjustmentAmount?: number | null
  zeroCommission?: boolean | null
  /** Loss carry-forward (one week): the loss carried in from last week, the part taken off, and this week's own loss. */
  carriedLoss?: number | null
  carryApplied?: number | null
  lossThisCycle?: number | null
  /** IST calendar dates (YYYY-MM-DD) of the cycle; what the payout and readiness take. */
  fromDate?: string | null
  toDate?: string | null
}

export interface CommissionReadinessInfo {
  ready: boolean
  payableAmount: number
  reasons?: string[] | null
  openBets?: number | null
  unresolvedAdjustments?: number | null
  /** Open bets of the week before: its loss carries into this week, so they hold it too (MISSING_BETS). */
  previousCycleOpenBets?: number | null
}

/** The IST dates a cycle is paid and checked with: the backend's fromDate/toDate, else its ISO bounds. */
export function cyclePeriod(cycle: Pick<CommissionCycleRow, 'from' | 'to' | 'fromDate' | 'toDate'>) {
  return { periodFrom: cycle.fromDate || cycle.from, periodTo: cycle.toDate || cycle.to }
}

/** "28 Sep – 04 Oct 2026": the cycle's Monday to its Sunday, in IST whatever the browser's zone. */
export function cycleRangeLabel(cycle: Pick<CommissionCycleRow, 'from' | 'to' | 'fromDate' | 'toDate'>) {
  const from = cycle.fromDate ? dayjs.tz(cycle.fromDate, IST) : dayjs.utc(cycle.from).tz(IST)
  const to = cycle.toDate ? dayjs.tz(cycle.toDate, IST) : dayjs.utc(cycle.to).tz(IST)
  return `${from.format('DD MMM')} – ${to.subtract(1, 'day').format('DD MMM YYYY')}`
}

/** The IST dates of the open week and of the last closed week, from currentCommissionCycle (no browser date maths). */
export interface CommissionCycleWeeks {
  currentFrom: string | null
  currentTo: string | null
  lastFrom: string | null
  lastTo: string | null
}
export function commissionCycleWeeks(cycle: { from?: string | null; to?: string | null; fromDate?: string | null; toDate?: string | null; previousFromDate?: string | null; previousToDate?: string | null } | null | undefined): CommissionCycleWeeks {
  // ISO bounds (Monday 00:00 IST = Sunday 18:30 UTC) read in IST, for a backend without the date fields.
  const ist = (iso?: string | null) => (iso ? dayjs.utc(iso).tz(IST).format('YYYY-MM-DD') : null)
  return {
    currentFrom: cycle?.fromDate || ist(cycle?.from),
    currentTo: cycle?.toDate || ist(cycle?.to),
    lastFrom: cycle?.previousFromDate || null,
    lastTo: cycle?.previousToDate || null,
  }
}

/**
 * The cycles a payout can be made for: closed and not settled (CLOSED_UNSETTLED), oldest first. The open
 * week (OPEN) and any all-time or custom range are never payable; a zero-commission week is SETTLED.
 */
export function payableCommissionCycles(cycles: readonly CommissionCycleRow[] | null | undefined): CommissionCycleRow[] {
  return (cycles ?? []).filter((cycle) => cycle.status === 'CLOSED_UNSETTLED')
}

/** Weeks that closed with nothing to pay; they count as settled. */
export function zeroCommissionCycleCount(cycles: readonly CommissionCycleRow[] | null | undefined): number {
  return (cycles ?? []).filter((cycle) => cycle.status === 'SETTLED' && cycle.zeroCommission).length
}

export function commissionPayoutInput(agentId: string | undefined, cycle: Pick<CommissionCycleRow, 'from' | 'to' | 'fromDate' | 'toDate'> | undefined,
  readiness: { ready: boolean; payableAmount: number } | undefined, notes: string) {
  const amount = Number(readiness?.payableAmount ?? 0)
  if (!agentId || !cycle?.from || !cycle.to || !readiness?.ready || !Number.isFinite(amount) || amount <= 0) return null
  const { periodFrom, periodTo } = cyclePeriod(cycle)
  return { agentId, amount, periodFrom, periodTo, notes: notes || 'Commission payout (full cycle IST)' }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * Readable text for a readiness reason. Blocking: NOT_CLOSED, MISSING_BETS, UNRESOLVED_ADJUSTMENT.
 * LEDGER_GAP is informational, ZERO_PAYABLE_NET means nothing is due, READY is not shown.
 */
export function readinessReasonText(reason: string, readiness?: Pick<CommissionReadinessInfo, 'openBets' | 'unresolvedAdjustments' | 'previousCycleOpenBets'> | null): string {
  switch (reason) {
    case 'NOT_CLOSED': return 'This week is still open. Only closed weeks (Monday to Monday, IST) can be paid.'
    case 'MISSING_BETS': {
      const open = Number(readiness?.openBets ?? 0)
      const previous = Number(readiness?.previousCycleOpenBets ?? 0)
      const thisWeek = open > 0
        ? `${plural(open, 'bet placed in this week is', 'bets placed in this week are')} still open. Pay after they settle, so they are included.`
        : 'Bets placed in this week are still open. Pay after they settle, so they are included.'
      const lastWeek = `${plural(previous, 'bet placed in the week before is', 'bets placed in the week before are')} still open. That week's loss carries into this one, so pay after they settle.`
      if (previous > 0 && open > 0) return `${thisWeek} ${lastWeek}`
      return previous > 0 ? lastWeek : thisWeek
    }
    case 'UNRESOLVED_ADJUSTMENT': {
      const pending = Number(readiness?.unresolvedAdjustments ?? 0)
      return pending > 0
        ? `${plural(pending, 'adjustment raised against this week is', 'adjustments raised against this week are')} still pending.`
        : 'An adjustment raised against this week is still pending.'
    }
    case 'LEDGER_GAP': return 'The calculated commission differs from the posted ledger lines. This does not block payment.'
    case 'ZERO_PAYABLE_NET': return 'Nothing is payable for this week after tally rules.'
    default: return reason
  }
}

/** Blocking reasons only (what stops a payout), in readable form. */
export function blockingReadinessReasons(readiness: CommissionReadinessInfo | null | undefined): string[] {
  if (!readiness || readiness.ready) return []
  return (readiness.reasons ?? [])
    .filter((reason) => reason !== 'LEDGER_GAP' && reason !== 'READY' && reason !== 'ZERO_PAYABLE_NET')
    .map((reason) => readinessReasonText(reason, readiness))
}

export const COMMISSION_DOMAINS = ['sports', 'casino', 'matka'] as const
export type CommissionDomain = (typeof COMMISSION_DOMAINS)[number]
type Cap<D extends string> = D extends `${infer F}${infer R}` ? `${Uppercase<F>}${R}` : D
type DomainFields<P extends string, S extends string> = { [D in CommissionDomain as `${P}${P extends '' ? D : Cap<D>}${S}`]?: number | null }

/** The parts of agents.commissionSummary the segments read. */
export type OwnCommissionSummary = DomainFields<'', 'GGR'> & DomainFields<'direct', 'GGR'> & DomainFields<'', 'Commission'> & DomainFields<'', 'CommissionRate'>
  & DomainFields<'grossEffective', 'Commission'> & DomainFields<'netEffective', 'Commission'> & DomainFields<'effective', 'Commission'>
  & CommissionCarryFigures & { grossEffectiveCalculatedTotal?: number | null; netEffectiveCalculatedTotal?: number | null; effectiveCalculatedTotal?: number | null; currency?: string | null }

/** The parts of a subAgentCommissionSummaries row the segments read (effective* = the child's GROSS, what it is paid). */
export type SubAgentCommissionRow = DomainFields<'', 'GGR'> & DomainFields<'', 'Commission'> & DomainFields<'effective', 'Commission'>
  & { effectiveCalculatedTotal?: number | null }

export interface CommissionSegment {
  sports: { ggr: number; commission: number }
  casino: { ggr: number; commission: number }
  matka: { ggr: number; commission: number }
  totalGgr: number
  totalCommission: number
}

const num = (value: number | null | undefined) => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}
const cap = <D extends CommissionDomain>(domain: D) => (domain[0].toUpperCase() + domain.slice(1)) as Cap<D>

/**
 * Receivable / Payable / My Share of a commission agent for a period.
 *
 * - Receivable: what the agent's payer owes it, the backend GROSS after tally, summed cycle by cycle
 *   (grossEffective*). It used to be the period's GGR x one rate, wrong whenever the rate changed between weeks.
 * - Payable: what the agent owes its direct sub-agents, the sum of their effective* (each child's gross).
 * - My Share: the backend net (netEffective*), which is Receivable − Payable. GGR is the agent's direct players'.
 * Older backends without the gross fields fall back to the figures they had.
 */
export function commissionSegments(own: OwnCommissionSummary | null | undefined, subAgents: readonly SubAgentCommissionRow[] | null | undefined) {
  const empty = (): CommissionSegment => ({ sports: { ggr: 0, commission: 0 }, casino: { ggr: 0, commission: 0 }, matka: { ggr: 0, commission: 0 }, totalGgr: 0, totalCommission: 0 })
  const receivable = empty()
  const payable = empty()
  const myShare = empty()
  for (const domain of COMMISSION_DOMAINS) {
    const D = cap(domain)
    const ggr = num(own?.[`${domain}GGR`])
    const gross = own?.[`grossEffective${D}Commission`]
    receivable[domain] = { ggr, commission: gross != null ? num(gross) : ggr * num(own?.[`${domain}CommissionRate`]) }
    for (const child of subAgents ?? []) {
      payable[domain].ggr += num(child[`${domain}GGR`])
      const effective = child[`effective${D}Commission`]
      payable[domain].commission += effective != null ? num(effective) : num(child[`${domain}Commission`])
    }
    const net = own?.[`netEffective${D}Commission`]
    myShare[domain] = {
      ggr: num(own?.[`direct${D}GGR`]),
      commission: net != null ? num(net) : own?.[`grossEffective${D}Commission`] != null ? receivable[domain].commission - payable[domain].commission : num(own?.[`${domain}Commission`]),
    }
  }
  const total = (segment: CommissionSegment) => {
    segment.totalGgr = COMMISSION_DOMAINS.reduce((sum, domain) => sum + segment[domain].ggr, 0)
    segment.totalCommission = COMMISSION_DOMAINS.reduce((sum, domain) => sum + segment[domain].commission, 0)
  }
  total(receivable)
  total(payable)
  total(myShare)
  if (own?.grossEffectiveCalculatedTotal != null) receivable.totalCommission = num(own.grossEffectiveCalculatedTotal)
  if ((subAgents ?? []).length > 0 && (subAgents ?? []).every((child) => child.effectiveCalculatedTotal != null)) {
    payable.totalCommission = (subAgents ?? []).reduce((sum, child) => sum + num(child.effectiveCalculatedTotal), 0)
  }
  if (own?.netEffectiveCalculatedTotal != null) myShare.totalCommission = num(own.netEffectiveCalculatedTotal)
  return { receivable, payable, myShare }
}

/** The loss carry-forward figures of a commission summary or cycle (agents.graphql / settlements.graphql). */
export interface CommissionCarryFigures {
  carriedLoss?: number | null
  carryApplied?: number | null
  lossThisCycle?: number | null
}

/** The carry lines a commission screen shows. All amounts are positive and shown as deductions. */
export interface CommissionCarryBreakdown {
  /** "Loss carried from last week". */
  carriedLoss: number
  /** The part of it taken off this week's gross. */
  carryApplied: number
  /** The part not recovered this week: forgiven, never carried again (one week only). */
  forgiven: number
  /** "This week's loss (carries to next week)". */
  lossThisCycle: number
}

const CARRY_EPSILON = 0.005

/**
 * Loss carry-forward (one week, approach A): last week's whole loss comes off this week's gross as one line.
 * Null when there is nothing to show: no loss either way, or an older backend without the fields.
 */
export function commissionCarryLines(figures: CommissionCarryFigures | null | undefined): CommissionCarryBreakdown | null {
  const carriedLoss = Math.max(0, num(figures?.carriedLoss))
  const carryApplied = Math.min(carriedLoss, Math.max(0, num(figures?.carryApplied)))
  const lossThisCycle = Math.max(0, num(figures?.lossThisCycle))
  if (carriedLoss < CARRY_EPSILON && lossThisCycle < CARRY_EPSILON) return null
  const forgiven = carriedLoss - carryApplied
  return { carriedLoss, carryApplied, forgiven: forgiven < CARRY_EPSILON ? 0 : forgiven, lossThisCycle }
}

/** A carry figure as a deduction: a minus sign (U+2212) before the formatted amount; nothing to deduct shows a plain zero. */
export function carryDeductionLabel(amount: number, format: (value: number) => string): string {
  const value = Number.isFinite(amount) ? amount : 0
  return value > 0 ? `\u2212${format(value)}` : format(0)
}
