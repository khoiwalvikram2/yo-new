import { z } from 'zod'
import { withRetainedOption, type ChoiceOption } from '../bonuses/bonusCreateModel'

/* The pure model behind /referrals/rules (W6 Task 177). The legacy antd page (pre-image in
 * .backups/page-migration-2026-09-22/task-177) is the contract: the rule types and their colours, the
 * table's Config text, the form's values per rule type, every validation message and the exact
 * UpsertReferralRule input (fields and key order) are transcribed from it. No React here. */

export type RuleHue = 'blu' | 'grn' | 'ind' | 'vio' | 'red' | 'amb'

export interface RuleTypeMeta {
  value: string
  label: string
  /** The legacy antd colour, mapped onto the decorative hue ramp (cyan has no step; indigo stands in). */
  hue: RuleHue
}

export const RULE_TYPES: readonly RuleTypeMeta[] = [
  { value: 'SIGNUP_CPA', label: 'Signup CPA', hue: 'blu' },
  { value: 'FIRST_DEPOSIT_PCT', label: 'First Deposit %', hue: 'grn' },
  { value: 'RELOAD_DEPOSITS_PCT', label: 'Reload Deposits %', hue: 'ind' },
  { value: 'LOSS_SHARE', label: 'Loss Share', hue: 'red' },
  { value: 'TURNOVER_MILESTONE', label: 'Turnover Milestone', hue: 'amb' },
]

/** Rule types offered in the Create/Edit rule drawer (Loss Share and Turnover Milestone hidden). */
export const VISIBLE_RULE_TYPES = RULE_TYPES.filter(
  (type) => type.value !== 'LOSS_SHARE' && type.value !== 'TURNOVER_MILESTONE',
)

export const PAYOUT_TYPES = [
  { value: 'CASH', label: 'Cash Wallet', description: 'Directly withdrawable' },
  { value: 'BONUS', label: 'Bonus Wallet', description: 'Subject to wagering requirements' },
  { value: 'SPLIT', label: 'Split (Cash + Bonus)', description: '50% referral balance, 50% bonus (fixed)' },
] as const

type JsonMap = Record<string, unknown> | null | undefined

export interface ReferralRule {
  id: string | number
  ruleType: string
  tierRates?: JsonMap
  fixedAmounts?: JsonMap
  caps?: unknown
  thresholds?: JsonMap
  payoutType?: string | null
  splitRatio?: unknown
  escrow?: unknown
  reloadDepositsCount?: number | null
  reloadMinDeposit?: number | null
  isActive?: boolean | null
  createdAt?: string | null
  updatedAt?: string | null
}

export function ruleTypeLabel(type: string): string {
  return RULE_TYPES.find((rule) => rule.value === type)?.label ?? type.replace(/_/g, ' ')
}

/** The legacy tile colour: blue, green, cyan, red, orange for the five types, orange for anything else. */
export function ruleTypeHue(type: string): RuleHue {
  return RULE_TYPES.find((rule) => rule.value === type)?.hue ?? 'amb'
}

/** The legacy payout tag colour: CASH green, BONUS blue, anything else purple. */
export function payoutTypeHue(payoutType: string | null | undefined): RuleHue {
  if (payoutType === 'CASH') return 'grn'
  if (payoutType === 'BONUS') return 'blu'
  return 'vio'
}

/** REVSHARE rules exist server-side but the page has never listed them. */
export function displayedRules<T extends Pick<ReferralRule, 'ruleType'>>(rules: readonly T[]): T[] {
  return rules.filter((rule) => rule.ruleType !== 'REVSHARE')
}

export function activeRuleCount(rules: readonly Pick<ReferralRule, 'isActive'>[]): number {
  return rules.filter((rule) => rule.isActive).length
}

export function rulesCountLabel(active: number, total: number): string {
  return `${active} of ${total} ${total === 1 ? 'rule' : 'rules'} active`
}

/** A JSON-map entry read the way the legacy `rule.fixedAmounts?.[1]` read it (keys arrive as strings). */
function entry(map: JsonMap, key: number | string): unknown {
  if (!map || typeof map !== 'object') return undefined
  return (map as Record<string, unknown>)[String(key)]
}

type FormatAmount = (amount: number) => string

/** The table's "Config:" text, rule type by rule type, as the legacy formatRuleValue wrote it. */
export function formatRuleValue(rule: ReferralRule, formatAmount: FormatAmount): string {
  const fixed = entry(rule.fixedAmounts, 1)
  const tier = entry(rule.tierRates, 1)
  if (rule.ruleType === 'SIGNUP_CPA') {
    return formatAmount((fixed as number) || 0)
  }
  if (rule.ruleType === 'FIRST_DEPOSIT_PCT') {
    return `${fixed ?? tier ?? 0}%`
  }
  if (rule.ruleType === 'RELOAD_DEPOSITS_PCT') {
    const depositsLabel = (rule.reloadDepositsCount ?? 0) === 0 ? 'unlimited' : `${rule.reloadDepositsCount} deposits`
    const minDepositLabel = (rule.reloadMinDeposit ?? 0) > 0 ? `, min ${formatAmount(rule.reloadMinDeposit as number)}` : ''
    return `${fixed ?? tier ?? 0}% (${depositsLabel}${minDepositLabel})`
  }
  if (rule.ruleType === 'LOSS_SHARE') {
    const rates = Object.entries(rule.tierRates || {})
      .filter(([, value]) => (value as number) > 0)
      .map(([level, rate]) => `L${level}: ${rate}%`)
      .join(', ')
    return rates || 'Not configured'
  }
  if (rule.ruleType === 'TURNOVER_MILESTONE') {
    const pct = fixed ?? tier ?? 0
    return `${pct}% @ ${formatAmount((entry(rule.thresholds, 'turnoverTarget') as number) ?? 0)}`
  }
  return '—'
}

export interface ProgramTiers {
  /** Tiers are enabled when the program's maxDepth is above 1. */
  enabled: boolean
  /** Tier inputs shown for Loss Share: maxDepth (or 4) when enabled, otherwise the direct tier only. */
  count: number
}

export function programTiers(maxDepth: number | null | undefined): ProgramTiers {
  const enabled = (maxDepth || 1) > 1
  return { enabled, count: enabled ? maxDepth || 4 : 1 }
}

/* ---------- the rule form ---------- */

export interface RuleFormValues {
  ruleType: string
  payoutType: string
  isActive: boolean
  fixedAmount: number | null
  firstDepositPercent: number | null
  reloadDepositsPercent: number | null
  reloadDepositsCount: number | null
  reloadMinDeposit: number | null
  /** Index 0 is tier 1 (the direct referral). */
  tierRates: Array<number | null>
  turnoverPercent: number | null
  turnoverTarget: number | null
}

/**
 * A fresh Create Rule form: the legacy Form.Item initial values (Payout Type CASH, Status on) and nothing
 * else. The two reload fields that had `initialValue={0}` get it from ruleTypeChangePatch.
 */
export function createRuleInitialValues(): RuleFormValues {
  return {
    ruleType: '',
    payoutType: 'CASH',
    isActive: true,
    fixedAmount: null,
    firstDepositPercent: null,
    reloadDepositsPercent: null,
    reloadDepositsCount: 0,
    reloadMinDeposit: 0,
    tierRates: [],
    turnoverPercent: null,
    turnoverTarget: null,
  }
}

/**
 * The legacy Rule Type onChange: every rule-specific field is cleared, then each field the new type
 * mounts takes its initial value (0 for the reload count and minimum, 0 for each Loss Share tier).
 */
export function ruleTypeChangePatch(ruleType: string, tiers: ProgramTiers): Partial<RuleFormValues> {
  return {
    ruleType,
    fixedAmount: null,
    firstDepositPercent: null,
    reloadDepositsPercent: null,
    reloadDepositsCount: 0,
    reloadMinDeposit: 0,
    tierRates: ruleType === 'LOSS_SHARE' ? Array.from({ length: tiers.count }, () => 0) : [],
    turnoverPercent: null,
    turnoverTarget: null,
  }
}

/** A stored number for an InputNumber: null/undefined take the fallback, numeric strings become numbers. */
function asNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** The legacy handleEdit values for a stored rule (Status follows `isActive === true`). */
export function ruleToFormValues(rule: ReferralRule, tiers: ProgramTiers): RuleFormValues {
  const values: RuleFormValues = {
    ...createRuleInitialValues(),
    ruleType: rule.ruleType,
    payoutType: rule.payoutType ?? 'CASH',
    isActive: rule.isActive === true,
  }
  const fixed = entry(rule.fixedAmounts, 1)
  const tier = entry(rule.tierRates, 1)
  if (rule.ruleType === 'SIGNUP_CPA') {
    values.fixedAmount = asNumber(fixed, 0)
  } else if (rule.ruleType === 'FIRST_DEPOSIT_PCT') {
    values.firstDepositPercent = asNumber(fixed ?? tier, 0)
  } else if (rule.ruleType === 'RELOAD_DEPOSITS_PCT') {
    values.reloadDepositsPercent = asNumber(fixed ?? tier, 0)
    values.reloadDepositsCount = asNumber(rule.reloadDepositsCount, 0)
    values.reloadMinDeposit = asNumber(rule.reloadMinDeposit, 0)
  } else if (rule.ruleType === 'LOSS_SHARE') {
    values.tierRates = Array.from({ length: tiers.count }, (_, index) => asNumber(entry(rule.tierRates, index + 1), 0))
  } else if (rule.ruleType === 'TURNOVER_MILESTONE') {
    values.turnoverPercent = asNumber(fixed ?? tier, 0)
    values.turnoverTarget = asNumber(entry(rule.thresholds, 'turnoverTarget'), 0)
  }
  return values
}

/**
 * The Rule Type choices. Creating, a type that already has a rule is disabled and says so; editing, the
 * select is disabled and a type the drawer does not offer (Loss Share, Turnover Milestone) keeps its raw
 * value on show, as antd displayed an unknown value.
 */
export function ruleTypeOptions(
  rules: readonly Pick<ReferralRule, 'ruleType'>[],
  editing: boolean,
  value: string,
): readonly ChoiceOption[] {
  const options = VISIBLE_RULE_TYPES.map((type) => {
    const configured = !editing && rules.some((rule) => rule.ruleType === type.value)
    return {
      value: type.value,
      label: configured ? `${type.label} (already configured)` : type.label,
      disabled: configured,
    }
  })
  return withRetainedOption(options, value)
}

export function payoutTypeOptions(value: string): readonly ChoiceOption[] {
  return withRetainedOption(
    PAYOUT_TYPES.map((type) => ({ value: type.value, label: type.label })),
    value,
  )
}

export interface RuleDrawerCopy {
  title: string
  heading: string
  sub: string
  mode: 'Edit' | 'New'
  hint: string
  submitLabel: string
}

/** The drawer's title, header card and footer copy. */
export function ruleDrawerCopy(editing: boolean, ruleType: string): RuleDrawerCopy {
  if (editing) {
    return {
      title: 'Edit Rule',
      heading: `Editing: ${ruleTypeLabel(ruleType)}`,
      sub: 'Update rule configuration',
      mode: 'Edit',
      hint: 'Update rule configuration and settings',
      submitLabel: 'Save Changes',
    }
  }
  return {
    title: 'Create Rule',
    heading: ruleType ? `New: ${ruleTypeLabel(ruleType)}` : 'New Referral Rule',
    sub: ruleType ? `Configure ${ruleTypeLabel(ruleType)} rule` : 'Configure a new referral rule',
    mode: 'New',
    hint: 'Configure reward rule for your referral program',
    submitLabel: 'Create Rule',
  }
}

export function tierRatesLabel(tiers: ProgramTiers): string {
  return tiers.enabled ? `Tier Rates (%) - ${tiers.count} Tiers` : 'Percentage (%) - Direct Only'
}

export function tierRatesHelp(tiers: ProgramTiers): string {
  return tiers.enabled
    ? `Configure percentage for each tier (1-${tiers.count}). Tier 1 is direct referral.`
    : 'Commission percentage for direct referrals only.'
}

export function tierCaption(tier: number): string {
  return tier === 1 ? 'Direct referral' : `Level ${tier} referral`
}

/**
 * A decimal Arrow-key step adds binary artefacts (0.1 + 0.2); antd's stepping never produced them, so the
 * value is rounded at 12 significant digits, which no typed value reaches.
 */
export function cleanDecimal(value: number | null): number | null {
  return value === null ? null : Number(value.toPrecision(12))
}

/** The failed-submit summary (the kit form names the count; antd only outlined the fields). */
export function ruleFormSummary(errorCount: number): string {
  return `Fix ${errorCount} highlighted ${errorCount === 1 ? 'field' : 'fields'} and submit again.`
}

/* ---------- validation ---------- */

interface NumberRule {
  required?: string
  min?: number
  max?: number
  rangeMessage?: string
  integer?: boolean
}

function checkNumber(
  value: number | null,
  path: Array<string | number>,
  context: z.RefinementCtx,
  rule: NumberRule,
) {
  if (value === null) {
    if (rule.required) context.addIssue({ code: 'custom', path, message: rule.required })
    return
  }
  // antd ran the range rule first; the whole-number rule is new (the fields are GraphQL Int).
  if ((rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max)) {
    context.addIssue({ code: 'custom', path, message: rule.rangeMessage ?? 'Value is out of range' })
    return
  }
  if (rule.integer && !Number.isInteger(value)) {
    context.addIssue({ code: 'custom', path, message: 'Enter a whole number' })
  }
}

const PERCENT_RULE: NumberRule = {
  required: 'Percentage is required',
  min: 0,
  max: 100,
  rangeMessage: 'Must be between 0 and 100',
}

const ruleFormBaseSchema = z.object({
  ruleType: z.string(),
  payoutType: z.string(),
  isActive: z.boolean(),
  fixedAmount: z.number().nullable(),
  firstDepositPercent: z.number().nullable(),
  reloadDepositsPercent: z.number().nullable(),
  reloadDepositsCount: z.number().nullable(),
  reloadMinDeposit: z.number().nullable(),
  tierRates: z.array(z.number().nullable()),
  turnoverPercent: z.number().nullable(),
  turnoverTarget: z.number().nullable(),
})

/**
 * The legacy Form.Item rules, applied to the mounted (selected type's) fields only. Two additions, both
 * named in the record: the reload count and minimum deposit refuse fractions (GraphQL Int used to reject
 * them as an error toast), and a tier rate outside 0-100 says so (antd clamped it; the kit clamps on blur,
 * and Enter can submit before the blur).
 */
export function createRuleFormSchema(tiers: ProgramTiers) {
  return ruleFormBaseSchema.superRefine((values, context) => {
    if (values.ruleType === '') {
      context.addIssue({ code: 'custom', path: ['ruleType'], message: 'Rule type is required' })
      return
    }
    if (values.ruleType === 'SIGNUP_CPA') {
      checkNumber(values.fixedAmount, ['fixedAmount'], context, {
        required: 'Fixed amount is required',
        min: 0,
        rangeMessage: 'Amount must be positive',
      })
    } else if (values.ruleType === 'FIRST_DEPOSIT_PCT') {
      checkNumber(values.firstDepositPercent, ['firstDepositPercent'], context, PERCENT_RULE)
    } else if (values.ruleType === 'RELOAD_DEPOSITS_PCT') {
      checkNumber(values.reloadDepositsPercent, ['reloadDepositsPercent'], context, PERCENT_RULE)
      checkNumber(values.reloadDepositsCount, ['reloadDepositsCount'], context, {
        required: 'Number of deposits is required',
        min: 0,
        max: 30,
        rangeMessage: 'Must be between 0 and 30',
        integer: true,
      })
      checkNumber(values.reloadMinDeposit, ['reloadMinDeposit'], context, {
        min: 0,
        rangeMessage: 'Must be 0 or greater',
        integer: true,
      })
    } else if (values.ruleType === 'LOSS_SHARE') {
      for (let index = 0; index < tiers.count; index += 1) {
        checkNumber(values.tierRates[index] ?? null, ['tierRates', index], context, {
          required: tiers.enabled ? `Tier ${index + 1} percentage is required` : 'Percentage is required',
          min: 0,
          max: 100,
          rangeMessage: 'Must be between 0 and 100',
        })
      }
    } else if (values.ruleType === 'TURNOVER_MILESTONE') {
      checkNumber(values.turnoverPercent, ['turnoverPercent'], context, PERCENT_RULE)
      checkNumber(values.turnoverTarget, ['turnoverTarget'], context, {
        required: 'Turnover target is required',
        min: 0,
        rangeMessage: 'Target must be positive',
      })
    }
  })
}

/* ---------- the mutation input ---------- */

export interface ReferralRuleInput {
  ruleType: string
  payoutType: string
  splitRatio: { cash: number; bonus: number }
  escrow: { untilKyc: boolean; untilFraudClear: boolean }
  isActive: boolean
  ruleId?: string
  fixedAmounts?: Record<number, number>
  tierRates?: Record<number, number>
  thresholds?: { turnoverTarget: number }
  reloadDepositsCount?: number
  reloadMinDeposit?: number
}

/**
 * The legacy handleSubmit input, field for field and in the same key order. The form had no Split Ratio or
 * Escrow control, so `values.splitRatio || { cash: 100, bonus: 0 }` and the escrow default always applied;
 * they are constants here, as they were in effect. `ruleId` is sent only when editing.
 */
export function buildRuleInput(
  values: RuleFormValues,
  editingRuleId: string | number | null | undefined,
  tiers: ProgramTiers,
): ReferralRuleInput {
  const input: ReferralRuleInput = {
    ruleType: values.ruleType,
    payoutType: values.payoutType || 'CASH',
    splitRatio: { cash: 100, bonus: 0 },
    escrow: { untilKyc: false, untilFraudClear: false },
    isActive: values.isActive !== false,
  }

  // Only include ruleId when editing (not creating)
  if (editingRuleId) {
    input.ruleId = String(editingRuleId)
  }

  if (values.ruleType === 'SIGNUP_CPA') {
    input.fixedAmounts = { 1: values.fixedAmount || 0 }
  } else if (values.ruleType === 'FIRST_DEPOSIT_PCT') {
    input.fixedAmounts = { 1: values.firstDepositPercent || 0 }
  } else if (values.ruleType === 'RELOAD_DEPOSITS_PCT') {
    input.fixedAmounts = { 1: values.reloadDepositsPercent || 0 }
    const count = Number(values.reloadDepositsCount)
    input.reloadDepositsCount = Number.isFinite(count) && count >= 0 && count <= 30 ? count : 0
    const minDep = Number(values.reloadMinDeposit)
    input.reloadMinDeposit = Number.isFinite(minDep) && minDep >= 0 ? minDep : 0
  } else if (values.ruleType === 'LOSS_SHARE') {
    // Only LOSS_SHARE supports tierRates: every tier up to maxDepth, or the direct tier alone.
    const tierRates: Record<number, number> = {}
    for (let tier = 1; tier <= tiers.count; tier += 1) {
      tierRates[tier] = values.tierRates[tier - 1] || 0
    }
    input.tierRates = tierRates
    input.fixedAmounts = {}
  } else if (values.ruleType === 'TURNOVER_MILESTONE') {
    input.fixedAmounts = { 1: values.turnoverPercent || 0 }
    input.thresholds = { turnoverTarget: values.turnoverTarget || 0 }
  }

  return input
}
