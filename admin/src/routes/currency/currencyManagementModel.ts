/**
 * Pure logic of /currency (W7 Task 199), moved out of the legacy antd page and its components (pre-images in
 * .backups/page-migration-2026-09-22/task-199): the list filter and paging, the statistics, the table's
 * labels and export columns, the currency form's rules and the exact Create/UpdateCurrencyInput, the
 * converter's defaults, guards and figures, and the default display currency setting. No React here.
 */
import { z } from 'zod'
import type { Currency, CreateCurrencyInput, UpdateCurrencyInput } from '@/shared/types/currency'
import type { TableExportColumn } from '@/shared/utils/tableExport'

/* ---------- views ---------- */

export type CurrencyView = 'currencies' | 'converter' | 'settings'

/** The legacy Segmented options, in order, with their labels. */
export const CURRENCY_VIEWS: ReadonlyArray<{ value: CurrencyView; label: string }> = [
  { value: 'currencies', label: 'Currencies' },
  { value: 'converter', label: 'Currency Converter' },
  { value: 'settings', label: 'Settings' },
]

/* ---------- list: filter, paging, labels ---------- */

export type CurrencyStatusFilter = '' | 'active' | 'inactive'

/** The legacy status options; '' is the cleared select ("All Status"). */
export const CURRENCY_STATUS_OPTIONS: ReadonlyArray<{ value: CurrencyStatusFilter; label: string }> = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

/** The legacy page started at 10 rows; the kit pager offers the other sizes the migrated pages offer. */
export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

/** The legacy filter, verbatim: code, name or symbol contain the query (any case); then the status. */
export function filterCurrencies(currencies: readonly Currency[], query: string, status: string): Currency[] {
  return currencies.filter((currency) => {
    const matchesQuery = !query ||
      currency.code.toLowerCase().includes(query.toLowerCase()) ||
      currency.name.toLowerCase().includes(query.toLowerCase()) ||
      currency.symbol.toLowerCase().includes(query.toLowerCase())

    const matchesStatus = !status ||
      (status === 'active' && currency.isActive) ||
      (status === 'inactive' && !currency.isActive)

    return matchesQuery && matchesStatus
  })
}

/** The legacy badge: one per non-empty filter. */
export function countActiveFilters(query: string, status: string): number {
  return [query, status].filter(Boolean).length
}

/** The page a list of `total` rows can show: a page past the end (after a filter) shows the last page. */
export function clampPage(page: number, total: number, pageSize: number): number {
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pageCount)
}

export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = (clampPage(page, rows.length, pageSize) - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/** The table head's count: `1 currency`, `N currencies`. */
export function currencyCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'currency' : 'currencies'}`
}

/** Six decimals, or `N/A` for a missing or zero rate, as the legacy cell. */
export function formatExchangeRate(rate: number | null | undefined): string {
  return rate ? rate.toFixed(6) : 'N/A'
}

/* ---------- statistics ---------- */

export interface CurrencyStats {
  total: number
  active: number
  inactive: number
  withRates: number
  missingRates: number
  activeWithRates: number
  /** Rounded percentage of active currencies; 0 with none. */
  activeRate: number
}

function hasExchangeRate(currency: Currency): boolean {
  return 'exchangeRate' in currency && Number((currency as Currency & { exchangeRate?: number }).exchangeRate) > 0
}

export function activeCurrenciesOf(currencies: readonly Currency[]): Currency[] {
  return currencies.filter((currency) => currency.isActive)
}

export function inactiveCurrenciesOf(currencies: readonly Currency[]): Currency[] {
  return currencies.filter((currency) => !currency.isActive)
}

/** The legacy StatsCards arithmetic. */
export function currencyStats(
  currencies: readonly Currency[],
  activeCurrencies: readonly Currency[],
  inactiveCurrencies: readonly Currency[],
): CurrencyStats {
  const total = currencies.length
  const active = activeCurrencies.length
  const withRates = currencies.filter(hasExchangeRate).length
  return {
    total,
    active,
    inactive: inactiveCurrencies.length,
    withRates,
    missingRates: total - withRates,
    activeWithRates: activeCurrencies.filter(hasExchangeRate).length,
    activeRate: total > 0 ? Math.round((active / total) * 100) : 0,
  }
}

/* ---------- export ---------- */

/** The legacy Export Excel columns, in order. */
export const CURRENCY_EXPORT_COLUMNS: TableExportColumn<Currency>[] = [
  { header: 'Name', key: 'name', width: 20, getter: (c) => c.name ?? '' },
  { header: 'Code', key: 'code', width: 12, getter: (c) => c.code ?? '' },
  { header: 'Symbol', key: 'symbol', width: 10, getter: (c) => c.symbol ?? '' },
  { header: 'Decimals', key: 'decimals', width: 10, getter: (c) => c.decimals ?? 0 },
  { header: 'Exchange Rate', key: 'exchangeRate', width: 14, getter: (c) => (c.exchangeRate != null ? c.exchangeRate : null) },
  { header: 'Status', key: 'status', width: 10, getter: (c) => (c.isActive ? 'Active' : 'Inactive') },
]

export function exportTitle(count: number): string {
  return `Currencies — ${count} currency(ies)`
}

/* ---------- the create / edit form ---------- */

export const MIN_EXCHANGE_RATE = 0.000001
/** The legacy InputNumber `precision={6}`. */
export const EXCHANGE_RATE_PRECISION = 6
export const MIN_DECIMALS = 0
export const MAX_DECIMALS = 8

const CODE_PATTERN = /^[A-Z]{3}$/

const currencyFormBaseSchema = z.object({
  code: z.string(),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().nullable(),
  exchangeRate: z.number().nullable(),
  isActive: z.boolean(),
})

export type CurrencyFormValues = z.infer<typeof currencyFormBaseSchema>

/**
 * The legacy rules and messages, first failing rule per field. Required means non-empty (whitespace counts,
 * as async-validator's `required` without `whitespace`). Decimals must also be whole (GraphQL `Int`).
 */
export const currencyFormSchema = currencyFormBaseSchema.superRefine((values, context) => {
  if (!values.code) {
    context.addIssue({ code: 'custom', path: ['code'], message: 'Please enter currency code' })
  } else if (values.code.length !== 3) {
    context.addIssue({ code: 'custom', path: ['code'], message: 'Currency code must be exactly 3 characters' })
  } else if (!CODE_PATTERN.test(values.code)) {
    context.addIssue({ code: 'custom', path: ['code'], message: 'Currency code must be 3 uppercase letters' })
  }
  if (!values.name) {
    context.addIssue({ code: 'custom', path: ['name'], message: 'Please enter currency name' })
  }
  if (!values.symbol) {
    context.addIssue({ code: 'custom', path: ['symbol'], message: 'Please enter currency symbol' })
  }
  if (values.decimals === null) {
    context.addIssue({ code: 'custom', path: ['decimals'], message: 'Please enter decimal places' })
  } else if (values.decimals < MIN_DECIMALS || values.decimals > MAX_DECIMALS) {
    context.addIssue({ code: 'custom', path: ['decimals'], message: 'Decimal places must be between 0 and 8' })
  } else if (!Number.isInteger(values.decimals)) {
    context.addIssue({ code: 'custom', path: ['decimals'], message: 'Enter a whole number' })
  }
  if (values.exchangeRate !== null && values.exchangeRate < MIN_EXCHANGE_RATE) {
    context.addIssue({ code: 'custom', path: ['exchangeRate'], message: 'Exchange rate must be positive' })
  }
})

/**
 * The form's first values: the record's, or the legacy create defaults. A stored 0 decimals stays 0 (the
 * legacy `decimals || 2` showed 2 and saved it back).
 */
export function currencyFormValues(currency?: Currency): CurrencyFormValues {
  return {
    code: currency?.code || '',
    name: currency?.name || '',
    symbol: currency?.symbol || '',
    decimals: currency ? currency.decimals ?? 2 : 2,
    exchangeRate: currency?.exchangeRate || null,
    isActive: currency?.isActive ?? true,
  }
}

/** Upper-cases the code as it is typed (the legacy `normalize`). */
export function normaliseCurrencyCode(value: string): string {
  return value.toUpperCase()
}

/**
 * The legacy submit: the mounted fields in order, the code upper-cased. Create has no Active Status control,
 * so `isActive` is not sent. An empty rate is left out, except when a stored rate was cleared: then it is
 * sent as `null`, as the cleared antd InputNumber sent it, so clearing a stored rate cannot pass as a save.
 * A rate is sent at six places: the legacy InputNumber rounded it on Enter as well as on blur, while the kit
 * NumberField rounds only on blur, so a rate typed as 1.1234567 and submitted with Enter would otherwise be
 * sent unrounded.
 */
export function buildCurrencyInput(
  values: CurrencyFormValues,
  currency?: Currency,
): CreateCurrencyInput | UpdateCurrencyInput {
  const input: Record<string, unknown> = {
    code: normaliseCurrencyCode(values.code),
    name: values.name,
    symbol: values.symbol,
    decimals: values.decimals,
  }
  if (values.exchangeRate !== null) {
    input.exchangeRate = Number(values.exchangeRate.toFixed(EXCHANGE_RATE_PRECISION))
  } else if (currency?.exchangeRate) {
    input.exchangeRate = null
  }
  if (currency) input.isActive = values.isActive
  return input as unknown as CreateCurrencyInput | UpdateCurrencyInput
}

/* ---------- converter ---------- */

export interface ConversionPair {
  from: string
  to: string
}

/** USD to INR when both exist, else the first two currencies, else nothing (the legacy effect). */
export function defaultConversionPair(currencies: readonly Currency[]): ConversionPair | null {
  const usd = currencies.find((c) => c.code === 'USD')
  const inr = currencies.find((c) => c.code === 'INR')
  if (usd && inr) return { from: 'USD', to: 'INR' }
  if (currencies.length >= 2) return { from: currencies[0].code, to: currencies[1].code }
  return null
}

/** Every currency, active or not, as `CODE - Name` (the legacy option text). */
export function converterOptions(currencies: readonly Currency[]): Array<{ value: string; label: string }> {
  return currencies.map((currency) => ({ value: currency.code, label: `${currency.code} - ${currency.name}` }))
}

export function canConvert(amount: number, from: string, to: string): boolean {
  return amount > 0 && Boolean(from) && Boolean(to) && from !== to
}

/** The legacy warnings, in their order; null when a conversion can run. */
export function conversionWarning(amount: number, from: string, to: string): string | null {
  if (!amount || !from || !to) return 'Please enter amount and select both currencies'
  if (from === to) return 'Please select different currencies for conversion'
  return null
}

/** The currency's own decimals, or two for an unknown code (the legacy formatAmount). */
export function formatConvertedAmount(value: number, code: string, currencies: readonly Currency[]): string {
  const currencyInfo = currencies.find((c) => c.code === code)
  if (!currencyInfo) return value.toFixed(2)
  return value.toFixed(currencyInfo.decimals)
}

export function currencySymbol(code: string, currencies: readonly Currency[]): string | undefined {
  return currencies.find((c) => c.code === code)?.symbol
}

export function rateLine(from: string, rate: number, to: string): string {
  return `1 ${from} = ${rate.toFixed(6)} ${to}`
}

/* ---------- default display currency (settings) ---------- */

/** The key CurrencyContext reads app-wide; it is written here and nowhere else. */
export const DEFAULT_CURRENCY_STORAGE_KEY = 'defaultCurrency'
export const FALLBACK_DEFAULT_CURRENCY = 'INR'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** The stored default, or INR. Blocked or failing storage reads as nothing stored. */
export function readDefaultCurrency(storage: StorageLike | null = browserStorage()): string {
  try {
    return storage?.getItem(DEFAULT_CURRENCY_STORAGE_KEY) || FALLBACK_DEFAULT_CURRENCY
  } catch {
    return FALLBACK_DEFAULT_CURRENCY
  }
}

/** Stores the default; false when storage refused it. */
export function storeDefaultCurrency(code: string, storage: StorageLike | null = browserStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(DEFAULT_CURRENCY_STORAGE_KEY, code)
    return true
  } catch {
    return false
  }
}

/**
 * The active currencies as `symbol CODE - Name`. A stored default with no active currency behind it keeps
 * its raw code as an option, as antd showed an unmatched value, instead of a blank select.
 */
export function defaultCurrencyOptions(
  activeCurrencies: readonly Currency[],
  defaultCurrency: string,
): Array<{ value: string; label: string }> {
  const options = activeCurrencies.map((currency) => ({
    value: currency.code,
    label: `${currency.symbol} ${currency.code} - ${currency.name}`,
  }))
  if (defaultCurrency && !options.some((option) => option.value === defaultCurrency)) {
    options.unshift({ value: defaultCurrency, label: defaultCurrency })
  }
  return options
}

export function defaultCurrencySymbol(activeCurrencies: readonly Currency[], defaultCurrency: string): string | undefined {
  return activeCurrencies.find((c) => c.code === defaultCurrency)?.symbol
}
