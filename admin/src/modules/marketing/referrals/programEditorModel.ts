/* Pure logic of /referrals/program (W6 Task 176): the reward types the settings offer, the form's
   values and their legacy validation, the upsert input exactly as the legacy page built it, the reward
   checkbox semantics antd's Checkbox.Group had, and the toasts. React-free. */
import { z } from 'zod'

/** The legacy rule types, verbatim. */
export const RULE_TYPES = [
  { value: 'SIGNUP_CPA', label: 'Signup CPA', description: 'Fixed bonus on verified signup (direct only)' },
  { value: 'FIRST_DEPOSIT_PCT', label: 'First Deposit %', description: 'Percentage of first deposit (direct only)' },
  { value: 'RELOAD_DEPOSITS_PCT', label: 'Reload Deposits %', description: 'Percentage of last N deposits (1-30, direct only)' },
  { value: 'LOSS_SHARE', label: 'Loss Share', description: 'Percentage of net losses (tiered, max 4 levels)' },
  { value: 'TURNOVER_MILESTONE', label: 'Turnover Milestone', description: 'Rewards at stake thresholds (direct only)' },
] as const

/** Reward types shown in Program Settings (Loss Share and Turnover Milestone hidden from UI). */
export const VISIBLE_REWARD_TYPES = RULE_TYPES.filter(
  (type) => type.value !== 'LOSS_SHARE' && type.value !== 'TURNOVER_MILESTONE',
)

export const VISIBLE_REWARD_VALUES: readonly string[] = VISIBLE_REWARD_TYPES.map((type) => type.value)

/** Revenue share is never shown and never sent. */
export const HIDDEN_PROGRAM_MODE = 'REVSHARE'

/** `referralProgramByTenant` as this page selects it. */
export interface ReferralProgramRecord {
  id?: string
  name?: string | null
  enabledModes?: readonly string[] | null
  maxDepth?: number | null
  flags?: unknown
  minReferralBalanceForCashTransfer?: number | null
}

export interface ProgramFormValues {
  name: string
  enabledModes: string[]
  maxDepth: number | null
  minReferralBalanceForCashTransfer: number | null
}

/** The legacy form's initial values: no name, no modes, four tiers, a zero minimum. */
export const PROGRAM_FORM_DEFAULTS: ProgramFormValues = {
  name: '',
  enabledModes: [],
  maxDepth: 4,
  minReferralBalanceForCashTransfer: 0,
}

export function withoutRevenueShare(modes: readonly string[] | null | undefined): string[] {
  return (modes ?? []).filter((mode) => mode !== HIDDEN_PROGRAM_MODE)
}

/**
 * The stored program as the form's values, as the legacy effect set them: revenue share left out, a
 * missing or zero depth read as 4, a missing minimum as 0. Modes the page does not offer (Loss Share,
 * Turnover Milestone) stay in the values and are sent back unless a reward checkbox is changed.
 */
export function programFormValues(program: ReferralProgramRecord | null | undefined): ProgramFormValues {
  if (!program) return { ...PROGRAM_FORM_DEFAULTS, enabledModes: [] }
  return {
    name: program.name ?? '',
    enabledModes: withoutRevenueShare(program.enabledModes),
    maxDepth: program.maxDepth || 4,
    minReferralBalanceForCashTransfer: program.minReferralBalanceForCashTransfer ?? 0,
  }
}

/**
 * The legacy rules and messages: a name of at least three characters (an empty name only says it is
 * required), a depth from 1 to 4, a minimum of 0 or more, at least one reward type. Named change: a
 * fractional depth is refused here (`Enter a whole number`) where GraphQL `Int` used to reject it as an
 * error toast.
 */
export const programSchema = z
  .object({
    name: z.string().min(1, 'Program name is required').min(3, 'At least 3 characters'),
    enabledModes: z.array(z.string()).min(1, 'At least one reward type must be enabled'),
    maxDepth: z.number().nullable(),
    minReferralBalanceForCashTransfer: z.number().nullable(),
  })
  .superRefine((values, context) => {
    if (values.maxDepth === null) {
      context.addIssue({ code: 'custom', path: ['maxDepth'], message: 'Max depth is required' })
    } else if (!Number.isInteger(values.maxDepth)) {
      context.addIssue({ code: 'custom', path: ['maxDepth'], message: 'Enter a whole number' })
    } else if (values.maxDepth < 1 || values.maxDepth > 4) {
      context.addIssue({ code: 'custom', path: ['maxDepth'], message: 'Must be between 1 and 4' })
    }
    const minimum = values.minReferralBalanceForCashTransfer
    if (minimum !== null && minimum < 0) {
      context.addIssue({
        code: 'custom',
        path: ['minReferralBalanceForCashTransfer'],
        message: 'Must be 0 or greater',
      })
    }
  })

export interface ReferralProgramInput {
  name: string
  enabledModes: string[]
  maxDepth: number
  minReferralBalanceForCashTransfer: number
}

/** The upsert input, built and keyed exactly as the legacy submit built it. */
export function buildProgramInput(values: ProgramFormValues): ReferralProgramInput {
  const modes = (values.enabledModes || []).filter((mode) => mode !== HIDDEN_PROGRAM_MODE)
  return {
    name: values.name,
    enabledModes: modes,
    maxDepth: values.maxDepth || 4,
    minReferralBalanceForCashTransfer: values.minReferralBalanceForCashTransfer ?? 0,
  }
}

/**
 * antd's Checkbox.Group on a change: the earlier order is kept, a newly checked type goes last, and
 * every value without a checkbox (the hidden Loss Share and Turnover Milestone) is dropped. The kit
 * group reports its checked options in option order, so the earlier order is rebuilt here.
 */
export function nextEnabledModes(
  previous: readonly string[],
  checked: readonly string[],
  offered: readonly string[] = VISIBLE_REWARD_VALUES,
): string[] {
  const kept = previous.filter((mode) => checked.includes(mode))
  const added = checked.filter((mode) => !previous.includes(mode))
  return [...kept, ...added].filter((mode, index, all) => offered.includes(mode) && all.indexOf(mode) === index)
}

export interface ProgramSaveResult {
  success?: boolean | null
  message?: string | null
}

export interface ProgramToast {
  message: string
  tone: 'ok' | 'error'
  duration: number
}

/* The legacy notifications: success for 3 seconds, failures for 5. */
const SUCCESS_MS = 3000
const FAILURE_MS = 5000

export function programSaveToast(result: ProgramSaveResult | null | undefined): ProgramToast {
  return result?.success
    ? { message: result.message || 'Program updated successfully', tone: 'ok', duration: SUCCESS_MS }
    : { message: result?.message || 'Failed to update program', tone: 'error', duration: FAILURE_MS }
}

export function programErrorToast(error: { message?: string | null } | null | undefined): ProgramToast {
  return { message: error?.message || 'Failed to update program', tone: 'error', duration: FAILURE_MS }
}
