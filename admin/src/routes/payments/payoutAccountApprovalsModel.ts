/** The approval states `PayoutAccountApprovalStatus` defines (admin-backend payments.graphql). */
export type PayoutApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/** One row of `adminPayoutAccounts`, exactly the fields ADMIN_PAYOUT_ACCOUNTS selects. */
export interface PayoutAccountItem {
  id: string
  userId: string
  method: string
  accountNumber: string
  ifscCode: string | null
  bankName: string | null
  accountHolderName: string
  approvalStatus: PayoutApprovalStatus
  rejectionReason: string | null
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  user: {
    id: string
    name: string | null
    phone: string | null
    email: string | null
  } | null
}

/** The applied date filter: two `yyyy-MM-dd` days, or neither (all dates, the legacy default). */
export interface PayoutDateRange {
  from?: string
  to?: string
}

/** The legacy filter had only a custom range picker; "all" is its cleared, unfiltered state. */
export type PayoutDatePreset = 'all' | 'custom'

/** Filter fields for adminPayoutAccounts (excluding offset/limit). */
export interface PayoutAccountsFilter {
  status?: string
  query?: string
  fromDate?: string
  toDate?: string
}

export interface PayoutAccountStats {
  total: number
  pending: number
  approved: number
  rejected: number
  approvalRate: number
  rejectionRate: number
}

export interface PayoutAccountStatsItem {
  approvalStatus?: string | null
}

/** One copyable account line: the table's compact summary or the drawer's description row. */
export interface PayoutAccountLine {
  key: 'holder' | 'number' | 'ifsc' | 'bank'
  label: string
  value: string
  /** Account numbers, VPAs and IFSC codes read as code. */
  mono: boolean
}

type PayoutAccountFields = Pick<
  PayoutAccountItem,
  'method' | 'accountHolderName' | 'accountNumber' | 'ifscCode' | 'bankName'
>

/** A complete range filters by date; anything else is the unfiltered state, as the legacy page reset it. */
export function normalizePayoutDateRange(range: PayoutDateRange | null | undefined): PayoutDateRange {
  return range?.from && range.to ? { from: range.from, to: range.to } : {}
}

export function getPayoutDatePreset(range: PayoutDateRange | null | undefined): PayoutDatePreset {
  return range?.from && range.to ? 'custom' : 'all'
}

/**
 * Build the server filter in the legacy key order. An empty status is omitted, and the debounced
 * search is sent as-is once it has two trimmed characters (useSearch has already trimmed it).
 */
export function buildPayoutAccountFilter(
  status: string,
  debouncedQuery: string,
  range: PayoutDateRange,
): PayoutAccountsFilter {
  return {
    status: status || undefined,
    query: debouncedQuery && debouncedQuery.trim().length >= 2 ? debouncedQuery : undefined,
    fromDate: range.from,
    toDate: range.to,
  }
}

/** Search text, a status and a date range each count once while applied. */
export function countPayoutFilters(
  query: string,
  status: string,
  range: PayoutDateRange | null | undefined,
): number {
  return [query, status, getPayoutDatePreset(range) === 'custom'].filter(Boolean).length
}

/** Only a Pending account can still be approved or rejected. */
export function isPendingPayoutAccount(status: string | null | undefined): boolean {
  return status === 'PENDING'
}

/** The legacy method tag: UPI, and every other method reads Bank. */
export function payoutMethodLabel(method: string | null | undefined): 'UPI' | 'Bank' {
  return method === 'UPI' ? 'UPI' : 'Bank'
}

/** UPI takes the informational tone and Bank stays neutral; the label, not the tone, names the method. */
export function payoutMethodTone(method: string | null | undefined): 'info' | 'neutral' {
  return method === 'UPI' ? 'info' : 'neutral'
}

/** A UPI account carries its VPA in accountNumber; every other method carries a bank account number. */
export function payoutAccountNumberLabel(method: string | null | undefined): string {
  return method === 'UPI' ? 'UPI ID' : 'Account Number'
}

type PayoutAccountLineCandidate = Omit<PayoutAccountLine, 'value'> & { value: string | null | undefined }

function presentLines(lines: PayoutAccountLineCandidate[]): PayoutAccountLine[] {
  return lines.filter((line): line is PayoutAccountLine => line.value != null && line.value !== '')
}

/**
 * The table's account summary. A BANK account lists holder, number, IFSC and bank; any other
 * method lists holder and UPI ID. A missing or empty value leaves its line out, as before.
 */
export function payoutAccountSummaryLines(account: PayoutAccountFields): PayoutAccountLine[] {
  if (account.method === 'BANK') {
    return presentLines([
      { key: 'holder', label: 'Holder', value: account.accountHolderName, mono: false },
      { key: 'number', label: 'Account No', value: account.accountNumber, mono: true },
      { key: 'ifsc', label: 'IFSC', value: account.ifscCode, mono: true },
      { key: 'bank', label: 'Bank', value: account.bankName, mono: false },
    ])
  }
  return presentLines([
    { key: 'holder', label: 'Holder', value: account.accountHolderName, mono: false },
    { key: 'number', label: 'UPI ID', value: account.accountNumber, mono: true },
  ])
}

/** The drawer's account rows, in the legacy order, leaving out missing or empty values. */
export function payoutAccountDetailLines(account: PayoutAccountFields): PayoutAccountLine[] {
  return presentLines([
    { key: 'holder', label: 'Account Holder Name', value: account.accountHolderName, mono: false },
    { key: 'number', label: payoutAccountNumberLabel(account.method), value: account.accountNumber, mono: true },
    { key: 'ifsc', label: 'IFSC', value: account.ifscCode, mono: true },
    { key: 'bank', label: 'Bank Name', value: account.bankName, mono: false },
  ])
}

/** The table's second user line prefers the phone; the drawer prefers the email. */
export function payoutTableContact(user: PayoutAccountItem['user']): string {
  return user?.phone || user?.email || '—'
}

export function payoutDrawerContact(user: PayoutAccountItem['user']): string {
  return user?.email || user?.phone || 'No contact info'
}

export function calculatePayoutAccountStats(items: readonly PayoutAccountStatsItem[]): PayoutAccountStats {
  let pending = 0
  let approved = 0
  let rejected = 0

  for (const item of items) {
    if (item.approvalStatus === 'PENDING') pending += 1
    else if (item.approvalStatus === 'APPROVED') approved += 1
    else if (item.approvalStatus === 'REJECTED') rejected += 1
  }

  const total = items.length
  return {
    total,
    pending,
    approved,
    rejected,
    approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
    rejectionRate: total > 0 ? Math.round((rejected / total) * 100) : 0,
  }
}

export function buildApprovePayoutAccountInput(id: string) {
  return { id }
}

/** The optional rejection reason is trimmed and omitted when blank. */
export function buildRejectPayoutAccountInput(id: string, reason: string) {
  return {
    id,
    reason: reason.trim() || undefined,
  }
}

const PAYOUT_STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
}

export function payoutStatusLabel(status: string): string {
  return PAYOUT_STATUS_LABELS[status] ?? status
}

/** The legacy export toast showed any thrown message and fell back to a generic sentence. */
export function exportFailureMessage(error: unknown): string {
  const message = typeof error === 'object' && error !== null
    ? (error as { message?: unknown }).message
    : undefined
  return typeof message === 'string' && message ? message : 'Something went wrong during export.'
}
