/**
 * Pure form, review and mutation helpers for `/config/whitelabels/create`.
 *
 * The registered route is create-only. The step component names still contain `Edit` because they
 * pre-date the removal of whitelabel editing, but no edit route or edit payload exists today.
 */
import { z } from 'zod'

export type WhitelabelStatus = 'active' | 'inactive' | 'suspend'

export interface SharingRates {
  sports: number | null
  casino: number | null
  matka: number | null
}

export interface WhitelabelWizardValues {
  name: string
  domain: string
  status: WhitelabelStatus
  adminEmail: string
  adminName: string
  adminPassword: string
  confirmPassword: string
  adminPhone: string
  sharingRates: SharingRates
  /** Kept only for the legacy review fallback. The create payload never sends it. */
  sharePercent: number | null
  logoUrl: string | null
  faviconUrl: string | null
  creditLimit: number | null
}

export type WhitelabelWizardField =
  | keyof WhitelabelWizardValues
  | `sharingRates.${keyof SharingRates}`

const shareRateSchema = z
  .number()
  .min(0, 'Share must be 0-100%')
  .max(100, 'Share must be 0-100%')
  .nullable()

export const whitelabelWizardSchema: z.ZodType<WhitelabelWizardValues> = z
  .object({
    name: z
      .string()
      .min(1, 'Please enter whitelabel name')
      .min(2, 'Name must be at least 2 characters'),
    domain: z
      .string()
      .min(1, 'Please enter primary domain')
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Enter a valid domain'),
    status: z.enum(['active', 'inactive', 'suspend'], {
      message: 'Please select account status',
    }),
    adminEmail: z
      .string()
      .min(1, 'Please enter admin email')
      .email('Please enter a valid email'),
    adminName: z
      .string()
      .min(1, 'Please enter admin name')
      .min(2, 'Name must be at least 2 characters'),
    adminPassword: z
      .string()
      .min(1, 'Please enter password')
      .min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm password'),
    adminPhone: z
      .string()
      .refine((value) => value === '' || /^[+]?[^\s]+$/.test(value), 'Please enter a valid phone number'),
    sharingRates: z.object({
      sports: shareRateSchema,
      casino: shareRateSchema,
      matka: shareRateSchema,
    }),
    sharePercent: z.number().nullable(),
    logoUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    creditLimit: z.number().min(0, 'Credit limit must be positive').nullable(),
  })
  .superRefine((values, context) => {
    if (values.confirmPassword && values.confirmPassword !== values.adminPassword) {
      context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match' })
    }
  })

export const INITIAL_WHITELABEL_VALUES: WhitelabelWizardValues = {
  name: '',
  domain: '',
  status: 'active',
  adminEmail: '',
  adminName: '',
  adminPassword: '',
  confirmPassword: '',
  adminPhone: '',
  sharingRates: {
    sports: 0,
    casino: 0,
    matka: 0,
  },
  sharePercent: null,
  logoUrl: null,
  faviconUrl: null,
  creditLimit: null,
}

export const WHITELABELS_PATH = '/config/whitelabels'
export const STEP_COUNT = 4

export interface WizardStep {
  title: string
  description: string
  short: string
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  { title: 'Basic Info', description: 'Name & domains', short: 'Basic' },
  { title: 'Account', description: 'Login & sharing', short: 'Account' },
  { title: 'Branding', description: 'Logo & favicon', short: 'Branding' },
  { title: 'Review', description: 'Confirm changes', short: 'Review' },
]

const BASIC_FIELDS: WhitelabelWizardField[] = ['name', 'domain']
const ACCOUNT_NEXT_FIELDS: WhitelabelWizardField[] = [
  'status',
  'adminEmail',
  'adminName',
  'adminPassword',
  'confirmPassword',
]

/** Exactly the fields the legacy Next button validated on each step. */
export function stepFields(step: number): WhitelabelWizardField[] {
  if (step === 0) return [...BASIC_FIELDS]
  if (step === 1) return [...ACCOUNT_NEXT_FIELDS]
  return []
}

/** The step that owns a validation issue, used only to reveal and focus an invalid field. */
export function stepForField(path: string): number {
  if (BASIC_FIELDS.includes(path as WhitelabelWizardField)) return 0
  if (
    ACCOUNT_NEXT_FIELDS.includes(path as WhitelabelWizardField)
    || path === 'adminPhone'
    || path === 'creditLimit'
    || path === 'sharePercent'
    || path.startsWith('sharingRates.')
  ) return 1
  if (path === 'logoUrl' || path === 'faviconUrl') return 2
  return 3
}

export interface SharingRateInput {
  domain: string
  shareRate: number
}

/** Exact `CreateWhitelabelInput` shape and key order used by the legacy page. */
export interface CreateWhitelabelPayload {
  id: string
  name: string
  domain: string
  sharingRates: SharingRateInput[] | undefined
  partnerAdminName: string
  partnerAdminEmail: string
  partnerAdminPassword: string
  logoUrl: string | null
  faviconUrl: string | null
  creditLimit: number | undefined
}

export function whitelabelIdFromDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function hasRequiredCreateValues(values: WhitelabelWizardValues): boolean {
  return Boolean(values.name && values.domain && values.adminEmail && values.adminName && values.adminPassword)
}

export function buildCreateWhitelabelPayload(values: WhitelabelWizardValues): CreateWhitelabelPayload {
  return {
    id: whitelabelIdFromDomain(values.domain),
    name: values.name.trim(),
    domain: values.domain.trim(),
    sharingRates: values.sharingRates
      ? Object.entries(
          values.sharingRates as unknown as Record<string, number | string | null | undefined>,
        )
          .filter(([, rate]) => rate !== null && rate !== undefined && rate !== '')
          .map(([domain, rate]) => ({
            domain,
            shareRate: typeof rate === 'number' ? rate : Number.isNaN(Number(rate)) ? 0 : Number(rate),
          }))
      : undefined,
    partnerAdminName: values.adminName.trim(),
    partnerAdminEmail: values.adminEmail.trim(),
    partnerAdminPassword: values.adminPassword,
    logoUrl: values.logoUrl || null,
    faviconUrl: values.faviconUrl || null,
    creditLimit: values.creditLimit || undefined,
  }
}

export function firstValidationIssue(values: WhitelabelWizardValues): { path: string; message: string } | null {
  const parsed = whitelabelWizardSchema.safeParse(values)
  if (parsed.success) return null
  const issue = parsed.error.issues[0]
  return issue ? { path: issue.path.map(String).join('.'), message: issue.message } : null
}

export interface RateReview {
  domain: string
  label: string
  value: string
  status: 'High Share' | 'Low Share' | 'Standard Share'
  tone: 'neg' | 'ok' | 'info'
}

export function rateReviews(values: WhitelabelWizardValues): RateReview[] {
  return Object.entries(values.sharingRates).map(([domain, rate]) => {
    const numeric = Number(rate ?? 0)
    const high = numeric > 25
    const low = numeric < 5
    return {
      domain,
      label: `${domain.charAt(0).toUpperCase()}${domain.slice(1)} Share`,
      value: `${typeof rate === 'number' ? rate.toFixed(2) : rate ?? 0}%`,
      status: high ? 'High Share' : low ? 'Low Share' : 'Standard Share',
      tone: high ? 'neg' : low ? 'ok' : 'info',
    }
  })
}

export function statusReview(status: WhitelabelStatus) {
  if (status === 'active') return { label: 'Active', description: 'Full access enabled', tone: 'ok' as const }
  if (status === 'inactive') return { label: 'Inactive', description: 'Limited access', tone: 'warn' as const }
  return { label: 'Suspended', description: 'Access blocked', tone: 'neg' as const }
}

export function isSafeImageSource(value: string | null | undefined): value is string {
  return Boolean(value && (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')))
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

export interface CategoryMutationResult {
  success?: boolean | null
  message?: string | null
  categoriesCreated?: number | null
  gamesAssigned?: number | null
}

export function categoryOutcome(result: CategoryMutationResult | null | undefined) {
  if (!result?.success) {
    return { tone: 'error' as const, message: result?.message || 'Failed to generate categories.' }
  }
  if ((result.categoriesCreated ?? 0) === 0 && (result.gamesAssigned ?? 0) === 0) {
    return {
      tone: 'info' as const,
      message:
        result.message
        || 'No categories created. Enable at least one casino provider (Gap or GMAG) for this whitelabel.',
    }
  }
  return { tone: 'ok' as const, message: result.message || 'Casino categories generated.' }
}

export function thrownMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const direct = 'message' in error && typeof error.message === 'string' ? error.message : ''
    if (direct) return direct
    if ('graphQLErrors' in error && Array.isArray(error.graphQLErrors)) {
      const first = error.graphQLErrors[0]
      if (first && typeof first === 'object' && 'message' in first && typeof first.message === 'string') {
        return first.message
      }
    }
  }
  return fallback
}
