/**
 * Pure logic of /payments/methods/create and /payments/methods/edit/:type/:id, moved out of the legacy
 * PaymentMethodCreateEditPage.tsx: the method type, the per-step fields and their rules, the record's
 * form values, the exact upsert payload (legacy key order and cleaning) and the review rows and copy.
 */
import { z } from 'zod'

export type PaymentMethodKind = 'bank' | 'upi'

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

export interface StoredPaymentMethods {
  enabledMethods?: string[] | null
  banks?: StoredBank[] | null
  upis?: StoredUpi[] | null
  limits?: { min: number; max: number } | null
}

/** The `UpsertWhitelabelPaymentMethodsInput` the form sends, in the legacy key order. */
export interface PaymentMethodsUpsertInput {
  enabledMethods: string[]
  banks: Record<string, unknown>[]
  upis: Record<string, unknown>[]
  limits: { min: number; max: number }
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

export function stepsFor(isBank: boolean): StepCopy[] {
  return [
    {
      title: isBank ? 'Bank Details' : 'UPI Details',
      description: isBank ? 'Account holder & routing' : 'UPI handle & QR',
      short: isBank ? 'Bank Details' : 'UPI Details',
    },
    { title: 'Limits & Priority', description: 'Tiers, weight & status', short: 'Limits' },
    { title: 'Review & Save', description: 'Confirm before publishing', short: 'Review' },
  ]
}

/** The fields a step's Next validates, as the legacy validateFields lists did. */
export function stepFields(step: number, isBank: boolean): PaymentMethodFieldName[] {
  if (step === 0) return isBank ? [...BANK_DETAIL_FIELDS] : [...UPI_DETAIL_FIELDS]
  if (step === 1) return [...LIMIT_FIELDS]
  return []
}

/** Required detail fields for the shown type (anything but a bank is the UPI form, as before), the
 *  non-negative amounts and weight, the whole-number weight, and the legacy "max below min" rule. */
export function paymentMethodSchema(isBank: boolean) {
  return formSchema.superRefine((values, context) => {
    const required = isBank ? BANK_DETAIL_FIELDS : UPI_DETAIL_FIELDS
    for (const name of required) {
      if (!values[name]) context.addIssue({ code: 'custom', path: [name], message: REQUIRED_MESSAGE })
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
  displayName: '',
  qrKey: null,
  minAmount: null,
  maxAmount: null,
  weight: 0,
  enabled: true,
}

/** A new method: weight 0 and active, plus the tier's max amount when the link carries one. */
export function createInitialValues(maxAmountFromUrl: string | null): PaymentMethodFormValues {
  const maxAmount = maxAmountFromUrl ? Number.parseFloat(maxAmountFromUrl) : Number.NaN
  return { ...EMPTY_VALUES, maxAmount: Number.isFinite(maxAmount) ? maxAmount : null }
}

/** The type an edited id belongs to, read from the stored lists; null until known or when absent. */
export function resolveEditType(methods: StoredPaymentMethods | null | undefined, id: string | undefined): PaymentMethodKind | null {
  if (!methods || !id) return null
  if ((methods.banks ?? []).some((bank) => bank.id === id)) return 'bank'
  if ((methods.upis ?? []).some((upi) => upi.id === id)) return 'upi'
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

/**
 * The whole method set with this entry added (create) or replaced (edit). The other list goes back
 * as stored, without `__typename` (and `qrUrl` for UPIs); limits fall back to the legacy defaults.
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

export function detailReviewRows(values: PaymentMethodFormValues, isBank: boolean, qrAttached: boolean): ReviewRow[] {
  if (isBank) {
    return [
      row('Account Name', values.accountName),
      row('Account No.', values.accountNumber),
      row('IFSC', values.ifsc),
      row('Bank', values.bankName),
      row('Branch', values.branch),
      ...(values.notes ? [row('Notes', values.notes)] : []),
    ]
  }
  return [
    row('UPI ID', values.upiId),
    row('Display Name', values.displayName),
    row('QR Code', qrAttached ? 'Attached' : 'Not added'),
  ]
}

export function limitReviewRows(values: PaymentMethodFormValues, formatAmount: (amount: number) => string): ReviewRow[] {
  return [
    row('Min Amount', values.minAmount ? formatAmount(values.minAmount) : 'No minimum'),
    row('Max Amount', values.maxAmount ? formatAmount(values.maxAmount) : 'Unlimited'),
    row('Weight', String(values.weight ?? 0)),
    row('Status', values.enabled === false ? 'Inactive' : 'Active'),
  ]
}

export function pageTitle(isEdit: boolean, isBank: boolean): string {
  return isEdit ? `Edit ${isBank ? 'Bank Account' : 'UPI Account'}` : 'Add Payment Method'
}

export function pageSub(isEdit: boolean, isBank: boolean): string {
  return isEdit
    ? `Update ${isBank ? 'bank account' : 'UPI account'} details`
    : 'Add a new bank account or UPI account for deposits'
}

export function submitLabel(isEdit: boolean, isBank: boolean): string {
  return `${isEdit ? 'Update' : 'Create'} ${isBank ? 'Bank Account' : 'UPI Account'}`
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
