/**
 * Pure logic of /payments/methods, moved out of the legacy PaymentMethodsListPage.tsx unchanged in
 * behaviour: the input cleaning, the upsert payloads (key order kept), the stats arithmetic and the copy.
 * The page and its tests read everything from here; nothing in this file touches React or Apollo.
 */

/** One entry of `whitelabelPaymentMethods.banks`, exactly the fields WHITELABEL_PAYMENT_METHODS selects. */
export interface BankDetail {
  id: string
  accountName: string
  accountNumber: string
  ifsc: string
  bankName: string
  branch: string
  notes?: string | null
  minAmount?: number | null
  maxAmount?: number | null
  weight: number
  enabled?: boolean
}

/** One entry of `whitelabelPaymentMethods.upis`. */
export interface UpiDetail {
  id: string
  upiId: string
  displayName?: string | null
  qrKey?: string | null
  qrUrl?: string | null
  minAmount?: number | null
  maxAmount?: number | null
  weight: number
  enabled?: boolean
}

export interface PaymentMethodLimits {
  min: number
  max: number
}

/** The part of `whitelabelPaymentMethods` the list page reads and writes back. */
export interface WhitelabelPaymentMethodsData {
  enabledMethods?: string[] | null
  banks?: BankDetail[] | null
  upis?: UpiDetail[] | null
  limits?: PaymentMethodLimits | null
}

/** The `UpsertWhitelabelPaymentMethodsInput` the page sends, in the legacy key order. */
export interface PaymentMethodsUpsertInput {
  enabledMethods: string[]
  banks: Record<string, unknown>[]
  upis: Record<string, unknown>[]
  limits: PaymentMethodLimits
}

export type PaymentMethodsTab = 'banks' | 'upis'
export type PaymentMethodType = 'bank' | 'upi'

export interface PaymentMethodCountStats {
  total: number
  active: number
  inactive: number
}

export interface PaymentMethodStats {
  banks: PaymentMethodCountStats
  upis: PaymentMethodCountStats
  total: number
  active: number
  /** Whole percent of enabled methods; 0 when there are none. */
  activeRate: number
}

/** One copyable line of a bank account's details cell. */
export interface BankDetailLine {
  key: 'accountNumber' | 'ifsc' | 'bankName' | 'branch'
  label: string
  value: string
  /** Account numbers and IFSC codes read as code. */
  mono: boolean
}

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
export const DELETE_CONFIRM_DESCRIPTION = 'This action cannot be undone. Continue?'

/** Used when the whitelabel has no stored limits yet, as before. */
const DEFAULT_LIMITS: PaymentMethodLimits = { min: 100, max: 500000 }

/** Remove `__typename` before sending; a missing `enabled` is sent as `true`. */
export function cleanBankForInput(bank: BankDetail): Record<string, unknown> {
  const { __typename: _t, ...cleaned } = bank as unknown as Record<string, unknown>
  void _t
  if (cleaned.enabled === undefined) {
    cleaned.enabled = true
  }
  return cleaned
}

/** Remove `__typename` and the presigned `qrUrl` (output only); a missing `enabled` is sent as `true`. */
export function cleanUpiForInput(upi: UpiDetail): Record<string, unknown> {
  const { __typename: _t, qrUrl: _q, ...cleaned } = upi as unknown as Record<string, unknown>
  void _t
  void _q
  if (cleaned.enabled === undefined) {
    cleaned.enabled = true
  }
  return cleaned
}

export function limitsForInput(methods: WhitelabelPaymentMethodsData | null | undefined): PaymentMethodLimits {
  return methods?.limits ? { min: methods.limits.min, max: methods.limits.max } : { ...DEFAULT_LIMITS }
}

function upsertInput(
  methods: WhitelabelPaymentMethodsData | null | undefined,
  banks: Record<string, unknown>[],
  upis: Record<string, unknown>[],
): PaymentMethodsUpsertInput {
  return {
    enabledMethods: methods?.enabledMethods || [],
    banks,
    upis,
    limits: limitsForInput(methods),
  }
}

function banksOf(methods: WhitelabelPaymentMethodsData | null | undefined): BankDetail[] {
  return methods?.banks ?? []
}

function upisOf(methods: WhitelabelPaymentMethodsData | null | undefined): UpiDetail[] {
  return methods?.upis ?? []
}

/** The whole method set without one bank; `banks: []` when the last one goes. */
export function buildDeleteBankInput(
  methods: WhitelabelPaymentMethodsData | null | undefined,
  bankId: string,
): PaymentMethodsUpsertInput {
  return upsertInput(
    methods,
    banksOf(methods).filter((bank) => bank.id !== bankId).map(cleanBankForInput),
    upisOf(methods).map(cleanUpiForInput),
  )
}

/** The whole method set without one UPI; `upis: []` when the last one goes. */
export function buildDeleteUpiInput(
  methods: WhitelabelPaymentMethodsData | null | undefined,
  upiId: string,
): PaymentMethodsUpsertInput {
  return upsertInput(
    methods,
    banksOf(methods).map(cleanBankForInput),
    upisOf(methods).filter((upi) => upi.id !== upiId).map(cleanUpiForInput),
  )
}

/** The whole method set with one bank's `enabled` replaced. */
export function buildToggleBankInput(
  methods: WhitelabelPaymentMethodsData | null | undefined,
  bankId: string,
  enabled: boolean,
): PaymentMethodsUpsertInput {
  return upsertInput(
    methods,
    banksOf(methods).map((bank) => {
      const cleaned = cleanBankForInput(bank)
      if (bank.id === bankId) cleaned.enabled = enabled
      return cleaned
    }),
    upisOf(methods).map(cleanUpiForInput),
  )
}

/** The whole method set with one UPI's `enabled` replaced. */
export function buildToggleUpiInput(
  methods: WhitelabelPaymentMethodsData | null | undefined,
  upiId: string,
  enabled: boolean,
): PaymentMethodsUpsertInput {
  return upsertInput(
    methods,
    banksOf(methods).map(cleanBankForInput),
    upisOf(methods).map((upi) => {
      const cleaned = cleanUpiForInput(upi)
      if (upi.id === upiId) cleaned.enabled = enabled
      return cleaned
    }),
  )
}

function countStats(rows: readonly { enabled?: boolean }[]): PaymentMethodCountStats {
  const active = rows.filter((row) => row.enabled).length
  return { total: rows.length, active, inactive: rows.filter((row) => !row.enabled).length }
}

/** The four legacy stat cards' figures. */
export function paymentMethodStats(banks: readonly BankDetail[], upis: readonly UpiDetail[]): PaymentMethodStats {
  const bankStats = countStats(banks)
  const upiStats = countStats(upis)
  const total = banks.length + upis.length
  const active = bankStats.active + upiStats.active
  return {
    banks: bankStats,
    upis: upiStats,
    total,
    active,
    activeRate: total > 0 ? Math.round((active / total) * 100) : 0,
  }
}

/** The page the table shows: past the last page (after a delete), the last page is shown instead. */
export function clampPage(page: number, total: number, pageSize: number): number {
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pageCount)
}

/** Client-side paging over the full list, as the legacy page did. */
export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = (clampPage(page, rows.length, pageSize) - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

export function accountCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'account' : 'accounts'}`
}

export function tabTitle(tab: PaymentMethodsTab): string {
  return tab === 'banks' ? 'Bank Accounts' : 'UPI Accounts'
}

export function tabEmptyTitle(tab: PaymentMethodsTab): string {
  return tab === 'banks' ? 'No bank accounts found' : 'No UPI accounts found'
}

/** The pagination's item name; the pager singularises it for one row. */
export function tabItemName(tab: PaymentMethodsTab): string {
  return tab === 'banks' ? 'bank accounts' : 'UPI accounts'
}

export function tabMethodType(tab: PaymentMethodsTab): PaymentMethodType {
  return tab === 'banks' ? 'bank' : 'upi'
}

export function addMethodLabel(tab: PaymentMethodsTab): string {
  return `Add ${tab === 'banks' ? 'Bank' : 'UPI'}`
}

export function addMethodPath(tab: PaymentMethodsTab): string {
  return `/payments/methods/create?type=${tabMethodType(tab)}`
}

export function editMethodPath(type: PaymentMethodType, id: string): string {
  return `/payments/methods/edit/${type}/${id}`
}

export function deleteConfirmTitle(type: PaymentMethodType): string {
  return type === 'bank' ? 'Delete Bank Account' : 'Delete UPI Account'
}

/** No minimum is shown as a dash. */
export function minLimitLabel(value: number | null | undefined, formatAmount: (amount: number) => string): string {
  return value !== null && value !== undefined ? formatAmount(value) : '—'
}

/** No maximum means unlimited. */
export function maxLimitLabel(value: number | null | undefined, formatAmount: (amount: number) => string): string {
  return value !== null && value !== undefined ? formatAmount(value) : '∞'
}

/** Filled stars out of five: a star fills when its number is at most the weight. */
export function priorityStarCount(weight: number | null | undefined): number {
  const value = weight || 0
  let filled = 0
  for (let star = 1; star <= 5; star += 1) {
    if (star <= value) filled += 1
  }
  return filled
}

export function bankDetailLines(bank: Pick<BankDetail, 'accountNumber' | 'ifsc' | 'bankName' | 'branch'>): BankDetailLine[] {
  return [
    { key: 'accountNumber', label: 'A/C No', value: bank.accountNumber || '', mono: true },
    { key: 'ifsc', label: 'IFSC', value: bank.ifsc || '', mono: true },
    { key: 'bankName', label: 'Bank', value: bank.bankName || '', mono: false },
    { key: 'branch', label: 'Branch', value: bank.branch || '', mono: false },
  ]
}

/** A UPI row is titled by its display name, else its VPA. */
export function upiTitle(upi: Pick<UpiDetail, 'displayName' | 'upiId'>): string {
  return upi.displayName || upi.upiId
}

export function hasQrCode(upi: Pick<UpiDetail, 'qrUrl' | 'qrKey'>): boolean {
  return Boolean(upi.qrUrl || upi.qrKey)
}

/** The failed image's address, cut at 50 characters as the legacy message printed it. */
export function qrUrlExcerpt(url: string): string {
  return `${url.substring(0, 50)}...`
}

/** The name a row's controls use in their accessible names: the shown title, else its kind. */
export function methodName(name: string | null | undefined, type: PaymentMethodType): string {
  return name || (type === 'bank' ? 'Bank account' : 'UPI account')
}

/** The status switch's accessible name; the visible Active/Inactive text sits beside it. */
export function statusSwitchLabel(name: string | null | undefined, type: PaymentMethodType): string {
  return `${methodName(name, type)} active`
}
