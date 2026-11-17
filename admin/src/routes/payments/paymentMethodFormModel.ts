/**
 * Pure logic of /payments/methods/create and /payments/methods/edit/:type/:id, moved out of the legacy
 * PaymentMethodCreateEditPage.tsx: the method type, the per-step fields and their rules, the record's
 * form values, the exact upsert payload (legacy key order and cleaning) and the review rows and copy.
 * Crypto wallets (USDT) came later: a wallet save sends only the wallet list, since the server keeps
 * whatever an upsert omits.
 */
import { z } from 'zod'
import {
  CRYPTO_COIN,
  DEFAULT_CRYPTO_NETWORK,
  cryptoNetworkLabel,
  isCryptoNetwork,
  walletAddressError,
} from './cryptoWalletModel'

export type PaymentMethodKind = 'bank' | 'upi' | 'crypto'

/** The stored bank account, as WHITELABEL_PAYMENT_METHODS returns it. */
export interface StoredBank {
  vipTierIds?: string[] | null
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

/** The stored UPI account; `qrUrl` is output only. */
export interface StoredUpi {
  vipTierIds?: string[] | null
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

/** The stored USDT wallet; `qrUrl` is output only. */
export interface StoredCrypto {
  vipTierIds?: string[] | null
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
}

export interface StoredPaymentMethods {
  enabledMethods?: string[] | null
  banks?: StoredBank[] | null
  upis?: StoredUpi[] | null
  cryptos?: StoredCrypto[] | null
  /** The whitelabel's USDT rate (deposit currency per 1 USDT); null until one is saved. */
  cryptoRate?: number | null
  limits?: { min: number; max: number } | null
}

/** The `UpsertWhitelabelPaymentMethodsInput` the form sends, in the legacy key order. */
export interface PaymentMethodsUpsertInput {
  enabledMethods: string[]
  banks: Record<string, unknown>[]
  upis: Record<string, unknown>[]
  limits: { min: number; max: number }
}

/** A wallet save: the wallet list alone. Banks, UPIs, limits and the crypto rate and bonus stay as stored. */
export interface CryptoMethodsUpsertInput {
  cryptos: Record<string, unknown>[]
}

const formSchema = z.object({
  vipTierIds: z.array(z.string()).nullable().optional(),
  accountName: z.string(),
  accountNumber: z.string(),
  ifsc: z.string(),
  bankName: z.string(),
  branch: z.string(),
  notes: z.string(),
  upiId: z.string(),
  network: z.string(),
  walletAddress: z.string(),
  displayName: z.string(),
  qrKey: z.string().nullable(),
  minAmount: z.number().nullable(),
  maxAmount: z.number().nullable(),
  weight: z.number().nullable(),
  enabled: z.boolean(),
})

export type PaymentMethodFormValues = z.infer<typeof formSchema>
export type PaymentMethodFieldName = keyof PaymentMethodFormValues

export const BANK_DETAIL_FIELDS = ['accountName', 'accountNumber', 'ifsc', 'bankName', 'branch'] as const
export const UPI_DETAIL_FIELDS = ['upiId'] as const
export const CRYPTO_DETAIL_FIELDS = ['network', 'walletAddress'] as const
export const LIMIT_FIELDS = ['minAmount', 'maxAmount', 'weight', 'enabled', 'vipTierIds'] as const

export const METHODS_LIST_PATH = '/payments/methods'
export const STEP_COUNT = 3
export const REQUIRED_MESSAGE = 'Required'
export const MAX_BELOW_MIN_MESSAGE = 'Must be > min'

/** Each step's legacy title, description and the short label the compact indicator showed. */
export interface StepCopy {
  title: string
  description: string
  short: string
}

/** The form a type shows: a bank, a crypto wallet, and anything else the UPI form, as before. */
export function methodKindOf(type: string | null | undefined): PaymentMethodKind {
  return type === 'bank' ? 'bank' : type === 'crypto' ? 'crypto' : 'upi'
}

const DETAIL_STEPS: Record<PaymentMethodKind, StepCopy> = {
  bank: { title: 'Bank Details', description: 'Account holder & routing', short: 'Bank Details' },
  upi: { title: 'UPI Details', description: 'UPI handle & QR', short: 'UPI Details' },
  crypto: { title: 'Wallet Details', description: 'Network, address & QR', short: 'Wallet Details' },
}

export function stepsFor(kind: PaymentMethodKind): StepCopy[] {
  return [
    { ...DETAIL_STEPS[kind] },
    { title: 'Limits & Priority', description: 'Tiers, weight & status', short: 'Limits' },
    { title: 'Review & Save', description: 'Confirm before publishing', short: 'Review' },
  ]
}

const DETAIL_FIELDS: Record<PaymentMethodKind, readonly PaymentMethodFieldName[]> = {
  bank: BANK_DETAIL_FIELDS,
  upi: UPI_DETAIL_FIELDS,
  crypto: CRYPTO_DETAIL_FIELDS,
}

/** The fields a step's Next validates, as the legacy validateFields lists did. */
export function stepFields(step: number, kind: PaymentMethodKind): PaymentMethodFieldName[] {
  if (step === 0) return [...DETAIL_FIELDS[kind]]
  if (step === 1) return [...LIMIT_FIELDS]
  return []
}

/**
 * A wallet's network must be one the server supports, and its address must be an address on that network:
 * funds sent across networks are lost. The address is checked only once the network is valid.
 */
function addCryptoIssues(values: PaymentMethodFormValues, context: z.RefinementCtx<PaymentMethodFormValues>) {
  if (!values.network) {
    context.addIssue({ code: 'custom', path: ['network'], message: REQUIRED_MESSAGE })
  } else if (!isCryptoNetwork(values.network)) {
    context.addIssue({ code: 'custom', path: ['network'], message: 'Choose a supported network' })
  }
  if (!values.walletAddress.trim()) {
    context.addIssue({ code: 'custom', path: ['walletAddress'], message: REQUIRED_MESSAGE })
    return
  }
  if (!isCryptoNetwork(values.network)) return
  const addressError = walletAddressError(values.network, values.walletAddress)
  if (addressError) context.addIssue({ code: 'custom', path: ['walletAddress'], message: addressError })
}

/** Required detail fields for the shown type (anything but a bank or a wallet is the UPI form, as before),
 *  a wallet's address checked against its network, the non-negative amounts and weight, the whole-number
 *  weight, and the legacy "max below min" rule. */
export function paymentMethodSchema(kind: PaymentMethodKind) {
  return formSchema.superRefine((values, context) => {
    if (kind === 'crypto') {
      addCryptoIssues(values, context)
    } else {
      for (const name of kind === 'bank' ? BANK_DETAIL_FIELDS : UPI_DETAIL_FIELDS) {
        if (!values[name]) context.addIssue({ code: 'custom', path: [name], message: REQUIRED_MESSAGE })
      }
    }
    for (const name of ['minAmount', 'maxAmount'] as const) {
      const value = values[name]
      if (value !== null && value < 0) {
        context.addIssue({ code: 'custom', path: [name], message: 'Value must be at least 0' })
      }
    }
    if (values.vipTierIds != null && !values.vipTierIds.length) context.addIssue({ code: 'custom', path: ['vipTierIds'], message: 'Choose at least one VIP tier' })
    const { minAmount, maxAmount, weight } = values
    if (maxAmount && minAmount && maxAmount >= 0 && maxAmount < minAmount) {
      context.addIssue({ code: 'custom', path: ['maxAmount'], message: MAX_BELOW_MIN_MESSAGE })
    }
    if (weight !== null && !Number.isInteger(weight)) {
      context.addIssue({ code: 'custom', path: ['weight'], message: 'Enter a whole number' })
    } else if (weight !== null && weight < 0) {
      context.addIssue({ code: 'custom', path: ['weight'], message: 'Value must be at least 0' })
    }
  })
}

const EMPTY_VALUES: PaymentMethodFormValues = {
  vipTierIds: null,
  accountName: '',
  accountNumber: '',
  ifsc: '',
  bankName: '',
  branch: '',
  notes: '',
  upiId: '',
  network: DEFAULT_CRYPTO_NETWORK,
  walletAddress: '',
  displayName: '',
  qrKey: null,
  minAmount: null,
  maxAmount: null,
  weight: 0,
  enabled: true,
}

/** A new method: weight 0 and active (a wallet on Tron), plus the tier's max amount when the link carries one. */
export function createInitialValues(maxAmountFromUrl: string | null): PaymentMethodFormValues {
  const maxAmount = maxAmountFromUrl ? Number.parseFloat(maxAmountFromUrl) : Number.NaN
  return { ...EMPTY_VALUES, maxAmount: Number.isFinite(maxAmount) ? maxAmount : null }
}

/** The type an edited id belongs to, read from the stored lists; null until known or when absent. */
export function resolveEditType(methods: StoredPaymentMethods | null | undefined, id: string | undefined): PaymentMethodKind | null {
  if (!methods || !id) return null
  if ((methods.banks ?? []).some((bank) => bank.id === id)) return 'bank'
  if ((methods.upis ?? []).some((upi) => upi.id === id)) return 'upi'
  if ((methods.cryptos ?? []).some((crypto) => crypto.id === id)) return 'crypto'
  return null
}

/** Edit follows the stored record; create follows the chosen type, else the link's `type`. */
export function resolveActiveType(
  isEdit: boolean,
  editType: PaymentMethodKind | null,
  selectedType: string | null,
  urlType: string | null,
): string | null {
  return isEdit ? editType : selectedType || urlType
}

export function findStoredBank(methods: StoredPaymentMethods | null | undefined, id: string | undefined): StoredBank | null {
  return (methods?.banks ?? []).find((bank) => bank.id === id) ?? null
}

export function findStoredUpi(methods: StoredPaymentMethods | null | undefined, id: string | undefined): StoredUpi | null {
  return (methods?.upis ?? []).find((upi) => upi.id === id) ?? null
}

export function findStoredCrypto(
  methods: StoredPaymentMethods | null | undefined,
  id: string | undefined,
): StoredCrypto | null {
  return (methods?.cryptos ?? []).find((crypto) => crypto.id === id) ?? null
}

/** The edited bank's form values; a missing `enabled` reads as active. */
export function bankFormValues(bank: StoredBank): PaymentMethodFormValues {
  return {
    ...EMPTY_VALUES,
    vipTierIds: bank.vipTierIds ?? null,
    accountName: bank.accountName ?? '',
    accountNumber: bank.accountNumber ?? '',
    ifsc: bank.ifsc ?? '',
    bankName: bank.bankName ?? '',
    branch: bank.branch ?? '',
    notes: bank.notes ?? '',
    minAmount: bank.minAmount ?? null,
    maxAmount: bank.maxAmount ?? null,
    weight: bank.weight ?? 0,
    enabled: bank.enabled !== undefined ? bank.enabled : true,
  }
}

/** The edited UPI's form values; its stored QR key is kept unless a new image replaces it. */
export function upiFormValues(upi: StoredUpi): PaymentMethodFormValues {
  return {
    ...EMPTY_VALUES,
    vipTierIds: upi.vipTierIds ?? null,
    upiId: upi.upiId ?? '',
    displayName: upi.displayName ?? '',
    qrKey: upi.qrKey ?? null,
    minAmount: upi.minAmount ?? null,
    maxAmount: upi.maxAmount ?? null,
    weight: upi.weight ?? 0,
    enabled: upi.enabled !== undefined ? upi.enabled : true,
  }
}

/** The edited wallet's form values; its stored QR key is kept unless a new image replaces it. */
export function cryptoFormValues(crypto: StoredCrypto): PaymentMethodFormValues {
  return {
    ...EMPTY_VALUES,
    vipTierIds: crypto.vipTierIds ?? null,
    network: crypto.network || DEFAULT_CRYPTO_NETWORK,
    walletAddress: crypto.walletAddress ?? '',
    displayName: crypto.displayName ?? '',
    qrKey: crypto.qrKey ?? null,
    minAmount: crypto.minAmount ?? null,
    maxAmount: crypto.maxAmount ?? null,
    weight: crypto.weight ?? 0,
    enabled: crypto.enabled !== undefined ? crypto.enabled : true,
  }
}

/** The edited record's form values, from the list its kind names; null while it is not (yet) there. */
export function storedFormValues(
  methods: StoredPaymentMethods | null | undefined,
  id: string | undefined,
  kind: PaymentMethodKind,
): PaymentMethodFormValues | null {
  if (kind === 'bank') {
    const bank = findStoredBank(methods, id)
    return bank ? bankFormValues(bank) : null
  }
  if (kind === 'crypto') {
    const crypto = findStoredCrypto(methods, id)
    return crypto ? cryptoFormValues(crypto) : null
  }
  const upi = findStoredUpi(methods, id)
  return upi ? upiFormValues(upi) : null
}

function withoutTypename(row: object): Record<string, unknown> {
  const { __typename: _t, ...cleaned } = row as Record<string, unknown>
  void _t
  return cleaned
}

function withoutTypenameAndQrUrl(row: object): Record<string, unknown> {
  const { __typename: _t, qrUrl: _q, ...cleaned } = row as Record<string, unknown>
  void _t
  void _q
  return cleaned
}

function limitsOf(methods: StoredPaymentMethods | null | undefined) {
  return methods?.limits ? { min: methods.limits.min, max: methods.limits.max } : { min: 100, max: 500000 }
}

export interface UpsertTarget {
  isBank: boolean
  isEdit: boolean
  /** The edited id; a new method gets `bank-<now>` or `upi-<now>`. */
  editId?: string
  now?: number
}

/** The bank entry the form saves: text trimmed, empty notes and amounts as null, weight 0 by default. */
export function bankEntry(values: PaymentMethodFormValues, id: string): Record<string, unknown> {
  return {
    id,
    accountName: values.accountName.trim(),
    accountNumber: values.accountNumber.trim(),
    ifsc: values.ifsc.trim(),
    bankName: values.bankName.trim(),
    branch: values.branch.trim(),
    notes: values.notes || null,
    minAmount: values.minAmount || null,
    maxAmount: values.maxAmount || null,
    weight: values.weight || 0,
    enabled: values.enabled,
    vipTierIds: values.vipTierIds ?? null,
  }
}

/** The UPI entry the form saves: the UPI ID as typed, an empty display name or QR key as null. */
export function upiEntry(values: PaymentMethodFormValues, id: string): Record<string, unknown> {
  return {
    id,
    upiId: values.upiId,
    displayName: values.displayName || null,
    qrKey: values.qrKey || null,
    minAmount: values.minAmount || null,
    maxAmount: values.maxAmount || null,
    weight: values.weight || 0,
    enabled: values.enabled,
    vipTierIds: values.vipTierIds ?? null,
  }
}

/** The wallet entry the form saves: the address and name trimmed, an empty name or QR key as null. */
export function cryptoEntry(values: PaymentMethodFormValues, id: string): Record<string, unknown> {
  return {
    id,
    network: values.network,
    walletAddress: values.walletAddress.trim(),
    displayName: values.displayName.trim() || null,
    qrKey: values.qrKey || null,
    minAmount: values.minAmount || null,
    maxAmount: values.maxAmount || null,
    weight: values.weight || 0,
    enabled: values.enabled,
    vipTierIds: values.vipTierIds ?? null,
  }
}

/**
 * The wallet list with this wallet added (create, as `crypto-<now>`) or replaced (edit), and nothing else:
 * the server keeps the bank accounts, UPI IDs, limits and the crypto rate and bonus that an upsert omits.
 * The other wallets go back as stored, without `__typename` and the output-only `qrUrl`.
 */
export function buildCryptoMethodsInput(
  methods: StoredPaymentMethods | null | undefined,
  values: PaymentMethodFormValues,
  target: Omit<UpsertTarget, 'isBank'>,
): CryptoMethodsUpsertInput {
  const now = target.now ?? Date.now()
  const cryptos = methods?.cryptos || []
  const entry = cryptoEntry(values, target.isEdit ? (target.editId as string) : `crypto-${now}`)
  const updated = target.isEdit
    ? cryptos.map((crypto) => (crypto.id === target.editId ? entry : crypto))
    : [...cryptos, entry]
  return { cryptos: updated.map(withoutTypenameAndQrUrl) }
}

/**
 * The whole method set with this entry added (create) or replaced (edit). The other list goes back
 * as stored, without `__typename` (and `qrUrl` for UPIs); limits fall back to the legacy defaults.
 * Wallets are not part of it: an omitted `cryptos` is kept by the server.
 */
export function buildPaymentMethodsInput(
  methods: StoredPaymentMethods | null | undefined,
  values: PaymentMethodFormValues,
  target: UpsertTarget,
): PaymentMethodsUpsertInput {
  const now = target.now ?? Date.now()
  const banks = methods?.banks || []
  const upis = methods?.upis || []
  if (target.isBank) {
    const entry = bankEntry(values, target.isEdit ? (target.editId as string) : `bank-${now}`)
    const updated = target.isEdit
      ? banks.map((bank) => (bank.id === target.editId ? entry : bank))
      : [...banks, entry]
    return {
      enabledMethods: methods?.enabledMethods || [],
      banks: updated.map(withoutTypename),
      upis: upis.map(withoutTypenameAndQrUrl),
      limits: limitsOf(methods),
    }
  }
  const entry = upiEntry(values, target.isEdit ? (target.editId as string) : `upi-${now}`)
  const updated = target.isEdit
    ? upis.map((upi) => (upi.id === target.editId ? entry : upi))
    : [...upis, entry]
  return {
    enabledMethods: methods?.enabledMethods || [],
    banks: banks.map(withoutTypename),
    upis: updated.map(withoutTypenameAndQrUrl),
    limits: limitsOf(methods),
  }
}

export interface ReviewRow {
  label: string
  value: string
}

function row(label: string, value: string | null | undefined): ReviewRow {
  return { label, value: value || '—' }
}

export function detailReviewRows(values: PaymentMethodFormValues, kind: PaymentMethodKind, qrAttached: boolean): ReviewRow[] {
  if (kind === 'bank') {
    return [
      row('Account Name', values.accountName),
      row('Account No.', values.accountNumber),
      row('IFSC', values.ifsc),
      row('Bank', values.bankName),
      row('Branch', values.branch),
      ...(values.notes ? [row('Notes', values.notes)] : []),
    ]
  }
  if (kind === 'crypto') {
    return [
      row('Coin', CRYPTO_COIN),
      row('Network', cryptoNetworkLabel(values.network)),
      row('Wallet Address', values.walletAddress.trim()),
      row('Display Name', values.displayName.trim()),
      row('QR Code', qrAttached ? 'Attached' : 'Not added'),
    ]
  }
  return [
    row('UPI ID', values.upiId),
    row('Display Name', values.displayName),
    row('QR Code', qrAttached ? 'Attached' : 'Not added'),
  ]
}

/** The whitelabel's one USDT rate, which every wallet uses; it is set on the Crypto Wallets tab. */
export function cryptoRateReviewRow(rate: number | null | undefined, formatAmount: (amount: number) => string): ReviewRow {
  return row(`${CRYPTO_COIN} Rate`, rate ? `1 ${CRYPTO_COIN} = ${formatAmount(rate)}` : 'Not set')
}

export const CRYPTO_NO_RATE_REVIEW_NOTICE =
  `No ${CRYPTO_COIN} rate is saved yet. Set it on the Crypto Wallets tab of Payment Methods — players will not see this wallet until then.`

/** Wallet limits are amounts in the deposit currency, like every other method's. */
export function cryptoLimitsNote(currencySymbol: string): string {
  return `Limits are in the deposit currency (${currencySymbol}), not in ${CRYPTO_COIN}.`
}

export function limitReviewRows(values: PaymentMethodFormValues, formatAmount: (amount: number) => string): ReviewRow[] {
  return [
    row('Min Amount', values.minAmount ? formatAmount(values.minAmount) : 'No minimum'),
    row('Max Amount', values.maxAmount ? formatAmount(values.maxAmount) : 'Unlimited'),
    row('Weight', String(values.weight ?? 0)),
    row('Status', values.enabled === false ? 'Inactive' : 'Active'),
  ]
}

const KIND_NAMES: Record<PaymentMethodKind, string> = {
  bank: 'Bank Account',
  upi: 'UPI Account',
  crypto: 'Crypto Wallet',
}

export function pageTitle(isEdit: boolean, kind: PaymentMethodKind): string {
  return isEdit ? `Edit ${KIND_NAMES[kind]}` : 'Add Payment Method'
}

export function pageSub(isEdit: boolean, kind: PaymentMethodKind): string {
  return isEdit
    ? `Update ${kind === 'upi' ? 'UPI account' : KIND_NAMES[kind].toLowerCase()} details`
    : 'Add a new bank account, UPI account or crypto wallet for deposits'
}

export function submitLabel(isEdit: boolean, kind: PaymentMethodKind): string {
  return `${isEdit ? 'Update' : 'Create'} ${KIND_NAMES[kind]}`
}

export function limitsIntro(isEdit: boolean): string {
  return isEdit
    ? 'Update account amount limits, VIP access and display priority.'
    : 'Set account amount limits, VIP access and display priority.'
}

export function saveFailureMessage(error: unknown, isEdit: boolean): string {
  return error instanceof Error && error.message
    ? error.message
    : `Failed to ${isEdit ? 'update' : 'create'} payment method`
}

export function qrStatusText(hasPreview: boolean, hasSavedUrl: boolean): string {
  return hasPreview ? 'Preview — ready to save' : hasSavedUrl ? 'Current QR code' : 'Saved'
}

export function isImageFile(file: Pick<File, 'type'>): boolean {
  return file.type.startsWith('image/')
}
