import {
  addDays,
  DEFAULT_ADMIN_TZ,
  formatInTimeZone,
  startOfDay,
} from '@/shared/utils/date'

export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

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
  } | null
  user: {
    id: string
    name: string
    email: string | null
    phone: string | null
  } | null
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
