import {
  addDays,
  DEFAULT_ADMIN_TZ,
  formatInTimeZone,
  startOfDay,
} from '@/shared/utils/date'

export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

/** A WeLivePay IMPS payout of a withdrawal, as last read from the gateway (`gatewayPayout`). */
export interface GatewayPayout {
  orderId: string
  /** pending | requested | processing | success | failed | rejected */
  status: string
  amount: number
  utr: string | null
  failureReason: string | null
  merchantTransactionId: string | null
  /** True only while WeLivePay has not taken the payout (unsent, or refused for the project balance). */
  canReject: boolean
}

/** `withdrawalGatewayConfig`: payouts on and a merchant key saved for the payment whitelabel. */
export interface WithdrawalGatewayConfig {
  tenant: string | null
  payoutEnabled: boolean
}

export interface WithdrawalRequest {
  id: string
  userId: string
  amount: number
  currency: string
  status: WithdrawalStatus
  reviewerId: string | null
  reviewedAt: string | null
  note: string | null
  createdAt: string
  updatedAt: string
  account: {
    id: string
    method: string
    accountNumber?: string
    ifscCode?: string
    bankName?: string
    accountHolderName?: string
    /** When the player deleted the account (ISO); null while it is live. The request still shows it, marked Deleted. */
    deletedAt?: string | null
  } | null
  user: {
    id: string
    name: string
    email: string | null
    phone: string | null
  } | null
  /** Null until the withdrawal is sent to WeLivePay; from then on it settles only through the gateway. */
  gatewayPayout?: GatewayPayout | null
}

/** One row of `adminWithdrawalHistory`. */
export interface WithdrawalHistoryEntry {
  status: string
  reviewerId: string | null
  reviewedAt: string | null
  note: string | null
}

export interface WithdrawalDateRange {
  from?: string
  to?: string
}

export type WithdrawalDatePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'custom'

/** Filter fields for adminWithdrawalRequests (excluding offset/limit). */
export interface WithdrawalRequestsFilter {
  status?: string
  query?: string
  fromDate?: string
  toDate?: string
}

export interface WithdrawalStats {
  totalRequests: number
  pending: number
  processing: number
  completed: number
  failed: number
  totalAmount: number
  completionRate: number
  failureRate: number
}

export interface WithdrawalStatsItem {
  status?: string | null
  amount?: string | number | null
}

/** The statuses an operator may move an open request to, in the legacy button order. */
export const WITHDRAWAL_UPDATE_STATUSES = ['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const
export type WithdrawalUpdateStatus = (typeof WITHDRAWAL_UPDATE_STATUSES)[number]

function calendarDate(date: Date): string {
  return formatInTimeZone(date, 'yyyy-MM-dd', DEFAULT_ADMIN_TZ)
}

function relativeCalendarDate(now: Date, days: number): string {
  return calendarDate(addDays(startOfDay(now, DEFAULT_ADMIN_TZ), days))
}

/** Resolve the preset with the same inclusive IST calendar windows the legacy filter bar used. */
export function getWithdrawalRangeForPreset(
  preset: WithdrawalDatePreset,
  now: Date = new Date(),
): WithdrawalDateRange | null {
  const today = calendarDate(now)

  if (preset === 'today') return { from: today, to: today }
  if (preset === 'yesterday') {
    const yesterday = relativeCalendarDate(now, -1)
    return { from: yesterday, to: yesterday }
  }
  // These ranges intentionally include today plus the prior 7 / 30 calendar dates.
  if (preset === 'last7days') return { from: relativeCalendarDate(now, -7), to: today }
  if (preset === 'last30days') return { from: relativeCalendarDate(now, -30), to: today }
  return null
}

/** Infer a known preset from a controlled date range; incomplete ranges keep the Today default. */
export function getWithdrawalPresetFromRange(
  range: WithdrawalDateRange | null | undefined,
  now: Date = new Date(),
): WithdrawalDatePreset {
  if (!range?.from || !range.to) return 'today'

  const presets: readonly Exclude<WithdrawalDatePreset, 'custom'>[] = [
    'today',
    'yesterday',
    'last7days',
    'last30days',
  ]

  for (const preset of presets) {
    const candidate = getWithdrawalRangeForPreset(preset, now)
    if (candidate?.from === range.from && candidate.to === range.to) return preset
  }

  return 'custom'
}

/** Build the server filter, omitting an empty status and a search shorter than two trimmed characters. */
export function buildWithdrawalRequestFilter(
  status: string,
  debouncedQuery: string,
  range: WithdrawalDateRange,
): WithdrawalRequestsFilter {
  const trimmedQuery = debouncedQuery.trim()

  return {
    status: status || undefined,
    query: trimmedQuery.length >= 2 ? trimmedQuery : undefined,
    fromDate: range.from,
    toDate: range.to,
  }
}

/** Only Pending and Processing requests can still be moved to another status. */
export function canUpdateWithdrawalStatus(status: string | null | undefined): boolean {
  return status === 'PENDING' || status === 'PROCESSING'
}

/** The mutation input: the optional note is trimmed and omitted when blank. */
export function buildSetWithdrawalStatusInput(id: string, status: string, note: string) {
  return {
    id,
    status,
    note: note.trim() || undefined,
  }
}

/** A UPI account carries its VPA in accountNumber; every other method carries a bank account number. */
export function withdrawalAccountNumberLabel(method: string | null | undefined): string {
  return method === 'UPI' ? 'UPI ID' : 'Account Number'
}

/** The pill beside an account the player has since deleted (only the player deletes one, and never while a
 *  Pending or Processing request uses it). The list and the drawer both show it. */
export const DELETED_ACCOUNT_LABEL = 'Deleted'
export const DELETED_ACCOUNT_HINT = 'The player deleted this payout account'

export function calculateWithdrawalStats(items: readonly WithdrawalStatsItem[]): WithdrawalStats {
  let pending = 0
  let processing = 0
  let completed = 0
  let failed = 0
  let totalAmount = 0

  for (const item of items) {
    if (item.status === 'PENDING') pending += 1
    if (item.status === 'PROCESSING') processing += 1
    if (item.status === 'FAILED') failed += 1
    if (item.status !== 'COMPLETED') continue

    completed += 1
    const amount = Number(item.amount ?? 0)
    if (Number.isFinite(amount)) totalAmount += amount
  }

  const totalRequests = items.length
  return {
    totalRequests,
    pending,
    processing,
    completed,
    failed,
    totalAmount,
    completionRate: totalRequests > 0 ? Math.round((completed / totalRequests) * 100) : 0,
    failureRate: totalRequests > 0 ? Math.round((failed / totalRequests) * 100) : 0,
  }
}

const WITHDRAWAL_STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}

export function withdrawalStatusLabel(status: string): string {
  return WITHDRAWAL_STATUS_LABELS[status] ?? status
}

/* ---- WeLivePay IMPS payouts ------------------------------------------------------------------ */

/** Gateway statuses that never change again (shared welivepayPayoutService FINAL_PAYOUT_STATUSES). */
export const FINAL_PAYOUT_STATUSES: readonly string[] = ['success', 'failed', 'rejected']
export const PAY_VIA_WELIVEPAY = 'Pay via WeLivePay'
export const RETRY_SAME_PAYOUT = 'Retry same payout'
/** The server's limit on a payout rejection reason. */
export const REJECT_REASON_MAX = 500

export function isFinalPayoutStatus(status: string | null | undefined): boolean {
  return FINAL_PAYOUT_STATUSES.includes(status ?? '')
}

const PAYOUT_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'Pending',
  requested: 'Requested',
  processing: 'Processing',
  success: 'Success',
  failed: 'Failed',
  rejected: 'Rejected',
}

export function payoutStatusLabel(status: string): string {
  return PAYOUT_STATUS_LABELS[status] ?? status
}

export type PayoutStatusTone = 'warn' | 'info' | 'ok' | 'neg' | 'neutral'

const PAYOUT_STATUS_TONES: Readonly<Record<string, PayoutStatusTone>> = {
  pending: 'warn',
  requested: 'info',
  processing: 'info',
  success: 'ok',
  failed: 'neg',
  rejected: 'neg',
}

export function payoutStatusTone(status: string): PayoutStatusTone {
  return PAYOUT_STATUS_TONES[status] ?? 'neutral'
}

/** An open request can be moved by hand only while WeLivePay does not manage it (the server refuses that). */
export function canSetWithdrawalStatusByHand(request: Pick<WithdrawalRequest, 'status' | 'gatewayPayout'> | null | undefined): boolean {
  return Boolean(request) && !request?.gatewayPayout && canUpdateWithdrawalStatus(request?.status)
}

export interface GatewayPayoutActions {
  /** The drawer shows the WeLivePay payout section. */
  show: boolean
  refresh: boolean
  pay: boolean
  payLabel: typeof PAY_VIA_WELIVEPAY | typeof RETRY_SAME_PAYOUT
  reject: boolean
  /** WeLivePay settles this open request: the manual status controls give way to a note. */
  managed: boolean
}

/**
 * What the drawer offers for WeLivePay. The section shows for a request already sent, or for a PENDING
 * request to a bank account while payouts are on. `ready` is false while the payment whitelabel is not known
 * (a Super Admin without a selected site): the payout is shown, but nothing is sent. Permissions (approve to
 * pay, reject to reject) are checked by the page.
 */
export function gatewayPayoutActions(
  request: Pick<WithdrawalRequest, 'status' | 'account' | 'gatewayPayout'>,
  context: { payoutEnabled: boolean; ready: boolean; readOnly: boolean },
): GatewayPayoutActions {
  const payout = request.gatewayPayout ?? null
  const open = canUpdateWithdrawalStatus(request.status)
  const eligible = request.status === 'PENDING' && request.account?.method === 'BANK'
  const payoutEnabled = context.ready && context.payoutEnabled
  const active = context.ready && !context.readOnly
  const retryable = Boolean(payout) && !isFinalPayoutStatus(payout?.status) && open
  return {
    show: Boolean(payout) || (payoutEnabled && eligible),
    refresh: Boolean(payout) && context.ready,
    pay: active && payoutEnabled && (payout ? retryable : eligible),
    payLabel: retryable ? RETRY_SAME_PAYOUT : PAY_VIA_WELIVEPAY,
    reject: active && Boolean(payout?.canReject) && open,
    managed: Boolean(payout) && open,
  }
}

/** The drawer footer's line. */
export function withdrawalFooterHint(
  request: Pick<WithdrawalRequest, 'status' | 'gatewayPayout'>,
  selectedStatus: string,
): string {
  if (canSetWithdrawalStatusByHand(request)) {
    return selectedStatus ? `Update to ${withdrawalStatusLabel(selectedStatus)}` : 'Select status to update'
  }
  if (request.gatewayPayout && canUpdateWithdrawalStatus(request.status)) return 'Managed by WeLivePay'
  return `This request has been ${request.status.toLowerCase()}`
}

/**
 * The open request after a gateway answer, for when the refetched list no longer holds it (another status
 * filter): it settles as the server does (success COMPLETED, an admin rejection CANCELLED, a failure
 * FAILED); anything still in flight leaves it PROCESSING, where sending put it.
 */
export function withdrawalAfterPayout(
  request: WithdrawalRequest,
  payout: GatewayPayout,
  options: { rejectedByAdmin?: boolean } = {},
): WithdrawalRequest {
  let status: WithdrawalStatus = 'PROCESSING'
  if (payout.status === 'success') status = 'COMPLETED'
  else if (payout.status === 'rejected' && options.rejectedByAdmin) status = 'CANCELLED'
  else if (isFinalPayoutStatus(payout.status)) status = 'FAILED'
  return { ...request, status, gatewayPayout: payout }
}

/** The toast after Pay or Refresh: what WeLivePay says now. */
export function payoutResultToast(payout: Pick<GatewayPayout, 'status' | 'utr' | 'failureReason'>): {
  message: string
  tone: 'ok' | 'info' | 'warn'
} {
  if (payout.status === 'success') {
    return { message: `WeLivePay paid the withdrawal${payout.utr ? ` (UTR ${payout.utr})` : ''}.`, tone: 'ok' }
  }
  if (payout.status === 'failed' || payout.status === 'rejected') {
    const reason = payout.failureReason ? `: ${payout.failureReason}` : ''
    return {
      message: `WeLivePay payout ${payout.status}${reason}. The amount was refunded to the player wallet.`,
      tone: 'warn',
    }
  }
  return {
    message: `WeLivePay payout: ${payoutStatusLabel(payout.status)}${payout.failureReason ? ` — ${payout.failureReason}` : ''}`,
    tone: 'info',
  }
}

/** The reject mutation's variables: the reason trimmed. */
export function buildRejectPayoutVariables(id: string, note: string): { id: string; note: string } {
  return { id, note: note.trim() }
}

/** A rejection needs a reason of at most 500 characters, as the server checks. */
export function rejectReasonError(note: string): string | null {
  const reason = note.trim()
  if (!reason) return 'Enter a rejection reason'
  if (reason.length > REJECT_REASON_MAX) return `Use at most ${REJECT_REASON_MAX} characters`
  return null
}

/** A thrown value's own message, else the fallback. */
export function errorMessageOr(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}
