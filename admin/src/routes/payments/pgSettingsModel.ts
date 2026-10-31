/**
 * Pure logic of /payments/pg-settings, moved out of the legacy PgSettingsPage.tsx: the form values the
 * stored settings fill, the rules, the exact `UpsertPgSettingsInput` (legacy key order, the secret sent only
 * when one is typed) and the secret field's help and placeholder.
 */
import { z } from 'zod'

/** `whitelabelPgSettings`, exactly the fields WHITELABEL_PG_SETTINGS selects. */
export interface PgSettings {
  id: string
  tenant: string
  provider: string
  enabled: boolean
  displayName: string
  secretSiteKeyMasked?: string | null
  hasSecretSiteKey: boolean
  webhookUrl: string
  minDeposit?: number | null
  maxDeposit?: number | null
  redirectSuccessUrl?: string | null
  redirectFailureUrl?: string | null
  updatedAt: string
}

/** The deposit limits' floor, the legacy InputNumber `min`. */
export const MIN_DEPOSIT_FLOOR = 10

const formSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string(),
  secretSiteKey: z.string(),
  minDeposit: z.number().nullable(),
  maxDeposit: z.number().nullable(),
  redirectSuccessUrl: z.string(),
  redirectFailureUrl: z.string(),
})

export type PgSettingsFormValues = z.infer<typeof formSchema>

/** Display Name is required, as entered; a deposit limit left below 10 (Enter skips the blur clamp) is named. */
export const pgSettingsSchema = formSchema.superRefine((values, context) => {
  if (!values.displayName) {
    context.addIssue({ code: 'custom', path: ['displayName'], message: 'Required' })
  }
  for (const name of ['minDeposit', 'maxDeposit'] as const) {
    const value = values[name]
    if (value !== null && value < MIN_DEPOSIT_FLOOR) {
      context.addIssue({ code: 'custom', path: [name], message: `Value must be at least ${MIN_DEPOSIT_FLOOR}` })
    }
  }
})

export const EMPTY_PG_VALUES: PgSettingsFormValues = {
  enabled: false,
  displayName: '',
  secretSiteKey: '',
  minDeposit: null,
  maxDeposit: null,
  redirectSuccessUrl: '',
  redirectFailureUrl: '',
}

/** The stored settings in the form; the secret is never shown back and starts empty. */
export function pgFormValues(settings: PgSettings): PgSettingsFormValues {
  return {
    enabled: settings.enabled,
    displayName: settings.displayName ?? '',
    secretSiteKey: '',
    minDeposit: settings.minDeposit ?? null,
    maxDeposit: settings.maxDeposit ?? null,
    redirectSuccessUrl: settings.redirectSuccessUrl ?? '',
    redirectFailureUrl: settings.redirectFailureUrl ?? '',
  }
}

/** The legacy input: empty URLs as null, and the secret only when one was typed (trimmed). */
export function buildPgSettingsInput(values: PgSettingsFormValues): Record<string, unknown> {
  const input: Record<string, unknown> = {
    enabled: values.enabled,
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
  return settings?.hasSecretSiteKey ? '•••• (unchanged)' : 'Paste secret_site_key'
}

/** A mutation's own message, else the legacy fallback. */
export function mutationErrorMessage(error: { message?: string } | null | undefined, fallback: string): string {
  return error?.message || fallback
}
