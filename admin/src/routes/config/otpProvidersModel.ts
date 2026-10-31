/* OTP Providers (/config/otp-providers): the page's logic, free of React, so it can be tested on its own.
 *
 * The provider field tables, the masked-value lookup, the string cleaner, the create and edit defaults, the
 * provider-change clearing and the upsert payload are the legacy page's, moved here verbatim except where a
 * comment names a change. No secret value is ever logged, stored or defaulted here: a credential field starts
 * empty, and only what the admin types is sent. */
import { z } from 'zod'
import type { TableExportColumn } from '@/shared/utils/tableExport'
import { OTP_PROVIDER_LABELS, type OtpProviderCode } from '@/shared/constants/otp'

export type OtpProviderRow = {
  id: number
  provider: OtpProviderCode
  region?: string | null
  senderId?: string | null
  templateId?: string | null
  baseUrl?: string | null
  active: boolean
  priority: number
  accountSidMasked?: string | null
  authTokenMasked?: string | null
  accessKeyMasked?: string | null
  secretKeyMasked?: string | null
  apiKeyMasked?: string | null
  apiSecretMasked?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type DrawerMode = 'create' | 'edit'

export type MetaFieldName = 'senderId' | 'templateId' | 'region' | 'baseUrl'
export type SecretFieldName = 'accountSid' | 'authToken' | 'accessKey' | 'secretKey' | 'apiKey' | 'apiSecret'

export type MetaField = {
  name: MetaFieldName
  label: string
  placeholder?: string
  description?: string
}

export type CredentialField = {
  name: SecretFieldName
  label: string
  type?: 'password' | 'text'
  description?: string
}

export const PROVIDER_META_FIELDS: Record<OtpProviderCode, MetaField[]> = {
  TWILIO: [{ name: 'senderId', label: 'Sender ID / From Number', placeholder: '+1XXXXXXXXXX' }],
  AWS_SNS: [
    { name: 'senderId', label: 'Sender ID', placeholder: 'OTPMSG' },
    { name: 'region', label: 'Region', placeholder: 'ap-south-1', description: 'AWS_SNS_REGION' },
  ],
  MSG91: [
    { name: 'senderId', label: 'Sender ID', description: 'MSG91_SENDER_ID' },
    { name: 'templateId', label: 'Template ID', description: 'MSG91_TEMPLATE_ID' },
  ],
  TWO_FACTOR: [
    { name: 'senderId', label: 'Sender ID', description: 'DLT / HEADER' },
    { name: 'templateId', label: 'Template ID', description: 'FACTOR_TEMPLATE_ID' },
  ],
}

export const PROVIDER_SECRET_FIELDS: Record<OtpProviderCode, CredentialField[]> = {
  TWILIO: [
    { name: 'accountSid', label: 'Account SID', type: 'password', description: 'TWILIO_ACCOUNT_SID' },
    { name: 'authToken', label: 'Auth Token', type: 'password', description: 'TWILIO_AUTH_TOKEN' },
  ],
  AWS_SNS: [
    { name: 'accessKey', label: 'Access Key ID', type: 'password', description: 'AWS_SNS_ACCESS_KEY' },
    { name: 'secretKey', label: 'Secret Access Key', type: 'password', description: 'AWS_SNS_SECRET_KEY' },
  ],
  MSG91: [{ name: 'apiKey', label: 'API Key', type: 'password', description: 'MSG91_API_KEY' }],
  TWO_FACTOR: [
    { name: 'apiKey', label: '2Factor API Key', type: 'password', description: 'FACTOR_API_KEY' },
    { name: 'apiSecret', label: '2Factor Number', type: 'text', description: 'FACTOR_NUMBER' },
  ],
}

export const META_FIELD_NAMES: MetaFieldName[] = ['senderId', 'templateId', 'region', 'baseUrl']
export const SECRET_FIELD_NAMES: SecretFieldName[] = [
  'accountSid',
  'authToken',
  'accessKey',
  'secretKey',
  'apiKey',
  'apiSecret',
]

const PROVIDER_CODES = Object.keys(OTP_PROVIDER_LABELS) as OtpProviderCode[]

export function isProviderCode(value: string): value is OtpProviderCode {
  return (PROVIDER_CODES as string[]).includes(value)
}

/** The provider's delivery fields; an unknown code has none (legacy read `undefined.length` and threw). */
export function metaFieldsFor(provider: string): MetaField[] {
  return isProviderCode(provider) ? PROVIDER_META_FIELDS[provider] : []
}

export function secretFieldsFor(provider: string): CredentialField[] {
  return isProviderCode(provider) ? PROVIDER_SECRET_FIELDS[provider] : []
}

export function getMaskedValue(record: OtpProviderRow | null, field: SecretFieldName): string | null {
  if (!record) return null
  const maskedKey = `${field}Masked` as keyof OtpProviderRow
  const value = record[maskedKey]
  return typeof value === 'string' && value.length ? value : null
}

export const cleanString = (value?: string): string | null | undefined => {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

// ---------- the drawer form ----------

const formSchema = z.object({
  provider: z.string(),
  priority: z.number().nullable(),
  active: z.boolean(),
  senderId: z.string().optional(),
  templateId: z.string().optional(),
  region: z.string().optional(),
  baseUrl: z.string().optional(),
  accountSid: z.string().optional(),
  authToken: z.string().optional(),
  accessKey: z.string().optional(),
  secretKey: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
})

/** A text field the admin has not touched is `undefined` (legacy: no value in the antd form), so it is left out of
 *  the payload exactly as before; a touched one holds the string typed. */
export type OtpFormValues = z.infer<typeof formSchema>

/**
 * The legacy rules: the provider is required; on create every delivery field and every credential of the chosen
 * provider is required (`Enter <label>`), as antd's `required` judged it (an empty value fails, spaces pass).
 * New (a value Enter can submit past NumberField's blur clamp, and GraphQL `Int` refuses a fraction): Priority
 * is a whole number and at least 0.
 */
export function otpProviderSchema(mode: DrawerMode) {
  return formSchema.superRefine((values, context) => {
    if (!isProviderCode(values.provider)) {
      context.addIssue({ code: 'custom', path: ['provider'], message: 'Select a provider' })
    }
    if (values.priority !== null) {
      if (!Number.isInteger(values.priority)) {
        context.addIssue({ code: 'custom', path: ['priority'], message: 'Enter a whole number' })
      } else if (values.priority < 0) {
        context.addIssue({ code: 'custom', path: ['priority'], message: 'Value must be at least 0' })
      }
    }
    if (mode !== 'create') return
    for (const field of [...metaFieldsFor(values.provider), ...secretFieldsFor(values.provider)]) {
      if (!values[field.name]) {
        context.addIssue({ code: 'custom', path: [field.name], message: `Enter ${field.label}` })
      }
    }
  })
}

const EMPTY_TEXT_FIELDS = {
  senderId: undefined,
  templateId: undefined,
  region: undefined,
  baseUrl: undefined,
  accountSid: undefined,
  authToken: undefined,
  accessKey: undefined,
  secretKey: undefined,
  apiKey: undefined,
  apiSecret: undefined,
} satisfies Partial<OtpFormValues>

/** Add Provider: Twilio, the next priority after the highest, and active only when no provider is active. */
export function createFormValues(providers: readonly OtpProviderRow[]): OtpFormValues {
  return {
    ...EMPTY_TEXT_FIELDS,
    provider: 'TWILIO',
    priority: Math.max(...providers.map((p) => p.priority || 0), 0) + 1,
    active: !providers.some((provider) => provider.active),
  }
}

/** Edit: the stored delivery fields, priority and status. Credentials always start empty. */
export function editFormValues(record: OtpProviderRow): OtpFormValues {
  return {
    ...EMPTY_TEXT_FIELDS,
    provider: record.provider,
    senderId: record.senderId ?? undefined,
    templateId: record.templateId ?? undefined,
    region: record.region ?? undefined,
    baseUrl: record.baseUrl ?? undefined,
    priority: record.priority ?? 0,
    active: record.active,
  }
}

/** A provider change clears every delivery field and credential the new provider does not use (legacy effect). */
export function withProvider(values: OtpFormValues, provider: string): OtpFormValues {
  const allowedMeta = new Set<string>(metaFieldsFor(provider).map((field) => field.name))
  const allowedSecrets = new Set<string>(secretFieldsFor(provider).map((field) => field.name))
  const next: OtpFormValues = { ...values, provider }
  for (const name of META_FIELD_NAMES) if (!allowedMeta.has(name)) next[name] = undefined
  for (const name of SECRET_FIELD_NAMES) if (!allowedSecrets.has(name)) next[name] = undefined
  return next
}

/**
 * The legacy upsert input, in its key order: provider, active, priority (when set), the provider's delivery
 * fields (trimmed, `null` when emptied, left out when never touched), then its credentials.
 *
 * Named change: a credential is sent only when it holds something besides spaces. Legacy sent any value the field
 * had ever held, so a field typed into and then emptied sent `''`, which the backend stores as `null` — deleting
 * the stored credential while the field said "Leave blank to keep existing value". Untouched fields were already
 * left out; a value is still sent exactly as typed.
 */
export function buildOtpProviderInput(values: OtpFormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    provider: values.provider,
    active: values.active ?? false,
  }

  if (values.priority !== undefined && values.priority !== null) {
    payload.priority = Number(values.priority)
  }

  for (const field of metaFieldsFor(values.provider)) {
    const cleaned = cleanString(values[field.name])
    if (cleaned !== undefined) payload[field.name] = cleaned
  }

  for (const field of secretFieldsFor(values.provider)) {
    const value = values[field.name]
    if (value !== undefined && value.trim() !== '') payload[field.name] = value
  }

  return payload
}

export function toggleInput(record: Pick<OtpProviderRow, 'provider'>, nextActive: boolean) {
  return { input: { provider: record.provider, active: nextActive } }
}

// ---------- copy ----------

export const TOGGLE_FAILED = 'Failed to update provider'
export const SAVE_SUCCEEDED = 'Provider saved'
export const SAVE_FAILED = 'Failed to save provider'

export function toggleSucceededMessage(message: string | null | undefined, nextActive: boolean): string {
  return message || (nextActive ? 'Provider activated' : 'Provider deactivated')
}

export function messageOr(message: string | null | undefined, fallback: string): string {
  return message || fallback
}

/** A thrown error's own message, else the legacy fallback. */
export function thrownMessage(error: unknown, fallback: string): string {
  const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined
  return typeof message === 'string' && message ? message : fallback
}

export function providerLabel(provider: string): string {
  return isProviderCode(provider) ? OTP_PROVIDER_LABELS[provider] : provider
}

export function providerCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'provider' : 'providers'}`
}

export function drawerTitle(mode: DrawerMode, provider: string): string {
  if (mode === 'edit') return `Edit OTP Provider: ${providerLabel(provider)}`
  return provider ? `Add OTP Provider: ${providerLabel(provider)}` : 'Add OTP Provider'
}

export function drawerSub(mode: DrawerMode, provider: string): string {
  if (mode === 'edit') return 'Update provider configuration'
  return provider ? `Configure ${providerLabel(provider)} provider` : 'Configure a new OTP provider'
}

export function drawerHint(mode: DrawerMode): string {
  return mode === 'create'
    ? 'Configure provider credentials and settings'
    : 'Update credentials to rotate keys; leave blank to keep existing values'
}

export function submitLabel(mode: DrawerMode): string {
  return mode === 'create' ? 'Add Provider' : 'Save Changes'
}

export function metaPlaceholder(field: MetaField): string {
  return field.placeholder || `Enter ${field.label}`
}

/** A stored password-type credential shows the mask's dots; everything else asks for the value. */
export function credentialPlaceholder(field: CredentialField, masked: string | null): string {
  return masked && field.type !== 'text' ? '••••••••' : `Enter ${field.label}`
}

export type DetailRow = { label: string; value: string }

/** The Provider Details lines: only the ones with a value. */
export function detailRows(row: OtpProviderRow): DetailRow[] {
  return [
    { label: 'Sender ID', value: row.senderId },
    { label: 'Template ID', value: row.templateId },
    { label: 'Region', value: row.region },
  ].filter((line): line is DetailRow => Boolean(line.value))
}

export type ConfigChip = { key: 'sender' | 'template' | 'region'; label: string; value: string }

/** The Configuration column's chips; none means "No configuration". */
export function configChips(row: OtpProviderRow): ConfigChip[] {
  const chips: ConfigChip[] = []
  if (row.senderId) chips.push({ key: 'sender', label: 'Sender', value: row.senderId })
  if (row.templateId) chips.push({ key: 'template', label: 'Template', value: row.templateId })
  if (row.region) chips.push({ key: 'region', label: 'Region', value: row.region })
  return chips
}

/** Filled stars: the priority, as the legacy `star <= (priority || 0)` drew it (five at most). */
export function filledStars(priority: number | null | undefined): number {
  return Math.min(5, Math.max(0, priority || 0))
}

export function priorityLabel(priority: number | null | undefined): string {
  return `Priority: ${priority ?? 0}`
}

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

/** One client page. A page past the end (the list shrank) shows the last page rather than nothing. */
export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const pages = Math.max(1, Math.ceil(rows.length / Math.max(1, pageSize)))
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pages)
  const start = (current - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

export function otpExportColumns(): TableExportColumn<OtpProviderRow>[] {
  return [
    { header: 'Provider', key: 'provider', width: 14, getter: (p) => OTP_PROVIDER_LABELS[p.provider] ?? p.provider },
    { header: 'Region', key: 'region', width: 14, getter: (p) => p.region ?? '' },
    { header: 'Sender ID', key: 'senderId', width: 18, getter: (p) => p.senderId ?? '' },
    { header: 'Template ID', key: 'templateId', width: 16, getter: (p) => p.templateId ?? '' },
    { header: 'Priority', key: 'priority', width: 8, getter: (p) => p.priority ?? 0 },
    { header: 'Active', key: 'active', width: 8, getter: (p) => (p.active ? 'Yes' : 'No') },
  ]
}

export function exportTitle(count: number): string {
  return `OTP Providers — ${count} provider(s)`
}

