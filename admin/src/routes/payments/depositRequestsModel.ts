import {
  addDays,
  DEFAULT_ADMIN_TZ,
  formatInTimeZone,
  startOfDay,
} from '@/shared/utils/date'

export interface DepositRequest {
  id: string
  userId: string
  amount: number
  currency: string
  method: 'BANK_TRANSFER' | 'UPI'
  utr: string | null
  referenceId: string | null
  proofKey: string
  proofUrl: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  reviewerId: string | null
  reviewedAt: string | null
  note: string | null
  walletTxnId: string | null
  createdAt: string
  updatedAt: string
  user: {
    id: string
    name: string
    email: string | null
    phone: string | null
  } | null
}

export interface DepositDateRange {
  from?: string
  to?: string
}

export type DepositDatePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'custom'

export interface DepositRequestsFilter {
  status?: string
  method?: string
  query?: string
  fromDate?: string
  toDate?: string
}

export interface DepositStats {
  totalRequests: number
  pending: number
  approved: number
  rejected: number
  totalAmount: number
  approvalRate: number
  rejectionRate: number
}

export interface DepositStatsItem {
  status?: string | null
  amount?: string | number | null
}

function calendarDate(date: Date): string {
  return formatInTimeZone(date, 'yyyy-MM-dd', DEFAULT_ADMIN_TZ)
}

function relativeCalendarDate(now: Date, days: number): string {
  return calendarDate(addDays(startOfDay(now, DEFAULT_ADMIN_TZ), days))
}

/** Resolve the preset with the same inclusive calendar windows used by the deposit filters. */
export function getDepositRangeForPreset(
  preset: DepositDatePreset,
  now: Date = new Date(),
): DepositDateRange | null {
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

/** Infer a known preset from a controlled date range; incomplete ranges retain the Today default. */
export function getDepositPresetFromRange(
  range: DepositDateRange | null | undefined,
  now: Date = new Date(),
): DepositDatePreset {
  if (!range?.from || !range.to) return 'today'

  const presets: readonly Exclude<DepositDatePreset, 'custom'>[] = [
    'today',
    'yesterday',
    'last7days',
    'last30days',
  ]

  for (const preset of presets) {
    const candidate = getDepositRangeForPreset(preset, now)
    if (candidate?.from === range.from && candidate.to === range.to) return preset
  }

  return 'custom'
}

/** Build the server filter while omitting empty values and too-short search terms. */
export function buildDepositRequestFilter(
  status: string,
  method: string,
  debouncedQuery: string,
  range: DepositDateRange,
): DepositRequestsFilter {
  const trimmedQuery = debouncedQuery.trim()

  return {
    status: status || undefined,
    method: method || undefined,
    query: trimmedQuery.length >= 2 ? trimmedQuery : undefined,
    fromDate: range.from,
    toDate: range.to,
  }
}

/** True only for a persisted deposit image, never manual or placeholder proof metadata. */
export function hasValidDepositProof(
  request: Pick<DepositRequest, 'proofKey' | 'proofUrl'>,
): boolean {
  if (request.proofKey === 'manual' || request.proofKey === 'proof-missing') return false
  if (typeof request.proofUrl !== 'string') return false

  const proofUrl = request.proofUrl.trim()
  if (!proofUrl || proofUrl === 'null' || proofUrl === 'undefined') return false

  if (typeof request.proofKey !== 'string') return false
  const proofKey = request.proofKey.trim()
  return proofKey.startsWith('deposits/') && proofKey.includes('.')
}

export function calculateDepositStats(items: readonly DepositStatsItem[]): DepositStats {
  let pending = 0
  let approved = 0
  let rejected = 0
  let totalAmount = 0

  for (const item of items) {
    if (item.status === 'PENDING') pending += 1
    if (item.status === 'REJECTED') rejected += 1
    if (item.status !== 'APPROVED') continue

    approved += 1
    const amount = Number(item.amount ?? 0)
    if (Number.isFinite(amount)) totalAmount += amount
  }

  const totalRequests = items.length
  return {
    totalRequests,
    pending,
    approved,
    rejected,
    totalAmount,
    approvalRate: totalRequests > 0 ? Math.round((approved / totalRequests) * 100) : 0,
    rejectionRate: totalRequests > 0 ? Math.round((rejected / totalRequests) * 100) : 0,
  }
}

const DEPOSIT_STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

export function depositStatusLabel(status: string): string {
  return DEPOSIT_STATUS_LABELS[status] ?? status
}
