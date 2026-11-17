/**
 * Pure form rules and payload builders for /matka/create and /matka/edit/:id.
 *
 * The legacy page kept one antd Form across three conditionally-mounted steps.  This module keeps
 * the same defaults, per-step validation set, status-reason branch and GraphQL input shape while
 * carrying time-of-day values as the kit TimeField's native HH:mm strings.
 */
import { z } from 'zod'

const scheduleSchema = z.object({
  openTime: z.string(),
  closeTime: z.string(),
  daysOfWeek: z.array(z.number()),
  closesNextDay: z.boolean().optional(),
}).passthrough()

const limitsSchema = z.object({
  minBet: z.number().nullable(),
  maxBet: z.number().nullable(),
}).passthrough()

const visibilitySchema = z.object({
  featured: z.boolean(),
}).passthrough()

const settingsSchema = z.object({
  matkaType: z.enum(['worli','starline','jackpot','sattaMatka']).optional(),
  openSuspended: z.boolean().optional(),
  closeSuspended: z.boolean().optional(),
  message: z.string().optional(),
  autoPauseOnLiabilityThreshold: z.number().nullable(),
  betWindowMinsBeforeOpen: z.number().nullable(),
  betWindowMinsBeforeClose: z.number().nullable(),
  notes: z.string(),
}).passthrough()

const baseSchema = z.object({
  name: z.string(),
  code: z.string(),
  description: z.string(),
  timezone: z.string(),
  status: z.string(),
  schedule: scheduleSchema,
  limits: limitsSchema,
  visibility: visibilitySchema,
  priority: z.number().nullable(),
  settings: settingsSchema,
}).passthrough()

export type MatkaFormValues = z.infer<typeof baseSchema>
export type MatkaFormField =
  | 'name'
  | 'code'
  | 'schedule.openTime'
  | 'schedule.closeTime'
  | 'schedule.daysOfWeek'
  | 'limits.minBet'
  | 'limits.maxBet'
  | 'status'
  | 'settings.autoPauseOnLiabilityThreshold'
  | 'settings.betWindowMinsBeforeOpen'
  | 'settings.betWindowMinsBeforeClose'

export interface MatkaRecord {
  id?: string
  name?: unknown
  code?: unknown
  description?: unknown
  timezone?: unknown
  schedule?: Record<string, unknown> | null
  status?: unknown
  limits?: Record<string, unknown> | null
  visibility?: Record<string, unknown> | null
  priority?: unknown
  settings?: Record<string, unknown> | null
}

export interface MatkaStep {
  title: string
  description: string
  footer: string
}

export const MATKA_LIST_PATH = '/matka/list'
export const MATKA_STEP_COUNT = 3
export const SAVE_FAILURE = 'Failed to save matka. Please check the form and try again.'
export const DEFAULT_STATUS_REASON = 'Status change'

export const MATKA_STEPS: readonly MatkaStep[] = [
  { title: 'Basic Info', description: 'Name & schedule', footer: 'Basic Info' },
  { title: 'Betting Configuration', description: 'Limits & settings', footer: 'Betting Configuration' },
  { title: 'Review', description: 'Confirm & create', footer: 'Review & Create' },
]

export const DAY_OPTIONS = [
  { label: 'Sun', full: 'Sunday', short: 'S', value: 0 },
  { label: 'Mon', full: 'Monday', short: 'M', value: 1 },
  { label: 'Tue', full: 'Tuesday', short: 'T', value: 2 },
  { label: 'Wed', full: 'Wednesday', short: 'W', value: 3 },
  { label: 'Thu', full: 'Thursday', short: 'T', value: 4 },
  { label: 'Fri', full: 'Friday', short: 'F', value: 5 },
  { label: 'Sat', full: 'Saturday', short: 'S', value: 6 },
] as const

export const QUICK_DAYS = [
  { label: 'Weekdays', values: [1, 2, 3, 4, 5] },
  { label: 'All Week', values: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekend', values: [0, 6] },
] as const

/** The legacy Form initialValues, with absent optional numeric input represented as null. */
export function createMatkaInitialValues(): MatkaFormValues {
  return {
    name: '',
    code: '',
    description: '',
    timezone: 'Asia/Kolkata',
    status: 'ACTIVE',
    schedule: { openTime: '09:00', closeTime: '21:00', daysOfWeek: [1, 2, 3, 4, 5, 6], closesNextDay: false },
    limits: { minBet: 10, maxBet: 10000 },
    visibility: { featured: false },
    priority: 0,
    settings: {
      matkaType: 'worli', openSuspended: false, closeSuspended: false, message: '',
      autoPauseOnLiabilityThreshold: null,
      betWindowMinsBeforeOpen: 15,
      betWindowMinsBeforeClose: 10,
      notes: '',
    },
  }
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function dayValues(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value) && value.every((day) => typeof day === 'number')
    ? [...value]
    : [...fallback]
}

/** The same deep setFieldsValue merge the edit page performed when its query completed. */
export function matkaValuesFromRecord(record: MatkaRecord): MatkaFormValues {
  const defaults = createMatkaInitialValues()
  const schedule = recordValue(record.schedule)
  const limits = recordValue(record.limits)
  const visibility = recordValue(record.visibility)
  const settings = recordValue(record.settings)
  return {
    ...defaults,
    name: stringValue(record.name),
    code: stringValue(record.code),
    description: stringValue(record.description),
    timezone: stringValue(record.timezone, defaults.timezone),
    status: stringValue(record.status, defaults.status),
    schedule: {
      ...defaults.schedule,
      ...schedule,
      openTime: stringValue(schedule.openTime, defaults.schedule.openTime),
      closeTime: stringValue(schedule.closeTime, defaults.schedule.closeTime),
      daysOfWeek: dayValues(schedule.daysOfWeek, defaults.schedule.daysOfWeek),
    },
    limits: {
      ...defaults.limits,
      ...limits,
      minBet: numberValue(limits.minBet, defaults.limits.minBet),
      maxBet: numberValue(limits.maxBet, defaults.limits.maxBet),
    },
    visibility: {
      ...defaults.visibility,
      ...visibility,
      featured: typeof visibility.featured === 'boolean' ? visibility.featured : defaults.visibility.featured,
    },
    priority: numberValue(record.priority, defaults.priority),
    settings: {
      ...defaults.settings,
      ...settings,
      autoPauseOnLiabilityThreshold: numberValue(settings.autoPauseOnLiabilityThreshold, null),
      betWindowMinsBeforeOpen: numberValue(
        settings.betWindowMinsBeforeOpen,
        defaults.settings.betWindowMinsBeforeOpen,
      ),
      betWindowMinsBeforeClose: numberValue(
        settings.betWindowMinsBeforeClose,
        defaults.settings.betWindowMinsBeforeClose,
      ),
      notes: stringValue(settings.notes),
    },
  }
}

export function slugFromMatkaName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function sameDays(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

export function toggleDay(selected: readonly number[], day: number): number[] {
  return selected.includes(day)
    ? selected.filter((value) => value !== day)
    : Array.from(new Set([...selected, day]))
}

export function selectedDaysSummary(selected: readonly number[]): string {
  if (selected.length === 0) return 'No days selected'
  if (selected.length === 7) return 'Operating all week'
  return `${selected.length} day${selected.length > 1 ? 's' : ''} selected`
}

/** The fields the Betting Configuration step shows; every other field is on Basic Info. */
const BETTING_STEP_FIELDS = new Set([
  'limits.minBet', 'limits.maxBet', 'status', 'settings.autoPauseOnLiabilityThreshold', 'settings.betWindowMinsBeforeOpen',
  'settings.betWindowMinsBeforeClose', 'settings.notes', 'settings.message',
])

/** The first step showing a field with one of these errors, or null for none (a form-level error has no step).
 *  The Review step shows no fields, so a submit refused there goes back to it. */
export function matkaErrorStep(errorPaths: readonly string[]): number | null {
  const steps = errorPaths.filter((path) => path && path !== '_form').map((path) => (BETTING_STEP_FIELDS.has(path) ? 1 : 0))
  return steps.length ? Math.min(...steps) : null
}

/** The fields Next validates on each step, with the full-submit rules (matkaFormSchema, which follows the server).
 *  Betting Configuration used to validate nothing, so a Min Bet of 0 went on to Review and was refused only by
 *  Create Matka; its limits, status and cutoffs now stop Next on their own step. Review has no fields. */
export function matkaStepFields(step: number, isEdit: boolean): MatkaFormField[] {
  if (step === 1) {
    return [
      'limits.minBet',
      'limits.maxBet',
      'status',
      'settings.autoPauseOnLiabilityThreshold',
      'settings.betWindowMinsBeforeOpen',
      'settings.betWindowMinsBeforeClose',
    ]
  }
  if (step !== 0) return []
  return [
    'name',
    ...(isEdit ? [] : ['code'] as const),
    'schedule.openTime',
    'schedule.closeTime',
    'schedule.daysOfWeek',
  ]
}

/** Full-submit schema. Code remains in the values in edit mode but is not required there. */
export function matkaFormSchema(isEdit: boolean) {
  return baseSchema.superRefine((values, context) => {
    if (!values.name) context.addIssue({ code: 'custom', path: ['name'], message: 'Please enter name' })
    if (!isEdit && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.code)) {
      context.addIssue({ code: 'custom', path: ['code'], message: 'kebab-case only (a-z, 0-9, - )' })
    }
    if (!values.schedule.openTime) context.addIssue({ code: 'custom', path: ['schedule', 'openTime'], message: 'Required' })
    if (!values.schedule.closeTime) context.addIssue({ code: 'custom', path: ['schedule', 'closeTime'], message: 'Required' })
    if (values.schedule.daysOfWeek.length === 0) {
      context.addIssue({ code: 'custom', path: ['schedule', 'daysOfWeek'], message: 'Select at least one day' })
    }
    // The server needs a positive minimum and a maximum no lower than it (shared/src/matka/config.ts); a form
    // it would refuse is stopped here, at the field.
    if (values.limits.minBet === null) {
      context.addIssue({ code: 'custom', path: ['limits', 'minBet'], message: 'Please enter min bet amount' })
    } else if (values.limits.minBet <= 0) {
      context.addIssue({ code: 'custom', path: ['limits', 'minBet'], message: 'Value must be more than 0' })
    }
    if (values.limits.maxBet === null) {
      context.addIssue({ code: 'custom', path: ['limits', 'maxBet'], message: 'Please enter max bet amount' })
    } else if (values.limits.maxBet < 0) {
      context.addIssue({ code: 'custom', path: ['limits', 'maxBet'], message: 'Value must be at least 0' })
    } else if (values.limits.minBet !== null && values.limits.minBet > 0 && values.limits.maxBet < values.limits.minBet) {
      context.addIssue({ code: 'custom', path: ['limits', 'maxBet'], message: 'Max bet must be at least the min bet' })
    }
    if (!values.status) context.addIssue({ code: 'custom', path: ['status'], message: 'Required' })
    if (values.priority !== null && values.priority < 0) {
      context.addIssue({ code: 'custom', path: ['priority'], message: 'Value must be at least 0' })
    }
    if (values.settings.autoPauseOnLiabilityThreshold !== null
      && values.settings.autoPauseOnLiabilityThreshold < 0) {
      context.addIssue({
        code: 'custom',
        path: ['settings', 'autoPauseOnLiabilityThreshold'],
        message: 'Value must be at least 0',
      })
    }
    if (values.settings.betWindowMinsBeforeOpen === null) {
      context.addIssue({
        code: 'custom',
        path: ['settings', 'betWindowMinsBeforeOpen'],
        message: 'Please enter betting cutoff before open',
      })
    } else if (values.settings.betWindowMinsBeforeOpen < 0) {
      context.addIssue({
        code: 'custom',
        path: ['settings', 'betWindowMinsBeforeOpen'],
        message: 'Value must be at least 0',
      })
    }
    if (values.settings.betWindowMinsBeforeClose === null) {
      context.addIssue({
        code: 'custom',
        path: ['settings', 'betWindowMinsBeforeClose'],
        message: 'Please enter betting cutoff before close',
      })
    } else if (values.settings.betWindowMinsBeforeClose < 0) {
      context.addIssue({
        code: 'custom',
        path: ['settings', 'betWindowMinsBeforeClose'],
        message: 'Value must be at least 0',
      })
    }
  })
}

/** Legacy recursive cleaning: null and undefined object properties disappear. */
export function sanitizeMatkaInput(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) return value.map(sanitizeMatkaInput)
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = sanitizeMatkaInput(entry)
      if (cleaned !== undefined) output[key] = cleaned
    }
    return output
  }
  return value
}

function descriptionValue(description: string): string | undefined {
  return description.trim() ? description.trim() : undefined
}

function commonInput(values: MatkaFormValues) {
  return {
    name: values.name,
    description: descriptionValue(values.description),
    timezone: values.timezone || 'Asia/Kolkata',
    schedule: values.schedule,
    limits: values.limits,
    visibility: values.visibility,
    priority: typeof values.priority === 'number' ? values.priority : 0,
    settings: values.settings,
  }
}

export function buildCreateMatkaInput(values: MatkaFormValues): Record<string, unknown> {
  const common = commonInput(values)
  return sanitizeMatkaInput({
    name: common.name,
    code: values.code,
    description: common.description,
    timezone: common.timezone,
    status: values.status,
    schedule: common.schedule,
    limits: common.limits,
    visibility: common.visibility,
    priority: common.priority,
    settings: common.settings,
  }) as Record<string, unknown>
}

/** A status change uses the dedicated mutation, so the ordinary update omits status exactly as before. */
export function buildUpdateMatkaInput(
  id: string,
  values: MatkaFormValues,
  originalStatus: unknown,
): Record<string, unknown> {
  const common = commonInput(values)
  const changed = values.status !== originalStatus
  return sanitizeMatkaInput({
    id,
    name: common.name,
    description: common.description,
    timezone: common.timezone,
    ...(changed ? {} : { status: values.status }),
    schedule: common.schedule,
    limits: common.limits,
    visibility: common.visibility,
    priority: common.priority,
    settings: common.settings,
  }) as Record<string, unknown>
}

export function needsStatusReason(values: MatkaFormValues, originalStatus: unknown): boolean {
  return values.status !== originalStatus
}

export function statusChangeVariables(id: string, status: string, reason?: string) {
  return { id, toStatus: status, reason: reason || DEFAULT_STATUS_REASON }
}

export function pageTitle(isEdit: boolean): string {
  return isEdit ? 'Edit Matka' : 'Create Matka'
}

export function pageSubtitle(isEdit: boolean): string {
  return isEdit ? 'Update matka configuration' : 'Configure new matka with schedule and betting limits'
}
