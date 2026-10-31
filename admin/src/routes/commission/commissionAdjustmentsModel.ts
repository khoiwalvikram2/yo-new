import type { StatusPillTone } from '@/ui/components/StatusPill'
import { cyclePeriod, cycleRangeLabel, type CommissionCycleRow } from './commissionOverviewModel'

/** The Adjustments card's element id; the Pay dialog's "Review adjustments" link scrolls to it. */
export const COMMISSION_ADJUSTMENTS_SECTION_ID = 'commission-adjustments'
/** The reasons an admin picks from (the backend column is varchar(64)). */
export const ADJUSTMENT_REASONS = ['Void', 'Refund', 'Rollback', 'Correction', 'Other'] as const
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]
export type AdjustmentDirection = 'add' | 'deduct'
/** Longest optional note kept in refMeta.note. */
export const ADJUSTMENT_NOTE_MAX = 200

/** One row of the commissionAdjustments query. Dates are ISO instants of IST Monday 00:00 bounds. */
export interface CommissionAdjustmentRow {
  id: string
  agentId: string
  amount: number
  sourceCycleFrom: string
  sourceCycleTo: string
  targetCycleFrom?: string | null
  targetCycleTo?: string | null
  reason: string
  status: string
  createdAt: string
  appliedAt?: string | null
}

export interface CreateAdjustmentInput {
  agentId: string
  amount: number
  sourceCycleFrom: string
  sourceCycleTo: string
  reason: AdjustmentReason
  /** JSON string, as CreateCommissionAdjustmentInput.refMeta takes it: {"note": "..."}. */
  refMeta?: string
}

/** Where the Pay dialog sends an admin (or a paying parent agent) to resolve UNRESOLVED_ADJUSTMENT. */
export function reviewAdjustmentsHref(agentId: string): string {
  return `/agents/${encodeURIComponent(agentId)}?tab=commission#${COMMISSION_ADJUSTMENTS_SECTION_ID}`
}

/** Weeks an adjustment can be raised against: every closed week, paid or not, newest first. Never the open week. */
export function adjustmentSourceCycles(cycles: readonly CommissionCycleRow[] | null | undefined): CommissionCycleRow[] {
  return (cycles ?? []).filter((cycle) => cycle.status !== 'OPEN').reverse()
}

/**
 * Weeks an adjustment can be applied to: unpaid closed weeks (CLOSED_UNSETTLED) and the open week, oldest first.
 * A week with a payout never qualifies; applyCommissionAdjustment refuses a paid target.
 */
export function adjustmentTargetCycles(cycles: readonly CommissionCycleRow[] | null | undefined): CommissionCycleRow[] {
  return (cycles ?? []).filter((cycle) => (cycle.status === 'CLOSED_UNSETTLED' || cycle.status === 'OPEN') && !(Number(cycle.paidAmount ?? 0) > 0))
}

/** The state a week is in, in words, for the week pickers. */
export function cycleStateWord(cycle: Pick<CommissionCycleRow, 'status' | 'zeroCommission'>): string {
  switch (cycle.status) {
    case 'OPEN': return 'current week'
    case 'CLOSED_UNSETTLED': return 'unpaid'
    case 'SETTLED': return cycle.zeroCommission ? 'no commission' : 'paid'
    default: return cycle.status.toLowerCase()
  }
}

/** Add is positive, Deduct negative, whatever sign was typed. */
export function signedAdjustmentAmount(direction: AdjustmentDirection, amount: number): number {
  const magnitude = Math.abs(amount)
  return direction === 'deduct' ? -magnitude : magnitude
}

export function isAdjustmentReason(value: string): value is AdjustmentReason {
  return (ADJUSTMENT_REASONS as readonly string[]).includes(value)
}

/**
 * The createCommissionAdjustment input, or null while anything is missing: an agent, a closed week, an amount above
 * zero (after rounding to cents) and a listed reason. The week is sent as its IST dates; the note goes to refMeta.note.
 */
export function createAdjustmentInput(
  agentId: string | null | undefined,
  cycle: CommissionCycleRow | undefined,
  direction: AdjustmentDirection,
  amount: number | null,
  reason: string,
  note: string,
): CreateAdjustmentInput | null {
  if (!agentId || !cycle || cycle.status === 'OPEN') return null
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null
  const cents = Math.round(amount * 100) / 100
  if (!(cents > 0)) return null
  if (!isAdjustmentReason(reason)) return null
  const { periodFrom, periodTo } = cyclePeriod(cycle)
  const trimmed = note.trim().slice(0, ADJUSTMENT_NOTE_MAX)
  return {
    agentId,
    amount: signedAdjustmentAmount(direction, cents),
    sourceCycleFrom: periodFrom,
    sourceCycleTo: periodTo,
    reason,
    ...(trimmed ? { refMeta: JSON.stringify({ note: trimmed }) } : {}),
  }
}

/** The applyCommissionAdjustment input for a target week, sent as its IST dates. */
export function applyAdjustmentInput(adjustmentId: string | null | undefined, cycle: CommissionCycleRow | undefined) {
  if (!adjustmentId || !cycle) return null
  const { periodFrom, periodTo } = cyclePeriod(cycle)
  return { adjustmentId, targetCycleFrom: periodFrom, targetCycleTo: periodTo }
}

/** "12 Oct – 18 Oct 2026" for stored ISO bounds, or a dash when there is no week (not applied yet). */
export function adjustmentWeekLabel(from?: string | null, to?: string | null): string {
  return from && to ? cycleRangeLabel({ from, to }) : '—'
}

/** The word shown beside a signed amount, so colour never carries the meaning alone. */
export function adjustmentEffect(amount: number): 'Add' | 'Deduct' {
  return amount < 0 ? 'Deduct' : 'Add'
}

export function adjustmentStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING': return 'Pending'
    case 'APPLIED': return 'Applied'
    case 'CANCELLED': return 'Cancelled'
    default: return status
  }
}

export function adjustmentStatusTone(status: string): StatusPillTone {
  switch (status) {
    case 'PENDING': return 'warn'
    case 'APPLIED': return 'ok'
    case 'CANCELLED': return 'muted'
    default: return 'neutral'
  }
}

/**
 * A deduction larger than a closed week's payable. The payable stops at 0 (roundPayable), and the rest of the
 * deduction is not carried to another week, so the Apply dialog warns. The open week has no payable yet.
 */
export function deductionExceedsPayable(amount: number, target: Pick<CommissionCycleRow, 'status' | 'payableAmount'> | undefined): boolean {
  return !!target && amount < 0 && target.status === 'CLOSED_UNSETTLED' && Math.abs(amount) > Number(target.payableAmount ?? 0)
}
