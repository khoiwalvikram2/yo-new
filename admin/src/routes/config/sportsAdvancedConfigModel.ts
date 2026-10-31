/**
 * /config/sports-advanced, the page logic without React: the 33 settings fields in the legacy form order,
 * their labels, placeholders, steps and rules, the values a loaded settings record seeds the form with, and the
 * two upsert variables. Legacy line numbers refer to the pre-image `SportsAdvancedConfigPage.tsx` in the
 * task-198 snapshot.
 */
import { z } from 'zod'

export type SettingsTab = 'sport' | 'league'

export const TAB_ITEMS: ReadonlyArray<{ value: SettingsTab; label: string }> = [
  { value: 'sport', label: 'Sport-Level Settings' },
  { value: 'league', label: 'League-Level Settings' },
]

/** Legacy :627: the tier is fixed. */
export const DEFAULT_TIER_ID = 'default'

export const BACK_TO_BASIC_CONFIG = '/config/app-configuration?tab=sports'

/* ---------- fields ---------- */

export type NumberFieldName =
  | 'exchangeCommission'
  | 'bookmakerCommission'
  | 'fancyCommission'
  | 'exchangeMinStake'
  | 'exchangeMaxStake'
  | 'bookmakerMinStake'
  | 'bookmakerMaxStake'
  | 'fancyMinStake'
  | 'fancyMaxStake'
  | 'exchangeExposureDaily'
  | 'exchangeExposureWeekly'
  | 'exchangeExposureCap'
  | 'bookmakerExposureDaily'
  | 'bookmakerExposureWeekly'
  | 'bookmakerExposureCap'
  | 'fancyExposureDaily'
  | 'fancyExposureWeekly'
  | 'fancyExposureCap'
  | 'exchangeDelay'
  | 'bookmakerDelay'
  | 'fancyDelay'
  | 'exchangeCooldown'
  | 'bookmakerCooldown'
  | 'fancyCooldown'
  | 'exchangeMinOdds'
  | 'exchangeMaxOdds'
  | 'riskThreshold'
  | 'volatilityThreshold'
  | 'alertRateLimit'

export type SwitchFieldName = 'cashoutActive' | 'alertOnBreach'
export type ChoiceFieldName = 'riskLevel' | 'alertChannel'
export type SettingsFieldName = NumberFieldName | SwitchFieldName | ChoiceFieldName

/** Every form field, in the order the legacy form rendered (and so submitted) them (:138-584). */
export const SETTINGS_FIELD_NAMES: readonly SettingsFieldName[] = [
  'exchangeCommission',
  'bookmakerCommission',
  'fancyCommission',
  'exchangeMinStake',
  'exchangeMaxStake',
  'bookmakerMinStake',
  'bookmakerMaxStake',
  'fancyMinStake',
  'fancyMaxStake',
  'exchangeExposureDaily',
  'exchangeExposureWeekly',
  'exchangeExposureCap',
  'bookmakerExposureDaily',
  'bookmakerExposureWeekly',
  'bookmakerExposureCap',
  'fancyExposureDaily',
  'fancyExposureWeekly',
  'fancyExposureCap',
  'exchangeDelay',
  'bookmakerDelay',
  'fancyDelay',
  'exchangeCooldown',
  'bookmakerCooldown',
  'fancyCooldown',
  'exchangeMinOdds',
  'exchangeMaxOdds',
  'riskLevel',
  'riskThreshold',
  'volatilityThreshold',
  'cashoutActive',
  'alertOnBreach',
  'alertChannel',
  'alertRateLimit',
]

export interface NumberFieldSpec {
  name: NumberFieldName
  label: string
  placeholder: string
  min: number
  max?: number
  step: number
  /** The legacy `addonAfter="%"`. */
  percent?: boolean
  /** The legacy `prefix={getCurrencySymbol()}`. */
  currency?: boolean
}

export interface FieldGroup {
  title: string
  fields: readonly NumberFieldSpec[]
}

const commission = (name: NumberFieldName, label: string, placeholder: string): NumberFieldSpec => ({
  name,
  label,
  placeholder,
  min: 0,
  max: 100,
  step: 0.1,
  percent: true,
})

const money = (name: NumberFieldName, label: string, placeholder: string, step: number): NumberFieldSpec => ({
  name,
  label,
  placeholder,
  min: 0,
  step,
  currency: true,
})

const seconds = (name: NumberFieldName, label: string): NumberFieldSpec => ({
  name,
  label,
  placeholder: '0',
  min: 0,
  step: 1,
})

/** Legacy :138-191. */
export const COMMISSION_FIELDS: readonly NumberFieldSpec[] = [
  commission('exchangeCommission', 'Exchange Commission', '5.0'),
  commission('bookmakerCommission', 'Bookmaker Commission', '3.0'),
  commission('fancyCommission', 'Fancy Commission', '2.0'),
]

const stakeGroup = (title: string, min: NumberFieldName, max: NumberFieldName): FieldGroup => ({
  title,
  fields: [money(min, 'Minimum Stake', '10', 1), money(max, 'Maximum Stake', '100000', 100)],
})

/** Legacy :195-306. */
export const STAKE_GROUPS: readonly FieldGroup[] = [
  stakeGroup('Exchange Markets', 'exchangeMinStake', 'exchangeMaxStake'),
  stakeGroup('Bookmaker Markets', 'bookmakerMinStake', 'bookmakerMaxStake'),
  stakeGroup('Fancy Markets', 'fancyMinStake', 'fancyMaxStake'),
]

const exposureGroup = (
  title: string,
  daily: NumberFieldName,
  weekly: NumberFieldName,
  cap: NumberFieldName,
): FieldGroup => ({
  title,
  fields: [
    money(daily, 'Daily Limit', '1000000', 1000),
    money(weekly, 'Weekly Limit', '5000000', 1000),
    money(cap, 'Total Cap', '10000000', 10000),
  ],
})

/** Legacy :310-466. */
export const EXPOSURE_GROUPS: readonly FieldGroup[] = [
  exposureGroup('Exchange Markets', 'exchangeExposureDaily', 'exchangeExposureWeekly', 'exchangeExposureCap'),
  exposureGroup('Bookmaker Markets', 'bookmakerExposureDaily', 'bookmakerExposureWeekly', 'bookmakerExposureCap'),
  exposureGroup('Fancy Markets', 'fancyExposureDaily', 'fancyExposureWeekly', 'fancyExposureCap'),
]

/** Legacy :470-505. */
export const DELAY_FIELDS: readonly NumberFieldSpec[] = [
  seconds('exchangeDelay', 'Exchange Delay'),
  seconds('bookmakerDelay', 'Bookmaker Delay'),
  seconds('fancyDelay', 'Fancy Delay'),
  seconds('exchangeCooldown', 'Exchange Cooldown'),
  seconds('bookmakerCooldown', 'Bookmaker Cooldown'),
  seconds('fancyCooldown', 'Fancy Cooldown'),
]

/** Legacy :509-524. */
export const ODDS_FIELDS: readonly NumberFieldSpec[] = [
  { name: 'exchangeMinOdds', label: 'Exchange Minimum Odds', placeholder: '1.01', min: 1, step: 0.01 },
  { name: 'exchangeMaxOdds', label: 'Exchange Maximum Odds', placeholder: '1000', min: 1, step: 1 },
]

/** Legacy :541-550, beside the Risk Level select. */
export const RISK_NUMBER_FIELDS: readonly NumberFieldSpec[] = [
  { name: 'riskThreshold', label: 'Risk Threshold', placeholder: '0.5', min: 0, step: 0.1 },
  { name: 'volatilityThreshold', label: 'Volatility Threshold', placeholder: '0.3', min: 0, step: 0.1 },
]

/** Legacy :579-583. */
export const ALERT_RATE_LIMIT_FIELD: NumberFieldSpec = {
  name: 'alertRateLimit',
  label: 'Alert Rate Limit (per hour)',
  placeholder: '10',
  min: 1,
  step: 1,
}

export interface ChoiceOption {
  value: string
  label: string
}

/** Legacy :534-538. */
export const RISK_LEVEL_OPTIONS: readonly ChoiceOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

/** Legacy :572-576. */
export const ALERT_CHANNEL_OPTIONS: readonly ChoiceOption[] = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'webhook', label: 'Webhook' },
]

/**
 * A stored value the options do not list is still shown, as antd's Select showed the raw value (a native
 * select would show nothing).
 */
export function withRetainedOption(options: readonly ChoiceOption[], value: string | null | undefined): ChoiceOption[] {
  if (!value || options.some((option) => option.value === value)) return [...options]
  return [...options, { value, label: value }]
}

/* ---------- form values and rules ---------- */

const numberValue = z.number().nullable().optional()
const percentValue = (label: string) =>
  z
    .number()
    .min(0, `${label} must be between 0-100`)
    .max(100, `${label} must be between 0-100`)
    .nullable()
    .optional()
const amountValue = (label: string) => z.number().min(0, `${label} must be minimum 0`).nullable().optional()
const switchValue = z.boolean().nullable().optional()
const choiceValue = z.string().nullable().optional()

/**
 * The legacy rules (antd's default English messages, with the item label): the three commissions are
 * numbers from 0 to 100 (:146, :162, :178), the six stakes and nine exposure limits numbers from 0 (:206 ff.).
 * The other fields had no rule. An empty field (null or never set) passes, as it did.
 */
export const settingsSchema = z.object({
  exchangeCommission: percentValue('Exchange Commission'),
  bookmakerCommission: percentValue('Bookmaker Commission'),
  fancyCommission: percentValue('Fancy Commission'),
  exchangeMinStake: amountValue('Minimum Stake'),
  exchangeMaxStake: amountValue('Maximum Stake'),
  bookmakerMinStake: amountValue('Minimum Stake'),
  bookmakerMaxStake: amountValue('Maximum Stake'),
  fancyMinStake: amountValue('Minimum Stake'),
  fancyMaxStake: amountValue('Maximum Stake'),
  exchangeExposureDaily: amountValue('Daily Limit'),
  exchangeExposureWeekly: amountValue('Weekly Limit'),
  exchangeExposureCap: amountValue('Total Cap'),
  bookmakerExposureDaily: amountValue('Daily Limit'),
  bookmakerExposureWeekly: amountValue('Weekly Limit'),
  bookmakerExposureCap: amountValue('Total Cap'),
  fancyExposureDaily: amountValue('Daily Limit'),
  fancyExposureWeekly: amountValue('Weekly Limit'),
  fancyExposureCap: amountValue('Total Cap'),
  exchangeDelay: numberValue,
  bookmakerDelay: numberValue,
  fancyDelay: numberValue,
  exchangeCooldown: numberValue,
  bookmakerCooldown: numberValue,
  fancyCooldown: numberValue,
  exchangeMinOdds: numberValue,
  exchangeMaxOdds: numberValue,
  riskLevel: choiceValue,
  riskThreshold: numberValue,
  volatilityThreshold: numberValue,
  cashoutActive: switchValue,
  alertOnBreach: switchValue,
  alertChannel: choiceValue,
  alertRateLimit: numberValue,
})

export type SettingsFormValues = z.infer<typeof settingsSchema>

/** A settings record as either query returns it; only the 33 form fields are read from it. */
export type SettingsRecord = Partial<Record<SettingsFieldName, unknown>> & Record<string, unknown>

/**
 * The values a loaded record seeds the form with: each form field's stored value (null included), as antd's
 * `setFieldsValue(record)` did (:658-673). No record (none saved yet) leaves every field empty, as
 * `resetFields()` did. Ids, the tier and `__typename` are not form fields and never reach the input.
 */
export function settingsFormValues(record: SettingsRecord | null | undefined): SettingsFormValues {
  const values: Record<string, unknown> = {}
  if (!record) return values as SettingsFormValues
  for (const name of SETTINGS_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(record, name)) values[name] = record[name]
  }
  return values as SettingsFormValues
}

/** Identifies the loaded values, so the form remounts with them when a refetch returns different ones. */
export function seedKey(values: SettingsFormValues): string {
  return JSON.stringify(SETTINGS_FIELD_NAMES.map((name) => values[name] ?? null))
}

/**
 * The form's values as the legacy `validateFields()` returned them, in the form's field order: a field never
 * set stays out (antd returned `undefined`, which the request dropped); a cleared field goes as null.
 */
export function settingsPayload(values: SettingsFormValues): Partial<Record<SettingsFieldName, unknown>> {
  const payload: Partial<Record<SettingsFieldName, unknown>> = {}
  for (const name of SETTINGS_FIELD_NAMES) {
    const value = values[name]
    if (value !== undefined) payload[name] = value
  }
  return payload
}

/** UpsertSportSettings (:682-691). */
export function sportSettingsVariables(sportId: string, tierId: string, values: SettingsFormValues) {
  return {
    input: {
      sportIds: [sportId],
      tierId,
      mode: 'overwrite',
      ...settingsPayload(values),
    },
  }
}

/** UpsertLeagueSettings (:711-719). */
export function leagueSettingsVariables(leagueId: string, tierId: string, values: SettingsFormValues) {
  return {
    leagueIds: [leagueId],
    input: {
      tierId,
      ...settingsPayload(values),
    },
  }
}

/* ---------- pickers and copy ---------- */

export interface NamedRow {
  id: string
  name?: string | null
}

export function pickerOptions(rows: readonly NamedRow[] | null | undefined): ChoiceOption[] {
  return (rows ?? []).map((row) => ({ value: String(row.id), label: String(row.name ?? '') }))
}

/** Legacy :778 and :863: the name of the row being configured (empty when it is not in the list). */
export function configuringLabel(rows: readonly NamedRow[] | null | undefined, id: string | null): string {
  const name = (rows ?? []).find((row) => row.id === id)?.name
  return `Configuring: ${name ?? ''}`
}

export interface MutationResult {
  success?: boolean | null
  message?: string | null
}

export type SaveOutcome = { ok: true; message: string } | { ok: false; message: string }

/** Legacy :693-701: the server's message, or the page's own wording. */
export function sportSaveOutcome(result: MutationResult | null | undefined): SaveOutcome {
  if (result?.success) return { ok: true, message: result.message || 'Sport settings saved successfully' }
  return { ok: false, message: result?.message || 'Failed to save sport settings' }
}

/** Legacy :721-729. */
export function leagueSaveOutcome(result: MutationResult | null | undefined): SaveOutcome {
  if (result?.success) return { ok: true, message: result.message || 'League settings saved successfully' }
  return { ok: false, message: result?.message || 'Failed to save league settings' }
}

export function thrownMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** BEYOND-LEGACY: what a failed save attempt asks for (legacy toasted "Failed to save settings" only). */
export function fixFieldsText(count: number): string {
  return `Fix ${count} highlighted ${count === 1 ? 'field' : 'fields'} and save again.`
}

