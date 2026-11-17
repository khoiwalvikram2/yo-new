/**
 * Pure logic of /payments/pg-settings (WeLivePay v2): the form values the stored settings fill, the rules,
 * the exact `UpsertPgSettingsInput` (fixed key order, the merchant key sent only when one is typed), the
 * merchant key field's help and placeholder, and the gateway selects fed by the list WeLivePay reports for
 * the saved key (`welivepayAvailableGateways`) with their warnings.
 */
import { z } from 'zod'

/** `whitelabelPgSettings`, exactly the fields WHITELABEL_PG_SETTINGS selects. */
export interface PgSettings {
  id: string
  tenant: string
  provider: string
  enabled: boolean
  /** Upper-case create-path code, e.g. IRISPAY (the default), QPC, AKMULTISOLUTIONS. */
  payinGateway: string
  payoutEnabled: boolean
  /** AUTO (the provider assigned to the project) or a pinned payout gateway code. */
  payoutGateway: string
  minPayout?: number | null
  maxPayout?: number | null
  displayName: string
  secretSiteKeyMasked?: string | null
  hasSecretSiteKey: boolean
  /** The pay-in webhook (WeLivePay's siteUrl). */
  webhookUrl: string
  /** The payout webhook (WeLivePay's payoutWebhookUrl). */
  payoutWebhookUrl: string
  minDeposit?: number | null
  maxDeposit?: number | null
  redirectSuccessUrl?: string | null
  redirectFailureUrl?: string | null
  updatedAt: string
}

/** One gateway of `welivepayAvailableGateways`; `code` is what payinGateway / payoutGateway store. */
export interface GatewayOption {
  code: string
  key: string
  label: string
}

export interface AvailableGateways {
  payin: readonly GatewayOption[]
  payout: readonly GatewayOption[]
}

/** The deposit limits' floor, the legacy InputNumber `min` (WeLivePay's own minimum deposit). */
export const MIN_DEPOSIT_FLOOR = 10
/** The smallest payout limit the field takes: one paisa. */
export const MIN_PAYOUT_FLOOR = 0.01
export const DEFAULT_PAYIN_GATEWAY = 'IRISPAY'
export const AUTO_PAYOUT_GATEWAY = 'AUTO'
export const AUTO_PAYOUT_LABEL = 'Automatic (assigned provider)'
export const WELIVEPAY_DOCS_URL = 'https://welivepay.in/docs/'

const formSchema = z.object({
  enabled: z.boolean(),
  payinGateway: z.string(),
  payoutEnabled: z.boolean(),
  payoutGateway: z.string(),
  minPayout: z.number().nullable(),
  maxPayout: z.number().nullable(),
  displayName: z.string(),
  secretSiteKey: z.string(),
  minDeposit: z.number().nullable(),
  maxDeposit: z.number().nullable(),
  redirectSuccessUrl: z.string(),
  redirectFailureUrl: z.string(),
})

export type PgSettingsFormValues = z.infer<typeof formSchema>

/** WeLivePay takes INR rupees with at most two decimal places (shared welivepayClient `paymentAmount`). */
export function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) <= 0.000001
}

const AMOUNT_MESSAGE = 'Enter an amount above 0 with at most 2 decimals'
const DECIMALS_MESSAGE = 'Use at most 2 decimals'

/**
 * Display Name is required, as entered; a deposit limit left below 10 (Enter skips the blur clamp) is named,
 * and so is one with more than two decimals or a minimum not under the maximum, which the server refuses.
 * Payout limits are above 0 with at most two decimals, and the minimum does not exceed the maximum.
 */
export const pgSettingsSchema = formSchema.superRefine((values, context) => {
  if (!values.displayName) {
    context.addIssue({ code: 'custom', path: ['displayName'], message: 'Required' })
  }
  if (!values.payinGateway) {
    context.addIssue({ code: 'custom', path: ['payinGateway'], message: 'Select a pay-in gateway' })
  }
  if (!values.payoutGateway) {
    context.addIssue({ code: 'custom', path: ['payoutGateway'], message: 'Select a payout gateway' })
  }
  const depositsValid = { minDeposit: true, maxDeposit: true }
  for (const name of ['minDeposit', 'maxDeposit'] as const) {
    const value = values[name]
    if (value === null) continue
    if (value < MIN_DEPOSIT_FLOOR) {
      context.addIssue({ code: 'custom', path: [name], message: `Value must be at least ${MIN_DEPOSIT_FLOOR}` })
      depositsValid[name] = false
    } else if (!hasAtMostTwoDecimals(value)) {
      context.addIssue({ code: 'custom', path: [name], message: DECIMALS_MESSAGE })
      depositsValid[name] = false
    }
  }
  if (
    depositsValid.minDeposit && depositsValid.maxDeposit
    && values.minDeposit !== null && values.maxDeposit !== null && values.minDeposit >= values.maxDeposit
  ) {
    context.addIssue({ code: 'custom', path: ['minDeposit'], message: 'Min deposit must be less than max deposit' })
  }
  const payoutsValid = { minPayout: true, maxPayout: true }
  for (const name of ['minPayout', 'maxPayout'] as const) {
    const value = values[name]
    if (value !== null && (value <= 0 || !hasAtMostTwoDecimals(value))) {
      context.addIssue({ code: 'custom', path: [name], message: AMOUNT_MESSAGE })
      payoutsValid[name] = false
    }
  }
  if (
    payoutsValid.minPayout && payoutsValid.maxPayout
    && values.minPayout !== null && values.maxPayout !== null && values.minPayout > values.maxPayout
  ) {
    context.addIssue({ code: 'custom', path: ['minPayout'], message: 'Min payout must not exceed max payout' })
  }
})

export const EMPTY_PG_VALUES: PgSettingsFormValues = {
  enabled: false,
  payinGateway: DEFAULT_PAYIN_GATEWAY,
  payoutEnabled: false,
  payoutGateway: AUTO_PAYOUT_GATEWAY,
  minPayout: null,
  maxPayout: null,
  displayName: '',
  secretSiteKey: '',
  minDeposit: null,
  maxDeposit: null,
  redirectSuccessUrl: '',
  redirectFailureUrl: '',
}

/** The stored settings in the form; the merchant key is never shown back and starts empty. */
export function pgFormValues(settings: PgSettings): PgSettingsFormValues {
  return {
    enabled: settings.enabled,
    payinGateway: settings.payinGateway || DEFAULT_PAYIN_GATEWAY,
    payoutEnabled: settings.payoutEnabled ?? false,
    payoutGateway: settings.payoutGateway || AUTO_PAYOUT_GATEWAY,
    minPayout: settings.minPayout ?? null,
    maxPayout: settings.maxPayout ?? null,
    displayName: settings.displayName ?? '',
    secretSiteKey: '',
    minDeposit: settings.minDeposit ?? null,
    maxDeposit: settings.maxDeposit ?? null,
    redirectSuccessUrl: settings.redirectSuccessUrl ?? '',
    redirectFailureUrl: settings.redirectFailureUrl ?? '',
  }
}

/** The input in UpsertPgSettingsInput order: empty limits and URLs as null, the key only when one was typed
 *  (trimmed, last). */
export function buildPgSettingsInput(values: PgSettingsFormValues): Record<string, unknown> {
  const input: Record<string, unknown> = {
    enabled: values.enabled,
    payinGateway: values.payinGateway,
    payoutEnabled: values.payoutEnabled,
    payoutGateway: values.payoutGateway,
    minPayout: values.minPayout ?? null,
    maxPayout: values.maxPayout ?? null,
    displayName: values.displayName,
    minDeposit: values.minDeposit ?? null,
    maxDeposit: values.maxDeposit ?? null,
    redirectSuccessUrl: values.redirectSuccessUrl || null,
    redirectFailureUrl: values.redirectFailureUrl || null,
  }
  if (values.secretSiteKey && values.secretSiteKey.trim()) input.secretSiteKey = values.secretSiteKey.trim()
  return input
}

export function secretKeyHelp(settings: Pick<PgSettings, 'hasSecretSiteKey' | 'secretSiteKeyMasked'> | null | undefined): string {
  return settings?.hasSecretSiteKey
    ? `Current: ${settings.secretSiteKeyMasked}. Leave blank to keep unchanged.`
    : 'Not set yet.'
}

export function secretKeyPlaceholder(settings: Pick<PgSettings, 'hasSecretSiteKey'> | null | undefined): string {
  return settings?.hasSecretSiteKey ? '•••• (unchanged)' : 'Paste your WeLivePay project key'
}

/* ---- Gateway selects ------------------------------------------------------------------------- */

export interface GatewaySelectOption {
  value: string
  label: string
}

const AUTO_OPTION: GatewaySelectOption = { value: AUTO_PAYOUT_GATEWAY, label: AUTO_PAYOUT_LABEL }

function listed(list: readonly GatewayOption[] | undefined, code: string): boolean {
  return Boolean(list?.some((gateway) => gateway.code === code))
}

/**
 * The fixed options, then the live list. The saved code stays selectable even when WeLivePay no longer lists
 * it, so the select never shows a value it cannot hold; once the list is known, it is flagged as missing.
 */
export function gatewaySelectOptions(
  live: readonly GatewayOption[] | undefined,
  saved: string | null | undefined,
  fixed: readonly GatewaySelectOption[] = [],
): GatewaySelectOption[] {
  const options: GatewaySelectOption[] = [
    ...fixed,
    ...(live ?? []).map((gateway) => ({ value: gateway.code, label: gateway.label })),
  ]
  if (saved && !options.some((option) => option.value === saved)) {
    options.push({ value: saved, label: live ? `${saved} (not available for this project)` : saved })
  }
  return options
}

export function payinGatewayOptions(available: AvailableGateways | undefined, saved: string | null | undefined) {
  return gatewaySelectOptions(available?.payin, saved)
}

/** Automatic first: it uses whichever payout provider WeLivePay has assigned to the project. */
export function payoutGatewayOptions(available: AvailableGateways | undefined, saved: string | null | undefined) {
  return gatewaySelectOptions(available?.payout, saved, [AUTO_OPTION])
}

export const PAYIN_GATEWAY_HELP = 'Only gateways WeLivePay reports as assigned and active are listed.'
export const PAYOUT_GATEWAY_HELP = 'Automatic uses the active payout provider assigned to your project.'

/** The chosen pay-in gateway is not in the live list: WeLivePay would refuse every deposit through it. */
export function payinGatewayWarning(available: AvailableGateways | undefined, selected: string): string | null {
  if (!available || !selected || listed(available.payin, selected)) return null
  return 'This gateway is not assigned and active for this project, so WeLivePay will reject deposits through it.'
}

/** Payouts are on but WeLivePay lists none, or a pinned payout gateway is missing from the list. */
export function payoutGatewayWarning(
  available: AvailableGateways | undefined,
  selected: string,
  payoutEnabled: boolean,
): string | null {
  if (!available) return null
  if (payoutEnabled && available.payout.length === 0) {
    return 'WeLivePay lists no payout gateway for this project. It needs the payouts.create permission and an assigned, active payout provider.'
  }
  if (selected && selected !== AUTO_PAYOUT_GATEWAY && !listed(available.payout, selected)) {
    return 'This payout gateway is not assigned and active for this project, so WeLivePay will reject payouts through it.'
  }
  return null
}

export interface GatewayListStatus {
  tone: 'muted' | 'error'
  text: string
}

/** The line under the gateway selects: why there is no list yet, that it failed, or what it holds. */
export function gatewayListStatus(state: {
  hasKey: boolean
  available: AvailableGateways | undefined
  error?: { message?: string } | null
}): GatewayListStatus {
  if (!state.hasKey) {
    return { tone: 'muted', text: 'Save the merchant API key to load the gateways WeLivePay has assigned to this project.' }
  }
  if (state.error) {
    return { tone: 'error', text: `Could not load the assigned gateways: ${state.error.message || 'WeLivePay did not answer'}` }
  }
  if (!state.available) return { tone: 'muted', text: 'Loading the gateways WeLivePay has assigned to this project…' }
  const { payin, payout } = state.available
  return {
    tone: 'muted',
    text: `WeLivePay lists ${payin.length} pay-in and ${payout.length} payout gateway(s) as assigned and active for this project.`,
  }
}

/** Gateway names of the codes WeLivePay uses today (shared welivepayClient GATEWAY_NAMES). */
const KNOWN_GATEWAY_NAMES: Readonly<Record<string, string>> = {
  IRISPAY: 'Iris Pay',
  QPC: 'QuickPayCash',
  AKMULTISOLUTIONS: 'AK Multi Solutions',
  PAYRUPY: 'PayRupy',
  PAYFINROW: 'PayFinRow',
  VYAPARVAULT: 'VyaparVault',
  AUTO: 'Automatic',
}

/** A gateway by name: WeLivePay's own label when the live list has it, else the known name, else the code. */
export function gatewayName(code: string, live?: readonly GatewayOption[]): string {
  if (!code) return '—'
  return live?.find((gateway) => gateway.code === code)?.label ?? KNOWN_GATEWAY_NAMES[code] ?? code
}

/** A mutation's own message, else the legacy fallback. */
export function mutationErrorMessage(error: { message?: string } | null | undefined, fallback: string): string {
  return error?.message || fallback
}
