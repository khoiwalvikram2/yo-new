import {
  addDays,
  DEFAULT_ADMIN_TZ,
  formatInTimeZone,
  startOfDay,
} from '@/shared/utils/date'
import { CRYPTO_COIN, cryptoExplorerTxUrl, cryptoNetworkLabel, formatUsdt } from './cryptoWalletModel'

export interface DepositRequest {
  id: string
  userId: string
  amount: number
  currency: string
  method: 'BANK_TRANSFER' | 'UPI' | 'CRYPTO'
  /** The UTR; for CRYPTO, the transaction hash (TxID) the player pasted. */
  utr: string | null
  referenceId: string | null
  /** As stored: 'inline' (the screenshot is in the database), or 'manual', 'proof-missing', 'welivepay'. */
  proofKey: string
  /** The server says the request has a screenshot or a link to show; depositRequestProof reads it on demand. */
  hasProof: boolean
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  reviewerId: string | null
  reviewedAt: string | null
  note: string | null
  walletTxnId: string | null
  /** CRYPTO only: the USDT the player was asked to send. */
  cryptoAmount?: number | null
  /** CRYPTO only: deposit currency per 1 USDT when the request was made. */
  cryptoRate?: number | null
  /** CRYPTO only: the network of the wallet paid to, e.g. TRC20. */
  cryptoNetwork?: string | null
  /** CRYPTO only: the deposit bonus % in force when the request was made. */
  cryptoBonusPercent?: number | null
  /** CRYPTO only: the bonus paid into the cash wallet on approval, on top of the amount. */
  cryptoBonusAmount?: number | null
  /** CRYPTO only: the ledger entry of the bonus credit. */
  bonusWalletTxnId?: string | null
  createdAt: string
  updatedAt: string
  user: {
    id: string
    name: string
    email: string | null
    phone: string | null
  } | null
  /** Payment-gateway deposits only (WeLivePay): credited when the gateway confirms, never approved by hand. */
  gateway?: DepositGatewayInfo | null
}

/** The gateway pay-in behind a deposit (`DepositGatewayInfo`). */
export interface DepositGatewayInfo {
  provider: string
  /** Code of the gateway the pay-in used, e.g. QPC, IRISPAY. */
  gateway: string
  gatewayName: string
  /** Our order reference sent to the gateway. */
  orderId: string
  /** pending | success | expired | invalid */
  status: string
  txnRef: string | null
  /** When the checkout link expires; pending only. */
  expiresAt: string | null
}

/** The method filter's value for payment-gateway deposits; it filters by source, not by method. */
export const GATEWAY_METHOD_FILTER = 'GATEWAY'

/** A gateway deposit: credited only when the gateway confirms the payment, so it has no Approve or Reject. */
export function isGatewayDeposit(request: Pick<DepositRequest, 'gateway'> | null | undefined): boolean {
  return Boolean(request?.gateway)
}

/** Whether an admin may approve or reject the request: a pending, player-submitted one. */
export function canReviewDeposit(request: Pick<DepositRequest, 'status' | 'gateway'> | null | undefined): boolean {
  return request?.status === 'PENDING' && !isGatewayDeposit(request)
}

const GATEWAY_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'Awaiting payment',
  success: 'Paid',
  expired: 'Expired',
  invalid: 'Not started',
}

/** The gateway's state as the player also sees it: an unpaid checkout reads "Awaiting payment", then "Expired". */
export function gatewayStatusLabel(status: string): string {
  return GATEWAY_STATUS_LABELS[status] ?? status
}

/** A row's status: a gateway pay-in shows the gateway's state, a request its review state. */
export function depositRowStatusLabel(request: Pick<DepositRequest, 'status' | 'gateway'>): string {
  return request.gateway && request.gateway.status !== 'success'
    ? gatewayStatusLabel(request.gateway.status)
    : depositStatusLabel(request.status)
}

/** The method as a row shows it: a gateway pay-in names its gateway. */
export function depositRowMethodLabel(request: Pick<DepositRequest, 'method' | 'gateway'>): string {
  return request.gateway ? `Gateway · ${request.gateway.gatewayName}` : depositMethodLabel(request.method)
}

/** Why a gateway deposit has no review actions. */
export function gatewayDepositNotice(gateway: Pick<DepositGatewayInfo, 'status'>): string {
  if (gateway.status === 'success') return 'Credited automatically when WeLivePay confirmed the payment.'
  return 'Credited automatically once WeLivePay confirms the payment, including a late payment. It cannot be approved or rejected by hand.'
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
  /** GATEWAY: payment-gateway deposits only (the "Payment Gateway" method choice). */
  source?: 'GATEWAY'
  query?: string
  fromDate?: string
  toDate?: string
  /** Also list gateway pay-ins not yet credited (awaiting payment, expired), as the player's history does. */
  includeGatewayOrders: true
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
  const gatewayOnly = method === GATEWAY_METHOD_FILTER

  return {
    status: status || undefined,
    method: (gatewayOnly ? '' : method) || undefined,
    ...(gatewayOnly ? { source: 'GATEWAY' as const } : {}),
    query: trimmedQuery.length >= 2 ? trimmedQuery : undefined,
    fromDate: range.from,
    toDate: range.to,
    includeGatewayOrders: true,
  }
}

/**
 * Whether a request has a payment proof to show, as the server answers it (hasProof). Screenshots are stored in the
 * database since 2026-11-04 (proofKey 'inline'), so proofKey alone no longer says: a sentinel ('manual',
 * 'proof-missing', 'welivepay') or a cleared S3 key has no proof unless a screenshot is stored with it.
 */
export function hasDepositProof(request: Pick<DepositRequest, 'hasProof'> | null | undefined): boolean {
  return request?.hasProof === true
}

/**
 * depositRequestProof's answer as an image source: a screenshot (a data:image/ URI) or an http(s) link. Anything
 * else, null included, is no proof to show.
 */
export function depositProofImageSource(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const source = value.trim()
  return /^data:image\//i.test(source) || /^https?:\/\/\S/i.test(source) ? source : null
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

/** The method as the table, drawer and export show it: "Crypto (USDT)", else the stored value spaced out. */
export function depositMethodLabel(method: string): string {
  return method === 'CRYPTO' ? `Crypto (${CRYPTO_COIN})` : method.replace(/_/g, ' ')
}

/** A long transaction hash cut for a table cell: its start and end, which is what an admin compares. */
export function shortTxHash(hash: string): string {
  const value = hash.trim()
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}

type CryptoDepositFields = Pick<
  DepositRequest,
  'amount' | 'currency' | 'status' | 'utr' | 'cryptoAmount' | 'cryptoRate' | 'cryptoNetwork' | 'cryptoBonusPercent' | 'cryptoBonusAmount'
>

/** What the drawer shows for a crypto deposit, as text; a missing figure is a dash. */
export interface CryptoDepositSummary {
  /** "108.11 USDT": what the admin looks for on the chain. */
  usdt: string
  network: string
  /** "1 USDT = ₹92.50", the rate quoted when the request was made. */
  rate: string
  /** "5% · ₹500.00 paid on approval"; null when the request carries no bonus. */
  bonus: string | null
  /** The TxID the player pasted, trimmed; null when there is none. */
  txHash: string | null
  /** The TxID on the network's block explorer; null for an unknown network or no TxID. */
  explorerUrl: string | null
}

function bonusState(status: DepositRequest['status']): string {
  if (status === 'APPROVED') return 'credited'
  if (status === 'PENDING') return 'paid on approval'
  return 'not paid'
}

export function cryptoDepositSummary(
  request: CryptoDepositFields,
  formatAmount: (amount: number, currency?: string) => string,
): CryptoDepositSummary {
  const bonusAmount = Number(request.cryptoBonusAmount ?? 0)
  const txHash = request.utr?.trim() || null
  return {
    usdt: request.cryptoAmount != null ? formatUsdt(request.cryptoAmount) : '—',
    network: cryptoNetworkLabel(request.cryptoNetwork),
    rate: request.cryptoRate != null ? `1 ${CRYPTO_COIN} = ${formatAmount(request.cryptoRate, request.currency)}` : '—',
    bonus: bonusAmount > 0
      ? `${request.cryptoBonusPercent ?? 0}% · ${formatAmount(bonusAmount, request.currency)} ${bonusState(request.status)}`
      : null,
    txHash,
    explorerUrl: cryptoExplorerTxUrl(request.cryptoNetwork, txHash),
  }
}

export const APPROVE_CONFIRM_DESCRIPTION = "This will credit the player's wallet. Are you sure?"

/** The approval question; a crypto deposit with a bonus also names the bonus that approving pays out. */
export function approveConfirmDescription(
  request: Pick<DepositRequest, 'method' | 'currency' | 'cryptoBonusAmount'>,
  formatAmount: (amount: number, currency?: string) => string,
): string {
  const bonusAmount = Number(request.cryptoBonusAmount ?? 0)
  if (request.method !== 'CRYPTO' || !(bonusAmount > 0)) return APPROVE_CONFIRM_DESCRIPTION
  return `This will credit the player's wallet with the deposit and a ${formatAmount(bonusAmount, request.currency)} crypto bonus. Are you sure?`
}
