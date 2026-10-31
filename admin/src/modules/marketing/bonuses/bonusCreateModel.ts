import { z } from 'zod'
import { isDateTimeString, istDateTimeToIso } from '@/ui/components/istDate'

/* The pure model behind /bonuses/new (W1 Task 027). The legacy antd page (pre-image in
 * .backups/page-migration-2026-09-22/task-027) is the contract: every visibility rule, forced value,
 * validation message and mutation field here is transcribed from it. It holds no React, so the W6
 * edit page can reuse it without importing this page's visual form.
 *
 * Hidden values (W1-S4). antd kept an unmounted field's value in its store (preserve defaulted to
 * true), but both `Form.useWatch` and `onFinish` reported mounted fields only. So a value whose
 * control is hidden stays in form state and reappears if the control is shown again, yet it never
 * steers another field's visibility and is never submitted. getBonusCreateVisibility and
 * serializeBonusCreate encode exactly that. */

export const OFFERED_BONUS_TYPES = [
  'deposit',
  'daily_first_deposit',
  'signup',
  'direct_amount',
  'losing_bonus',
  'special',
] as const

// `referral_deposit` is deliberately accepted by the model because the legacy conditional and
// serializer support it, but it remains absent from OFFERED_BONUS_TYPES (W1-S4).
const ALL_BONUS_TYPES = [...OFFERED_BONUS_TYPES, 'referral_deposit'] as const
const DOMAINS = ['global', 'sports', 'casino', 'matka'] as const
const DISTRIBUTION_TYPES = ['instant_otp', 'instant_cash', 'roll_over'] as const
const AMOUNT_TYPES = ['fixed', 'percentage'] as const
const DEPOSIT_CONDITION_TYPES = ['greater_than', 'equal_to'] as const
const RELEASE_TYPES = ['bonus_amount_only', 'total_bonus_wallet'] as const

export type BonusType = (typeof ALL_BONUS_TYPES)[number]
export type OfferedBonusType = (typeof OFFERED_BONUS_TYPES)[number]
export type BonusDomain = (typeof DOMAINS)[number]
export type DistributionType = (typeof DISTRIBUTION_TYPES)[number]
export type AmountType = (typeof AMOUNT_TYPES)[number]
export type DepositConditionType = (typeof DEPOSIT_CONDITION_TYPES)[number]
export type ReleaseType = (typeof RELEASE_TYPES)[number]

/* The legacy form seeded `status: 'draft'` but rendered no status or budget control, so its
 * serializer's `values.status || 'draft'` and `values.budgetNumeric || 0` always produced these.
 * W1-S4 keeps them, the zero budget included, as constants rather than as form state no control
 * can reach. */
export const CREATE_BONUS_STATUS = 'draft'
export const CREATE_BONUS_BUDGET = 0

const bonusCreateBaseSchema = z.object({
  campaignName: z.string().min(1, 'Campaign name is required').min(3, 'Campaign name must be at least 3 characters'),
  currency: z.string().min(1, 'Currency is required'),
  bonusType: z.enum(['', ...ALL_BONUS_TYPES]),
  domain: z.enum(['', ...DOMAINS]),
  depositConditionType: z.enum(['', ...DEPOSIT_CONDITION_TYPES]),
  depositConditionAmount: z.number().nullable(),
  distributionType: z.enum(['', ...DISTRIBUTION_TYPES]),
  amountType: z.enum(['', ...AMOUNT_TYPES]),
  amount: z.number().nullable(),
  percentage: z.number().nullable(),
  numberOfPlayers: z.number().nullable(),
  usagePerPlayer: z.number().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  wagering: z.number().nullable(),
  expiryBonusDays: z.number().nullable(),
  depositRequired: z.boolean(),
  releaseType: z.enum(['', ...RELEASE_TYPES]),
})

export type BonusCreateValues = z.infer<typeof bonusCreateBaseSchema>

type NumberPath =
  | 'depositConditionAmount'
  | 'amount'
  | 'percentage'
  | 'numberOfPlayers'
  | 'usagePerPlayer'
  | 'wagering'
  | 'expiryBonusDays'

interface NumberRules {
  required?: boolean
  requiredMessage?: string
  min?: number
  max?: number
  integer?: boolean
  rangeMessage?: string
}

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

export interface BonusCreateVisibility {
  isLosingBonus: boolean
  hideUsagePerPlayer: boolean
  showDepositRequired: boolean
  showDepositConditions: boolean
  showWagering: boolean
  showReleaseType: boolean
  showAmountType: boolean
  showAmount: boolean
  showPercentage: boolean
}

/** Which controls the legacy page mounted for these values (its JSX conditions, verbatim). */
export function getBonusCreateVisibility(values: Pick<
  BonusCreateValues,
  'amountType' | 'bonusType' | 'distributionType'
>): BonusCreateVisibility {
  const { bonusType, distributionType } = values
  const isLosingBonus = bonusType === 'losing_bonus'
  const hideUsagePerPlayer = bonusType === 'signup' || bonusType === 'direct_amount'
  const showAmountType = bonusType !== 'signup'
    && bonusType !== 'direct_amount'
    && !isLosingBonus
    && bonusType !== 'special'
  // The legacy page read the amount type through Form.useWatch, which reports only mounted fields:
  // while the Amount Type radios were hidden it saw no amount type at all. A retained "percentage"
  // therefore never reveals Percentage for a Special Bonus.
  const watchedAmountType = showAmountType ? values.amountType : ''
  return {
    isLosingBonus,
    hideUsagePerPlayer,
    showDepositRequired: bonusType === 'signup',
    showDepositConditions: bonusType === 'deposit'
      || bonusType === 'referral_deposit'
      || bonusType === 'daily_first_deposit',
    showWagering: distributionType === 'roll_over'
      || isLosingBonus
      || bonusType === 'special',
    // Losing Bonus always reaches this through its forced Roll Over (bonusTypeChangePatch).
    showReleaseType: distributionType === 'roll_over',
    showAmountType,
    showAmount: watchedAmountType === 'fixed'
      || bonusType === 'signup'
      || bonusType === 'direct_amount'
      || bonusType === 'special',
    showPercentage: watchedAmountType === 'percentage' || isLosingBonus,
  }
}

export interface ChoiceOption {
  value: string
  label: string
  disabled?: boolean
}

/**
 * antd's Select showed a value that matched none of its options as the raw value. A native select
 * would show an empty face while the form still holds, and submits, that value — for example a base
 * currency that is not active, or Instant Cash retained when Special Bonus drops that option. The
 * retained value stays visible as its raw text and cannot be chosen again once changed.
 */
export function withRetainedOption(
  options: readonly ChoiceOption[],
  value: string,
): readonly ChoiceOption[] {
  if (value === '' || options.some((option) => option.value === value)) return options
  return [...options, { value, label: value, disabled: true }]
}

/* Rules apply only to mounted controls, as antd validated only registered fields. The required and
 * percentage messages are the legacy ones. antd's InputNumber clamped out-of-range input on blur,
 * which the kit NumberField also does; the range messages below cover the one path that skips the
 * blur (Enter while the field still holds the typed value). */
export const bonusCreateSchema = bonusCreateBaseSchema.superRefine((values, context) => {
  const visibility = getBonusCreateVisibility(values)

  if (values.bonusType === '') {
    context.addIssue({ code: 'custom', path: ['bonusType'], message: 'Bonus type is required' })
  }
  if (visibility.isLosingBonus && values.domain === '') {
    context.addIssue({
      code: 'custom',
      path: ['domain'],
      message: 'Domain is required for Losing Bonus',
    })
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

  // numberOfPlayers and usagePerPlayer are GraphQL Int, so a fraction was always refused (by the
  // server, as a variable error). Expiry days are Int too, but the legacy serializer floors them,
  // so a fraction there stays accepted and is floored at the boundary.
  validateNumber(values.numberOfPlayers, 'numberOfPlayers', context, { min: 1, integer: true })
  if (!visibility.hideUsagePerPlayer) {
    validateNumber(values.usagePerPlayer, 'usagePerPlayer', context, { min: 1, integer: true })
  }
  validateNumber(values.expiryBonusDays, 'expiryBonusDays', context, { min: 1 })

  if (values.startDate && !isDateTimeString(values.startDate)) {
    context.addIssue({ code: 'custom', path: ['startDate'], message: 'Enter a valid start date and time' })
  }
  if (values.endDate && !isDateTimeString(values.endDate)) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'Enter a valid end date and time' })
  }
  // Legacy rule: only an end strictly before the start fails (dayjs isBefore), so equal is allowed.
  // Same-format IST calendar strings order chronologically as plain strings.
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

/** The legacy initialValues (amount type Fixed, usage 1, deposit not required) plus the base currency. */
export function createBonusInitialValues(currency = ''): BonusCreateValues {
  return {
    campaignName: '',
    currency,
    bonusType: '',
    domain: '',
    depositConditionType: '',
    depositConditionAmount: null,
    distributionType: '',
    amountType: 'fixed',
    amount: null,
    percentage: null,
    numberOfPlayers: null,
    usagePerPlayer: 1,
    startDate: '',
    endDate: '',
    wagering: null,
    expiryBonusDays: null,
    depositRequired: false,
    releaseType: '',
  }
}

/**
 * The legacy bonus-type effect, applied in the same update as the type itself: Signup and Direct
 * force a fixed amount; Losing Bonus forces Roll Over, a percentage and, unless one is already held,
 * the Bonus Amount Only release. No other value is touched or cleared.
 */
export function bonusTypeChangePatch(
  values: Pick<BonusCreateValues, 'releaseType'>,
  bonusType: BonusType,
): Partial<BonusCreateValues> {
  if (bonusType === 'signup' || bonusType === 'direct_amount') {
    return { bonusType, amountType: 'fixed' }
  }
  if (bonusType === 'losing_bonus') {
    return {
      bonusType,
      distributionType: 'roll_over',
      amountType: 'percentage',
      releaseType: values.releaseType || 'bonus_amount_only',
    }
  }
  return { bonusType }
}

export interface BonusCampaignCreateInput {
  name: string
  domain: BonusDomain
  type: BonusType
  status: typeof CREATE_BONUS_STATUS
  currency: string
  budgetNumeric: number
  depositConditionType?: DepositConditionType
  depositConditionAmount?: number
  distributionType?: DistributionType
  amountType?: AmountType
  amount?: number
  percentage?: number
  numberOfPlayers?: number
  usagePerPlayer?: number
  startDate?: string
  endDate?: string
  wagering?: number
  expiryBonusDays?: number
  depositRequired?: boolean
  releaseType?: ReleaseType
}

/** A hidden control contributes nothing, exactly as an unmounted antd field was absent from onFinish. */
function mounted<T>(visible: boolean, value: T): T | undefined {
  return visible ? value : undefined
}

/* An empty control is omitted, as a never-filled antd field was. (A number cleared after typing
 * reached the old serializer as null; it is now omitted like an untouched one.) */
const optionalNumber = (value: number | null | undefined): number | undefined => value ?? undefined
const optionalChoice = <T extends string>(value: T | undefined): Exclude<T, ''> | undefined =>
  (value || undefined) as Exclude<T, ''> | undefined

/**
 * The legacy handleSubmit input, field for field and in the same key order. Two named changes
 * only: dates are IST calendar values converted at this boundary (W1-S3, istDateTimeToIso), and
 * hidden controls are read as absent (see the file comment) rather than from retained state.
 */
export function serializeBonusCreate(values: BonusCreateValues): BonusCampaignCreateInput {
  const visibility = getBonusCreateVisibility(values)
  const { isLosingBonus } = visibility
  const bonusType = values.bonusType as BonusType
  const distributionType = optionalChoice(values.distributionType)
  const amount = optionalNumber(mounted(visibility.showAmount, values.amount))

  return {
    name: values.campaignName,
    domain: isLosingBonus ? (values.domain as BonusDomain) : 'global',
    type: bonusType,
    status: CREATE_BONUS_STATUS,
    currency: values.currency,
    budgetNumeric: CREATE_BONUS_BUDGET,
    depositConditionType: optionalChoice(
      mounted(visibility.showDepositConditions, values.depositConditionType),
    ),
    depositConditionAmount: optionalNumber(
      mounted(visibility.showDepositConditions, values.depositConditionAmount),
    ),
    distributionType: isLosingBonus ? 'roll_over' : distributionType,
    amountType: bonusType === 'signup' || bonusType === 'direct_amount' || bonusType === 'special'
      ? 'fixed'
      : isLosingBonus
        ? 'percentage'
        : optionalChoice(mounted(visibility.showAmountType, values.amountType)),
    amount: bonusType === 'special' ? (amount ?? 0) : amount,
    percentage: optionalNumber(mounted(visibility.showPercentage, values.percentage)),
    numberOfPlayers: optionalNumber(values.numberOfPlayers),
    ...(visibility.hideUsagePerPlayer ? {} : { usagePerPlayer: values.usagePerPlayer || 1 }),
    startDate: values.startDate ? istDateTimeToIso(values.startDate) : undefined,
    endDate: values.endDate ? istDateTimeToIso(values.endDate) : undefined,
    wagering: optionalNumber(mounted(visibility.showWagering, values.wagering)),
    ...(values.expiryBonusDays !== null && values.expiryBonusDays >= 1
      ? { expiryBonusDays: Math.floor(values.expiryBonusDays) }
      : {}),
    ...(bonusType === 'signup' ? { depositRequired: values.depositRequired } : {}),
    ...(distributionType === 'roll_over' || isLosingBonus
      ? {
          releaseType: optionalChoice(mounted(visibility.showReleaseType, values.releaseType))
            || 'bonus_amount_only',
        }
      : {}),
  }
}
