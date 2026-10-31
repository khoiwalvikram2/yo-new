/**
 * Pure logic of /config/whitelabels, moved out of the legacy WhitelabelsListPage.tsx and its table, statistics
 * and drawer components: the Super Admin test, the local search and the page slice, the per-domain share
 * rates, the credit standing, the status words, the statistics, the drawer's rate bands and theme swatches,
 * and the rules and variables of the Adjust Credit and Reset Admin Password dialogs.
 */
import { z } from 'zod'

export interface WhitelabelDomainRate {
  domain: string
  rate: number
}

export interface WhitelabelTheme {
  primary: string
  success: string
  warning: string
  danger: string
  bgPage: string
  textPrimary: string
  textSecondary: string
  border: string
}

/** A row of the list query (`whitelabels`); the statistics query returns a subset of these fields. */
export interface Whitelabel {
  id: string
  name: string
  domain: string
  // sharePercent removed - use sharingRates for per-domain rates
  sharingRates?: WhitelabelDomainRate[] | null
  logoUrl?: string | null
  faviconUrl?: string | null
  status?: string | null
  creditLimit?: number | null
  creditUsed?: number | null
  creditAvailable?: number | null
  creditAlertThreshold?: number | null
  theme?: WhitelabelTheme | null
}

export const CREATE_WHITELABEL_PATH = '/config/whitelabels/create'
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
/** The three product domains every row shows, in the legacy order. */
export const SHARE_DOMAINS = ['sports', 'casino', 'matka'] as const

/** The legacy role test that decides whether Reset Admin Password is offered. */
export function isSuperAdminRole(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((r) =>
    r === 'Super Admin' || r.toLowerCase() === 'super_admin' ||
    (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin')),
  )
}

/** The local search: name, domain or id contains the debounced text, case-insensitive. */
export function filterWhitelabels<T extends Pick<Whitelabel, 'id' | 'name' | 'domain'>>(
  allRows: readonly T[],
  debouncedQuery: string,
): T[] {
  if (!debouncedQuery.trim()) return [...allRows]
  const q = debouncedQuery.trim().toLowerCase()
  return allRows.filter(
    (w) =>
      w.name?.toLowerCase().includes(q) ||
      w.domain?.toLowerCase().includes(q) ||
      w.id?.toLowerCase().includes(q),
  )
}

/** The page the pager can show: a search that shrinks the list moves a page past the end back to the last. */
export function clampPage(current: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(current) || 1), pages)
}

export function pageSlice<T>(rows: readonly T[], current: number, pageSize: number): T[] {
  const page = clampPage(current, rows.length, pageSize)
  const size = Math.max(1, pageSize)
  return rows.slice((page - 1) * size, page * size)
}

export function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'whitelabel' : 'whitelabels'}`
}

/**
 * The Share % cell: always the three domains, each from `sharingRates` when the resolver sent any (it always
 * sends all three), 0 otherwise.
 */
export function shareRatesFor(w: Pick<Whitelabel, 'sharingRates'>): WhitelabelDomainRate[] {
  let ratesMap = new Map<string, number>()
  if (w.sharingRates && Array.isArray(w.sharingRates) && w.sharingRates.length > 0) {
    ratesMap = new Map(w.sharingRates.map((r) => [r.domain, r.rate]))
  }
  SHARE_DOMAINS.forEach((domain) => {
    if (!ratesMap.has(domain)) ratesMap.set(domain, 0)
  })
  return SHARE_DOMAINS.map((domain) => ({ domain, rate: ratesMap.get(domain) ?? 0 }))
}

/** `Sports: 12.50%`: the domain capitalised, as the legacy cell's `capitalize` showed it. */
export function shareChipText(rate: WhitelabelDomainRate): string {
  return `${capitalize(rate.domain)}: ${rate.rate.toFixed(2)}%`
}

/** The export's Share % text, as the legacy export getter built it. */
export function shareRatesExportText(w: Pick<Whitelabel, 'sharingRates'>): string {
  const ratesMap = new Map<string, number>()
  if (w.sharingRates?.length) {
    w.sharingRates.forEach((r: WhitelabelDomainRate) => ratesMap.set(r.domain, r.rate))
  }
  SHARE_DOMAINS.forEach((d) => { if (!ratesMap.has(d)) ratesMap.set(d, 0) })
  return SHARE_DOMAINS.map((d) => `${d}: ${(ratesMap.get(d) ?? 0).toFixed(2)}%`).join(', ')
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function appConfigurationPath(whitelabelId: string): string {
  return `/config/app-configuration?whitelabelId=${whitelabelId}`
}

export type WhitelabelStatusTone = 'ok' | 'warn' | 'neg'

/** The legacy tag: `active` Active (green), `inactive` Inactive (orange), anything else Suspended (red). */
export function whitelabelStatusLabel(status: string | null | undefined): string {
  return status === 'active' ? 'Active' : status === 'inactive' ? 'Inactive' : 'Suspended'
}

export function whitelabelStatusTone(status: string | null | undefined): WhitelabelStatusTone {
  return status === 'active' ? 'ok' : status === 'inactive' ? 'warn' : 'neg'
}

export interface CreditStanding {
  available: number
  /** `42.5% used` */
  usageText: string
  /** neg when over the limit, warn at or past the alert threshold (80% by default), ok otherwise. */
  tone: WhitelabelStatusTone
}

export function creditStanding(
  w: Pick<Whitelabel, 'creditAvailable' | 'creditLimit' | 'creditAlertThreshold'>,
): CreditStanding {
  const available = Number(w.creditAvailable || 0)
  const limit = Number(w.creditLimit || 0)
  const usagePercent = limit > 0 ? ((limit - available) / limit) * 100 : 0
  const threshold = Number(w.creditAlertThreshold || 80)
  const isNearThreshold = usagePercent >= threshold
  const isOverLimit = available < 0
  return {
    available,
    usageText: `${usagePercent.toFixed(1)}% used`,
    tone: isOverLimit ? 'neg' : isNearThreshold ? 'warn' : 'ok',
  }
}

/** The drawer's band for a share rate: over 25 High (red), under 5 Low (green), otherwise Standard (blue). */
export interface RateBand {
  label: 'High' | 'Low' | 'Standard'
  tone: 'neg' | 'ok' | 'info'
  meterTone: 'neg' | 'acc'
}

export function rateBand(rate: number): RateBand {
  if (rate > 25) return { label: 'High', tone: 'neg', meterTone: 'neg' }
  if (rate < 5) return { label: 'Low', tone: 'ok', meterTone: 'acc' }
  return { label: 'Standard', tone: 'info', meterTone: 'acc' }
}

export interface ThemeSwatch {
  label: string
  value: string
}

export function themeSwatches(theme: WhitelabelTheme): ThemeSwatch[] {
  return [
    { label: 'Primary', value: theme.primary },
    { label: 'Success', value: theme.success },
    { label: 'Warning', value: theme.warning },
    { label: 'Danger', value: theme.danger },
    { label: 'Background', value: theme.bgPage },
    { label: 'Text Primary', value: theme.textPrimary },
    { label: 'Text Secondary', value: theme.textSecondary },
    { label: 'Border', value: theme.border },
  ]
}

export type WhitelabelStatsItem = Pick<
  Whitelabel,
  'id' | 'name' | 'domain' | 'sharingRates' | 'status' | 'creditLimit' | 'creditUsed' | 'creditAvailable'
>

export interface WhitelabelStats {
  totalWhitelabels: number
  activeWhitelabels: number
  inactiveWhitelabels: number
  totalDomains: number
  primaryDomains: number
  extraDomains: number
  totalCreditLimit: number
  totalCreditUsed: number
  creditUtilization: number
  activeRate: number
}

/** The four figures of the legacy stat cards, computed exactly as they were. */
export function whitelabelStats(whitelabels: readonly WhitelabelStatsItem[]): WhitelabelStats {
  const totalWhitelabels = whitelabels.length
  const activeWhitelabels = whitelabels.filter((w) => w.status === 'ACTIVE' || w.status === 'active').length
  const inactiveWhitelabels = totalWhitelabels - activeWhitelabels

  // Total domains: the primary domain plus one per sharingRates entry.
  const totalDomains = whitelabels.reduce((sum, w) => {
    const primaryDomain = w.domain ? 1 : 0
    const extraDomains = w.sharingRates?.length || 0
    return sum + primaryDomain + extraDomains
  }, 0)
  const primaryDomains = whitelabels.filter((w) => w.domain).length
  const extraDomains = totalDomains - primaryDomains

  const totalCreditLimit = whitelabels.reduce((sum, w) => sum + Number(w.creditLimit || 0), 0)
  const totalCreditUsed = whitelabels.reduce((sum, w) => sum + Number(w.creditUsed || 0), 0)
  const creditUtilization = totalCreditLimit > 0 ? Math.round((totalCreditUsed / totalCreditLimit) * 100) : 0
  const activeRate = totalWhitelabels > 0 ? Math.round((activeWhitelabels / totalWhitelabels) * 100) : 0

  return {
    totalWhitelabels,
    activeWhitelabels,
    inactiveWhitelabels,
    totalDomains,
    primaryDomains,
    extraDomains,
    totalCreditLimit,
    totalCreditUsed,
    creditUtilization,
    activeRate,
  }
}

/** The Credit Usage tile's hue: red over 60% (the legacy 80/60 split was red either way), else the legacy
 *  grey, which the kit's decorative ramp spells as indigo. */
export function creditUsageHue(creditUtilization: number): 'red' | 'ind' {
  return creditUtilization > 80 ? 'red' : creditUtilization > 60 ? 'red' : 'ind'
}

// ---------- Adjust Whitelabel Credit ----------

const creditValuesSchema = z.object({
  creditLimit: z.number().nullable(),
  reason: z.string(),
})

export type CreditFormValues = z.infer<typeof creditValuesSchema>

/** The legacy rules: required, then a number of at least 0. */
export const creditFormSchema = creditValuesSchema.superRefine((values, context) => {
  if (values.creditLimit === null) {
    context.addIssue({ code: 'custom', path: ['creditLimit'], message: 'Please enter credit limit' })
  } else if (values.creditLimit < 0) {
    context.addIssue({ code: 'custom', path: ['creditLimit'], message: 'Credit limit must be positive' })
  }
})

/** The dialog opens on the stored limit (0 when there is none) and an empty reason. */
export function creditInitialValues(w: Pick<Whitelabel, 'creditLimit'>): CreditFormValues {
  return {
    creditLimit: w.creditLimit || 0, // Already in rupees (database stores in base currency)
    reason: '',
  }
}

export function adjustCreditVariables(whitelabelId: string, values: CreditFormValues) {
  return {
    input: {
      whitelabelId,
      creditLimit: values.creditLimit, // Already in rupees (database stores in base currency)
      reason: values.reason || 'Credit adjustment by Super Admin',
    },
  }
}

// ---------- Reset Whitelabel Admin Password ----------

const resetPasswordValuesSchema = z.object({
  adminEmail: z.string(),
  newPassword: z.string(),
  confirmPassword: z.string(),
  adminPassword: z.string(),
})

export type ResetPasswordValues = z.infer<typeof resetPasswordValuesSchema>

/** Nothing is ever pre-filled: every opening starts empty. */
export const EMPTY_RESET_PASSWORD: ResetPasswordValues = {
  adminEmail: '',
  newPassword: '',
  confirmPassword: '',
  adminPassword: '',
}

/** The legacy field measured a string's length in code points (a surrogate pair counts once). */
export function codePointLength(value: string): number {
  return value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length
}

export const resetPasswordSchema = resetPasswordValuesSchema.superRefine((values, context) => {
  if (!values.newPassword) {
    context.addIssue({ code: 'custom', path: ['newPassword'], message: 'Please enter a new password' })
  } else if (codePointLength(values.newPassword) < 6) {
    context.addIssue({ code: 'custom', path: ['newPassword'], message: 'Password must be at least 6 characters' })
  }
  if (!values.confirmPassword) {
    context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Please confirm the new password' })
  } else if (values.newPassword !== values.confirmPassword) {
    context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match' })
  }
  if (!values.adminPassword) {
    context.addIssue({ code: 'custom', path: ['adminPassword'], message: 'Your password is required to confirm' })
  }
})

/** An admin email of only spaces is sent as null, as the legacy trim did; the passwords go as typed. */
export function resetPasswordVariables(whitelabelId: string, values: ResetPasswordValues) {
  return {
    whitelabelId,
    adminEmail: values.adminEmail?.trim() ? values.adminEmail.trim() : null,
    newPassword: values.newPassword,
    adminPassword: values.adminPassword,
  }
}

/**
 * The legacy `Validation Error` toast named the first error of the first field, in the form's field order.
 * Returns null when the values are valid.
 */
export function firstValidationError<V>(
  schema: z.ZodType<V>,
  values: V,
  fieldOrder: readonly string[],
): string | null {
  const parsed = schema.safeParse(values)
  if (parsed.success) return null
  for (const field of fieldOrder) {
    const issue = parsed.error.issues.find((candidate) => candidate.path.join('.') === field)
    if (issue) return issue.message
  }
  return parsed.error.issues[0]?.message || 'Please check the form fields'
}

export const CREDIT_FIELD_ORDER = ['creditLimit', 'reason'] as const
export const RESET_PASSWORD_FIELD_ORDER = ['adminEmail', 'newPassword', 'confirmPassword', 'adminPassword'] as const
