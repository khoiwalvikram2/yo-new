/**
 * Pure logic of /payments/methods, moved out of the legacy PaymentMethodsListPage.tsx unchanged in
 * behaviour: the input cleaning, the upsert payloads (key order kept), the stats arithmetic and the copy.
 * Crypto wallets (USDT) were added later: their saves send only what changes (the wallet list, the rate
 * or the bonus), because the server keeps whatever an upsert omits.
 * The page and its tests read everything from here; nothing in this file touches React or Apollo.
 */
import {
  CRYPTO_BONUS_MAX_PERCENT,
  CRYPTO_COIN,
  CRYPTO_RATE_MAX,
  cryptoAmountFor,
  cryptoBonusFor,
  parseCryptoBonusPercent,
} from './cryptoWalletModel'

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

/** One entry of `whitelabelPaymentMethods.cryptos`: a USDT wallet on one network; `qrUrl` is output only. */
export interface CryptoDetail {
  id: string
  network: string
  walletAddress: string
  displayName?: string | null
  qrKey?: string | null
  qrUrl?: string | null
  minAmount?: number | null
  maxAmount?: number | null
  weight: number
  enabled?: boolean
  vipTierIds?: string[] | null
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
  cryptos?: CryptoDetail[] | null
  /** Deposit currency per 1 USDT, one for the whole whitelabel; null until set (players then see no wallet). */
  cryptoRate?: number | null
  /** Extra % paid into the cash wallet on every approved crypto deposit; null for none. */
  cryptoBonusPercent?: number | null
  limits?: PaymentMethodLimits | null
}

/** The `UpsertWhitelabelPaymentMethodsInput` the page sends, in the legacy key order. */
export interface PaymentMethodsUpsertInput {
  enabledMethods: string[]
  banks: Record<string, unknown>[]
  upis: Record<string, unknown>[]
  limits: PaymentMethodLimits
}

/**
 * A crypto save: exactly one of the wallet list, the rate or the bonus. Everything an upsert omits (bank
 * accounts, UPI IDs, limits, the other crypto settings) is kept as stored by the server.
 */
export type CryptoUpsertInput = CryptoWalletsInput | CryptoRateInput | CryptoBonusInput
export interface CryptoWalletsInput {
  cryptos: Record<string, unknown>[]
}
export interface CryptoRateInput {
  cryptoRate: number
}
export interface CryptoBonusInput {
  cryptoBonusPercent: number
}

export type PaymentMethodsTab = 'banks' | 'upis' | 'cryptos'
export type PaymentMethodType = 'bank' | 'upi' | 'crypto'

export interface PaymentMethodCountStats {
  total: number
  active: number
  inactive: number
}

export interface PaymentMethodStats {
  banks: PaymentMethodCountStats
  upis: PaymentMethodCountStats
  cryptos: PaymentMethodCountStats
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

/** Remove `__typename` and the displayable `qrUrl` (output only); a missing `enabled` is sent as `true`. */
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

/**
 * Remove `__typename` and the output-only `qrUrl`; a missing `enabled` is sent as `true`. Everything else,
 * VIP tier access included, goes back as stored.
 */
export function cleanCryptoForInput(crypto: CryptoDetail): Record<string, unknown> {
  const { __typename: _t, qrUrl: _q, ...cleaned } = crypto as unknown as Record<string, unknown>
  void _t
  void _q
  if (cleaned.enabled === undefined) {
    cleaned.enabled = true
  }
  return cleaned
}

function cryptosOf(methods: WhitelabelPaymentMethodsData | null | undefined): CryptoDetail[] {
  return methods?.cryptos ?? []
}

/** Only the wallet list without one wallet; `cryptos: []` when the last one goes. */
export function buildDeleteCryptoInput(
  methods: WhitelabelPaymentMethodsData | null | undefined,
  cryptoId: string,
): CryptoWalletsInput {
  return { cryptos: cryptosOf(methods).filter((crypto) => crypto.id !== cryptoId).map(cleanCryptoForInput) }
}

/** Only the wallet list, with one wallet's `enabled` replaced. */
export function buildToggleCryptoInput(
  methods: WhitelabelPaymentMethodsData | null | undefined,
  cryptoId: string,
  enabled: boolean,
): CryptoWalletsInput {
  return {
    cryptos: cryptosOf(methods).map((crypto) => {
      const cleaned = cleanCryptoForInput(crypto)
      if (crypto.id === cryptoId) cleaned.enabled = enabled
      return cleaned
    }),
  }
}

/** Only the rate. The server can replace the rate but never clear it, so there is no empty variant. */
export function buildCryptoRateInput(rate: number): CryptoRateInput {
  return { cryptoRate: rate }
}

/** Only the bonus; an empty field is sent as 0, which switches the bonus off. */
export function buildCryptoBonusInput(percent: number | null): CryptoBonusInput {
  return { cryptoBonusPercent: percent ?? 0 }
}

function countStats(rows: readonly { enabled?: boolean }[]): PaymentMethodCountStats {
  const active = rows.filter((row) => row.enabled).length
  return { total: rows.length, active, inactive: rows.filter((row) => !row.enabled).length }
}

/** The stat cards' figures: one card per method type, then the totals and active rate across all three. */
export function paymentMethodStats(
  banks: readonly BankDetail[],
  upis: readonly UpiDetail[],
  cryptos: readonly CryptoDetail[] = [],
): PaymentMethodStats {
  const bankStats = countStats(banks)
  const upiStats = countStats(upis)
  const cryptoStats = countStats(cryptos)
  const total = banks.length + upis.length + cryptos.length
  const active = bankStats.active + upiStats.active + cryptoStats.active
  return {
    banks: bankStats,
    upis: upiStats,
    cryptos: cryptoStats,
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

/** The table card's count: accounts for banks and UPIs, wallets for crypto. */
export function tabCountLabel(tab: PaymentMethodsTab, count: number): string {
  if (tab !== 'cryptos') return accountCountLabel(count)
  return `${count} ${count === 1 ? 'wallet' : 'wallets'}`
}

const TAB_COPY: Record<PaymentMethodsTab, {
  title: string
  empty: string
  itemName: string
  type: PaymentMethodType
  add: string
}> = {
  banks: { title: 'Bank Accounts', empty: 'No bank accounts found', itemName: 'bank accounts', type: 'bank', add: 'Bank' },
  upis: { title: 'UPI Accounts', empty: 'No UPI accounts found', itemName: 'UPI accounts', type: 'upi', add: 'UPI' },
  cryptos: { title: 'Crypto Wallets', empty: 'No crypto wallets found', itemName: 'crypto wallets', type: 'crypto', add: 'Crypto' },
}

export function tabTitle(tab: PaymentMethodsTab): string {
  return TAB_COPY[tab].title
}

export function tabEmptyTitle(tab: PaymentMethodsTab): string {
  return TAB_COPY[tab].empty
}

/** The pagination's item name; the pager singularises it for one row. */
export function tabItemName(tab: PaymentMethodsTab): string {
  return TAB_COPY[tab].itemName
}

export function tabMethodType(tab: PaymentMethodsTab): PaymentMethodType {
  return TAB_COPY[tab].type
}

export function addMethodLabel(tab: PaymentMethodsTab): string {
  return `Add ${TAB_COPY[tab].add}`
}

export function addMethodPath(tab: PaymentMethodsTab): string {
  return `/payments/methods/create?type=${tabMethodType(tab)}`
}

export function editMethodPath(type: PaymentMethodType, id: string): string {
  return `/payments/methods/edit/${type}/${id}`
}

const DELETE_TITLES: Record<PaymentMethodType, string> = {
  bank: 'Delete Bank Account',
  upi: 'Delete UPI Account',
  crypto: 'Delete Crypto Wallet',
}

export function deleteConfirmTitle(type: PaymentMethodType): string {
  return DELETE_TITLES[type]
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

/** A QR is on record: its data URI, or a legacy stored value the server can no longer serve (qrKey without qrUrl). */
export function hasQrCode(upi: Pick<UpiDetail, 'qrUrl' | 'qrKey'>): boolean {
  return Boolean(upi.qrUrl || upi.qrKey)
}

const METHOD_KIND_NAMES: Record<PaymentMethodType, string> = {
  bank: 'Bank account',
  upi: 'UPI account',
  crypto: 'Crypto wallet',
}

/** The name a row's controls use in their accessible names: the shown title, else its kind. */
export function methodName(name: string | null | undefined, type: PaymentMethodType): string {
  return name || METHOD_KIND_NAMES[type]
}

/** The status switch's accessible name; the visible Active/Inactive text sits beside it. */
export function statusSwitchLabel(name: string | null | undefined, type: PaymentMethodType): string {
  return `${methodName(name, type)} active`
}

/* ---------- crypto settings: one USDT rate and one deposit bonus per whitelabel ---------- */

/** The round deposit the rate and bonus examples are worked on. */
export const CRYPTO_SAMPLE_DEPOSIT = 10000

export const CRYPTO_NO_RATE_NOTICE =
  `Set the ${CRYPTO_COIN} rate to start crypto deposits. Players do not see crypto wallets until a rate is saved.`

/** Formats an amount in the deposit currency; `wholeUnits` drops the decimals (for the round sample). */
export type FormatDepositAmount = (amount: number, wholeUnits?: boolean) => string

/** Why a typed rate cannot be saved, or null. An empty field has nothing to save: a rate can only be replaced. */
export function cryptoRateDraftError(draft: number | null): string | null {
  if (draft === null) return null
  if (!Number.isFinite(draft) || draft <= 0) return `The ${CRYPTO_COIN} rate must be above 0`
  if (draft > CRYPTO_RATE_MAX) return `The ${CRYPTO_COIN} rate can be at most ${CRYPTO_RATE_MAX.toLocaleString('en-IN')}`
  return null
}

/** Save Rate is offered for a valid rate that differs from the stored one. */
export function canSaveCryptoRate(draft: number | null, saved: number | null | undefined): boolean {
  return draft !== null && cryptoRateDraftError(draft) === null && draft !== (saved ?? null)
}

/** Why a typed bonus cannot be saved, or null. An empty field means 0: no bonus. */
export function cryptoBonusDraftError(draft: number | null): string | null {
  if (draft === null) return null
  if (!Number.isFinite(draft) || draft < 0) return 'Crypto bonus cannot be negative'
  if (draft > CRYPTO_BONUS_MAX_PERCENT) return `Crypto bonus can be at most ${CRYPTO_BONUS_MAX_PERCENT}%`
  return null
}

/** Save Bonus is offered for a valid percent that differs from the stored one (empty and 0 are both "none"). */
export function canSaveCryptoBonus(draft: number | null, saved: number | null | undefined): boolean {
  return cryptoBonusDraftError(draft) === null && (draft ?? 0) !== (saved ?? 0)
}

/**
 * The rate the example is worked on: the typed one while it is valid, so a rate entered the wrong way round
 * shows before it is saved; else the stored one (an empty field keeps the stored rate).
 */
export function cryptoRatePreview(draft: number | null, saved: number | null | undefined): number | null {
  return draft !== null && cryptoRateDraftError(draft) === null ? draft : saved ?? null
}

/** The bonus the example is worked on: the typed one (empty is none) while it is valid, else the stored one. */
export function cryptoBonusPreview(draft: number | null, saved: number | null | undefined): number | null {
  return cryptoBonusDraftError(draft) === null ? draft : saved ?? null
}

/** What a round deposit asks the player to send at `rate`; USDT is rounded up, as the server quotes it. */
export function cryptoRateExample(rate: number | null | undefined, formatAmount: FormatDepositAmount): string {
  const usdt = cryptoAmountFor(CRYPTO_SAMPLE_DEPOSIT, rate)
  if (usdt === null) return 'No rate saved yet'
  return `A ${formatAmount(CRYPTO_SAMPLE_DEPOSIT, true)} deposit asks the player for ${usdt.toFixed(2)} ${CRYPTO_COIN}`
}

/** What a round deposit earns at `percent`; the bonus is rounded down to the paisa, as the server pays it. */
export function cryptoBonusExample(percent: number | null | undefined, formatAmount: FormatDepositAmount): string {
  if (parseCryptoBonusPercent(percent) === null) {
    return `No bonus. Set up to ${CRYPTO_BONUS_MAX_PERCENT}% to add an extra % to every approved crypto deposit.`
  }
  const bonus = cryptoBonusFor(CRYPTO_SAMPLE_DEPOSIT, percent)
  return `On approval a ${formatAmount(CRYPTO_SAMPLE_DEPOSIT, true)} crypto deposit also gets ${formatAmount(bonus)} bonus `
    + `in the cash wallet (${formatAmount(CRYPTO_SAMPLE_DEPOSIT + bonus)} in all)`
}
