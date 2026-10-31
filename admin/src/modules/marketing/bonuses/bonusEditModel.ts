import { z } from 'zod'
import { TZDate } from '@date-fns/tz'
import { ADMIN_TZ, isDateTimeString, istDateTimeToIso } from '@/ui/components/istDate'
import {
  bonusTypeChangePatch,
  getBonusCreateVisibility,
  withRetainedOption,
  type BonusCreateValues,
  type BonusCreateVisibility,
  type BonusType,
  type ChoiceOption,
} from './bonusCreateModel'

/* The pure model behind /bonuses/:id/edit (W6 Task 171). The legacy antd page (pre-image in
 * .backups/page-migration-2026-09-22/task-171) is the contract. Where its fields match the Create
 * Bonus form, this reuses that page's model (bonusCreateModel.ts, W1 Task 027) by import: the
 * visibility rules, the bonus-type patch and the retained-option helper. The edit form differs in
 * ways the create model cannot express, so these parts are its own:
 *
 * - it loads any BonusType the API returns (legacy types such as `deposit_match` included) and any
 *   DepositConditionType, so its schema takes strings where the create schema takes enums;
 * - it edits Status and Budget, which the create form fixes as constants;
 * - its Losing Bonus branch of the type effect never ran (`formInitialized` was already true when the
 *   type was first watched), so choosing Losing Bonus forces nothing and the release type is shown for
 *   that type directly;
 * - its update input sends a number the admin cleared as null and an untouched date as the stored
 *   instant, as the legacy serializer did, because an update leaves out what it does not change.
 *
 * Hidden values follow antd exactly as on the create form (W1-S4): a hidden control keeps its value
 * in form state but never steers another control and is never submitted. */

export interface BonusCampaignRecord {
  id: string
  name: string | null
  domain: string | null
  type: string
  status: string
  currency: string | null
  budgetNumeric: number | null
  depositConditionType: string | null
  depositConditionAmount: number | null
  distributionType: string | null
  amountType: string | null
  depositRequired: boolean | null
  releaseType: string | null
  amount: number | null
  percentage: number | null
  numberOfPlayers: number | null
  usagePerPlayer: number | null
  startDate: string | null
  endDate: string | null
  wagering: number | null
  expiryBonusDays: number | null
}

const bonusEditBaseSchema = z.object({
  campaignName: z.string().min(1, 'Campaign name is required').min(3, 'Campaign name must be at least 3 characters'),
  currency: z.string().min(1, 'Currency is required'),
  bonusType: z.string().min(1, 'Bonus type is required'),
  status: z.string().min(1, 'Status is required'),
  domain: z.string(),
  depositRequired: z.boolean(),
  depositConditionType: z.string(),
  depositConditionAmount: z.number().nullable(),
  distributionType: z.string(),
  wagering: z.number().nullable(),
  releaseType: z.string(),
  amountType: z.string(),
  amount: z.number().nullable(),
  percentage: z.number().nullable(),
  numberOfPlayers: z.number().nullable(),
  usagePerPlayer: z.number().nullable(),
  expiryBonusDays: z.number().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  budgetNumeric: z.number().nullable(),
})

export type BonusEditValues = z.infer<typeof bonusEditBaseSchema>

/* The legacy option lists, in their legacy order. Edit offered Referral Deposit, which Create does not. */
export const EDIT_BONUS_TYPE_OPTIONS: readonly ChoiceOption[] = [
  { label: 'Deposit', value: 'deposit' },
  { label: 'First Day First Time Deposit', value: 'daily_first_deposit' },
  { label: 'Signup', value: 'signup' },
  { label: 'Direct Bonus', value: 'direct_amount' },
  { label: 'Referral Deposit', value: 'referral_deposit' },
  { label: 'Losing Bonus', value: 'losing_bonus' },
  { label: 'Special Bonus', value: 'special' },
]

export const EDIT_STATUS_OPTIONS: readonly ChoiceOption[] = [
  { label: 'Draft', value: 'draft' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Ended', value: 'ended' },
]

export const EDIT_DOMAIN_OPTIONS: readonly ChoiceOption[] = [
  { label: 'All', value: 'global' },
  { label: 'Sports', value: 'sports' },
  { label: 'Casino', value: 'casino' },
  { label: 'Matka', value: 'matka' },
]

export const EDIT_DEPOSIT_CONDITION_OPTIONS: readonly ChoiceOption[] = [
  { label: 'Greater Than', value: 'greater_than' },
  { label: 'Equal To', value: 'equal_to' },
]

export const EDIT_RELEASE_TYPE_OPTIONS: readonly ChoiceOption[] = [
  { label: 'Bonus Amount Only', value: 'bonus_amount_only' },
  { label: 'Total Amount in Bonus Wallet', value: 'total_bonus_wallet' },
]

export const LOSING_DISTRIBUTION_OPTIONS: readonly ChoiceOption[] = [{ label: 'Roll Over', value: 'roll_over' }]

/**
 * The legacy Distribution Type list: Roll Over disabled for Signup and Referral Deposit, Instant Cash
 * dropped for Special. (The Create page keeps the same rule in its page file, which this model may not
 * import, so it is restated here.)
 */
export function editDistributionOptions(bonusType: string): readonly ChoiceOption[] {
  return [
    { label: 'Instant OTP', value: 'instant_otp' },
    { label: 'Instant Cash', value: 'instant_cash' },
    {
      label: 'Roll Over',
      value: 'roll_over',
      disabled: bonusType === 'signup' || bonusType === 'referral_deposit',
    },
  ].filter((option) => !(bonusType === 'special' && option.value === 'instant_cash'))
}

/** Any option list plus the held value when it is not one of them (antd showed it raw). */
export function editChoices(options: readonly ChoiceOption[], value: string): readonly ChoiceOption[] {
  return withRetainedOption(options, value)
}

/**
 * The legacy JSX conditions. They are the create form's, read through the create model, except that
 * the release type also shows for Losing Bonus itself: on this page nothing forced Roll Over first.
 * The create helper compares strings only, so a legacy BonusType simply matches none of its families.
 */
export function getBonusEditVisibility(
  values: Pick<BonusEditValues, 'amountType' | 'bonusType' | 'distributionType'>,
): BonusCreateVisibility {
  const visibility = getBonusCreateVisibility(
    values as Pick<BonusCreateValues, 'amountType' | 'bonusType' | 'distributionType'>,
  )
  return { ...visibility, showReleaseType: visibility.showReleaseType || visibility.isLosingBonus }
}

/**
 * The legacy bonus-type effect as it actually ran on this page: Signup and Direct force a fixed
 * amount (the create model's patch); Losing Bonus forces nothing, because its branch required a form
 * that had not been initialised yet.
 */
export function bonusEditTypeChangePatch(bonusType: string): Partial<BonusEditValues> {
  if (bonusType === 'losing_bonus') return { bonusType }
  const patch = bonusTypeChangePatch({ releaseType: '' }, bonusType as BonusType)
  return patch.amountType ? { bonusType, amountType: patch.amountType } : { bonusType }
}

type NumberPath =
  | 'depositConditionAmount'
  | 'amount'
  | 'percentage'
  | 'numberOfPlayers'
  | 'usagePerPlayer'
  | 'wagering'
  | 'expiryBonusDays'
  | 'budgetNumeric'

interface NumberRules {
  required?: boolean
  requiredMessage?: string
  min?: number
  max?: number
  integer?: boolean
  rangeMessage?: string
}

/* The create model's number rule (not exported there), restated for this schema. */
function validateNumber(
  value: number | null,
  path: NumberPath,
  context: z.RefinementCtx,
  rules: NumberRules,
) {
  if (value === null) {
    if (rules.required) {
      context.addIssue({
        code: 'custom',
        path: [path],
        message: rules.requiredMessage ?? 'A value is required',
      })
    }
    return
  }

  if (rules.integer && !Number.isInteger(value)) {
    context.addIssue({ code: 'custom', path: [path], message: 'Enter a whole number' })
    return
  }
  if (rules.min !== undefined && value < rules.min) {
    context.addIssue({
      code: 'custom',
      path: [path],
      message: rules.rangeMessage ?? `Value must be at least ${rules.min}`,
    })
    return
  }
  if (rules.max !== undefined && value > rules.max) {
    context.addIssue({
      code: 'custom',
      path: [path],
      message: rules.rangeMessage ?? `Value must be at most ${rules.max}`,
    })
  }
}

/* Rules apply only to mounted controls, as antd validated only registered fields. Every message is the
   legacy one (the same words the create form uses); the range messages cover the Enter-without-blur path
   past NumberField's clamp, as on the create form. */
export const bonusEditSchema = bonusEditBaseSchema.superRefine((values, context) => {
  const visibility = getBonusEditVisibility(values)

  if (visibility.isLosingBonus && values.domain === '') {
    context.addIssue({ code: 'custom', path: ['domain'], message: 'Domain is required for Losing Bonus' })
  }

  if (visibility.showDepositConditions) {
    if (values.depositConditionType === '') {
      context.addIssue({
        code: 'custom',
        path: ['depositConditionType'],
        message: 'Deposit condition type is required',
      })
    }
    validateNumber(values.depositConditionAmount, 'depositConditionAmount', context, {
      required: true,
      requiredMessage: 'Deposit condition amount is required',
      min: 0,
      rangeMessage: 'Deposit condition amount must be zero or greater',
    })
  }

  if (values.bonusType === 'special' && values.distributionType === '') {
    context.addIssue({
      code: 'custom',
      path: ['distributionType'],
      message: 'Distribution type is required for Special Bonus',
    })
  }
  if (visibility.showWagering) {
    validateNumber(values.wagering, 'wagering', context, {
      required: true,
      requiredMessage: visibility.isLosingBonus
        ? 'Wagering requirement is required for Losing Bonus'
        : 'Wagering requirement is required',
      min: 0,
      rangeMessage: 'Wagering requirement must be zero or greater',
    })
  }
  if (visibility.showReleaseType && values.releaseType === '') {
    context.addIssue({ code: 'custom', path: ['releaseType'], message: 'Release type is required' })
  }

  if (visibility.showAmountType && values.amountType === '') {
    context.addIssue({ code: 'custom', path: ['amountType'], message: 'Amount type is required' })
  }
  if (visibility.showAmount) {
    validateNumber(values.amount, 'amount', context, {
      required: values.bonusType !== 'special',
      requiredMessage: 'Amount is required',
      min: 0,
      rangeMessage: 'Amount must be zero or greater',
    })
  }
  if (visibility.showPercentage) {
    validateNumber(values.percentage, 'percentage', context, {
      required: true,
      requiredMessage: visibility.isLosingBonus
        ? 'Percentage is required for Losing Bonus'
        : 'Percentage is required',
      min: 0,
      max: 100,
      rangeMessage: 'Percentage must be between 0 and 100',
    })
  }

  // GraphQL Int fields refuse a fraction; expiry days keep the legacy floor (as on the create form).
  validateNumber(values.numberOfPlayers, 'numberOfPlayers', context, { min: 1, integer: true })
  if (!visibility.hideUsagePerPlayer) {
    validateNumber(values.usagePerPlayer, 'usagePerPlayer', context, { min: 1, integer: true })
  }
  validateNumber(values.expiryBonusDays, 'expiryBonusDays', context, { min: 1 })
  validateNumber(values.budgetNumeric, 'budgetNumeric', context, {
    min: 0,
    rangeMessage: 'Budget must be zero or greater',
  })

  if (values.startDate && !isDateTimeString(values.startDate)) {
    context.addIssue({ code: 'custom', path: ['startDate'], message: 'Enter a valid start date and time' })
  }
  if (values.endDate && !isDateTimeString(values.endDate)) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'Enter a valid end date and time' })
  }
  // Legacy rule: only an end strictly before the start fails, so equal is allowed.
  if (
    values.startDate
    && values.endDate
    && isDateTimeString(values.startDate)
    && isDateTimeString(values.endDate)
    && values.endDate < values.startDate
  ) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be after start date' })
  }
})

/** The IST calendar minute (`yyyy-MM-ddTHH:mm`) of a stored instant; '' for none or an unusable one. */
export function istDateTimeOf(instant: string | null | undefined): string {
  if (!instant) return ''
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return ''
  const ist = new TZDate(date, ADMIN_TZ)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}T${pad(ist.getHours())}:${pad(ist.getMinutes())}`
}

/** What the form loads from the campaign: the legacy setFieldsValue mapping, field for field. */
export function bonusEditInitialValues(record: BonusCampaignRecord): BonusEditValues {
  const forcedFixed = record.type === 'special' || record.type === 'signup' || record.type === 'direct_amount'
  return {
    campaignName: record.name ?? '',
    currency: record.currency ?? '',
    bonusType: record.type,
    status: record.status,
    domain: record.domain ?? 'global',
    depositRequired: record.depositRequired ?? false,
    depositConditionType: record.depositConditionType ?? '',
    depositConditionAmount: record.depositConditionAmount ?? null,
    distributionType: record.distributionType ?? 'roll_over',
    wagering: record.wagering ?? null,
    releaseType: record.releaseType ?? 'bonus_amount_only',
    // Special loaded as Fixed; Signup and Direct were then forced to Fixed by the type effect.
    amountType: forcedFixed ? 'fixed' : (record.amountType ?? 'percentage'),
    amount: record.amount ?? null,
    percentage: record.percentage ?? null,
    numberOfPlayers: record.numberOfPlayers ?? null,
    usagePerPlayer: record.usagePerPlayer ?? null,
    expiryBonusDays: record.expiryBonusDays ?? null,
    startDate: istDateTimeOf(record.startDate),
    endDate: istDateTimeOf(record.endDate),
    budgetNumeric: record.budgetNumeric ?? null,
  }
}

/** Everything the update input compares against: the route id, the loaded values and stored instants. */
export interface BonusEditBaseline {
  id: string
  values: BonusEditValues
  startDate: string | null
  endDate: string | null
}

export function createBonusEditBaseline(id: string, record: BonusCampaignRecord): BonusEditBaseline {
  return {
    id,
    values: bonusEditInitialValues(record),
    startDate: record.startDate,
    endDate: record.endDate,
  }
}

export interface BonusCampaignUpdateInput {
  id: string
  name: string
  domain: string
  type: string
  status: string
  currency: string
  budgetNumeric: number | null | undefined
  depositConditionType: string | undefined
  depositConditionAmount: number | null | undefined
  distributionType: string | undefined
  amountType: string | undefined
  amount: number | null | undefined
  percentage: number | null | undefined
  numberOfPlayers: number | null | undefined
  usagePerPlayer?: number | null | undefined
  startDate: string | undefined
  endDate: string | undefined
  wagering: number | null | undefined
  expiryBonusDays: number | null
  depositRequired?: boolean
  releaseType?: string
}

/** A hidden control contributes nothing, exactly as an unmounted antd field was absent from onFinish. */
function mounted<T>(visible: boolean, value: T): T | undefined {
  return visible ? value : undefined
}

/* antd loaded an empty number as undefined (left out of the update) and a cleared one became null (sent
   as null). So a value the campaign never had stays out, and one the admin cleared is sent as null. */
function editedNumber(value: number | null, loaded: number | null): number | null | undefined {
  if (value !== null) return value
  return loaded === null ? undefined : null
}

/* The legacy serializer sent `dayjs(value).toISOString()`: an untouched date went back as the stored
   instant (seconds and all). A changed one is the IST calendar minute (W1-S3, as on the create form). */
function editedDate(value: string, loaded: string, stored: string | null): string | undefined {
  if (!value) return undefined
  if (value === loaded && stored) {
    const instant = new Date(stored)
    if (!Number.isNaN(instant.getTime())) return instant.toISOString()
  }
  return istDateTimeToIso(value)
}

/** The legacy handleSubmit input, field for field and in the same key order. */
export function serializeBonusEdit(values: BonusEditValues, baseline: BonusEditBaseline): BonusCampaignUpdateInput {
  const visibility = getBonusEditVisibility(values)
  const { isLosingBonus } = visibility
  const loaded = baseline.values
  const bonusType = values.bonusType
  const amount = mounted(visibility.showAmount, editedNumber(values.amount, loaded.amount))

  return {
    id: baseline.id,
    name: values.campaignName,
    domain: isLosingBonus ? values.domain : 'global',
    type: bonusType,
    status: values.status,
    currency: values.currency,
    budgetNumeric: editedNumber(values.budgetNumeric, loaded.budgetNumeric),
    depositConditionType: mounted(visibility.showDepositConditions, values.depositConditionType || undefined),
    depositConditionAmount: mounted(
      visibility.showDepositConditions,
      editedNumber(values.depositConditionAmount, loaded.depositConditionAmount),
    ),
    distributionType: isLosingBonus ? 'roll_over' : (values.distributionType || undefined),
    amountType: bonusType === 'signup' || bonusType === 'direct_amount' || bonusType === 'special'
      ? 'fixed'
      : isLosingBonus
        ? 'percentage'
        : mounted(visibility.showAmountType, values.amountType || undefined),
    amount: bonusType === 'special' ? (amount ?? 0) : amount,
    percentage: mounted(visibility.showPercentage, editedNumber(values.percentage, loaded.percentage)),
    numberOfPlayers: editedNumber(values.numberOfPlayers, loaded.numberOfPlayers),
    ...(visibility.hideUsagePerPlayer
      ? {}
      : { usagePerPlayer: editedNumber(values.usagePerPlayer, loaded.usagePerPlayer) }),
    startDate: editedDate(values.startDate, loaded.startDate, baseline.startDate),
    endDate: editedDate(values.endDate, loaded.endDate, baseline.endDate),
    wagering: mounted(visibility.showWagering, editedNumber(values.wagering, loaded.wagering)),
    expiryBonusDays: values.expiryBonusDays !== null && values.expiryBonusDays >= 1
      ? Math.floor(values.expiryBonusDays)
      : null,
    ...(bonusType === 'signup' ? { depositRequired: values.depositRequired } : {}),
    ...(values.distributionType === 'roll_over' || isLosingBonus
      ? { releaseType: values.releaseType || 'bonus_amount_only' }
      : {}),
  }
}
