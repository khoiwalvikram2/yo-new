/* Pure logic of /matka/results, kept out of the components so it can be tested without React or Apollo.
   Every string here is the legacy page's copy, word for word; every rule is the legacy rule, including
   the quirks the record reports (the pending-bets fallback name, the untrimmed filter count). */
import type { MatkaResult, MatkaResultFilters } from '@/modules/matka/results'

/** A matka as the shared `Matkas` list returns it; only these fields are read on this page. */
export interface MatkaOption {
  id: string
  name: string
  code: string
}

export type MatkaResultType = 'open' | 'close'

// ---------------------------------------------------------------------------------------------------
// Filters and the list query
// ---------------------------------------------------------------------------------------------------

export const MATKA_RESULT_PAGE_SIZES = [10, 20, 50, 100] as const

/** The page's initial filters, and what Clear All returns to (page size included, as before). */
export function defaultMatkaResultFilters(): MatkaResultFilters {
  return { page: 1, limit: 20, sort: 'createdAt:desc' }
}

/** The `filters` variable of `MatkaResults`, keys in the legacy order; search is sent from two trimmed
 *  characters, otherwise left out. */
export function buildMatkaResultsVariables(filters: MatkaResultFilters): MatkaResultFilters {
  return {
    matkaId: filters.matkaId,
    type: filters.type,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    search: filters.search && filters.search.trim().length >= 2 ? filters.search.trim() : undefined,
    rolledBack: filters.rolledBack,
    page: filters.page || 1,
    limit: filters.limit || 20,
    sort: filters.sort || 'createdAt:desc',
  }
}

/** Search, market, type, date and status each count once; the search counts as soon as it has a
 *  character, though the query ignores it below two (legacy). */
export function countActiveMatkaResultFilters(filters: MatkaResultFilters): number {
  return [
    filters.search,
    filters.matkaId,
    filters.type,
    filters.dateFrom,
    filters.rolledBack !== undefined,
  ].filter(Boolean).length
}

/** Any filter change returns to page 1. */
export function withMatkaResultFilter(
  filters: MatkaResultFilters,
  patch: Partial<MatkaResultFilters>,
): MatkaResultFilters {
  return { ...filters, ...patch, page: 1 }
}

export const MATKA_RESULT_TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'open', label: 'Open' },
  { value: 'close', label: 'Close' },
] as const

export function typeFilterFromValue(value: string): MatkaResultType | undefined {
  return value === 'open' || value === 'close' ? value : undefined
}

export const MATKA_RESULT_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'rolledBack', label: 'Rolled Back' },
] as const

export function statusFilterValue(rolledBack: boolean | undefined): '' | 'active' | 'rolledBack' {
  if (rolledBack === undefined) return ''
  return rolledBack ? 'rolledBack' : 'active'
}

/** Rolled Back sends `rolledBack: true`, Active `false`; All Status removes the key, as the legacy
 *  clear did. */
export function applyStatusFilter(filters: MatkaResultFilters, value: string): MatkaResultFilters {
  if (value === 'rolledBack') return { ...filters, rolledBack: true, page: 1 }
  if (value === 'active') return { ...filters, rolledBack: false, page: 1 }
  const rest: MatkaResultFilters = { ...filters, page: 1 }
  delete rest.rolledBack
  return rest
}

/** The legacy date filter was a bare range picker whose cleared state meant every date; the kit field
 *  gives that state a name. */
export const MATKA_RESULT_DATE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom range' },
] as const

export function matkaResultDatePreset(filters: MatkaResultFilters): 'all' | 'custom' {
  return filters.dateFrom && filters.dateTo ? 'custom' : 'all'
}

export type MatkaResultDateApply =
  | { kind: 'preset'; preset: string }
  | { kind: 'custom'; from: string; to: string }

/** A custom range sends its two calendar days as picked (`yyyy-MM-dd`); All dates clears both. */
export function applyMatkaResultDateRange(
  filters: MatkaResultFilters,
  payload: MatkaResultDateApply,
): MatkaResultFilters {
  if (payload.kind === 'custom' && payload.from && payload.to) {
    return { ...filters, dateFrom: payload.from, dateTo: payload.to, page: 1 }
  }
  return { ...filters, dateFrom: undefined, dateTo: undefined, page: 1 }
}

// ---------------------------------------------------------------------------------------------------
// Matkas
// ---------------------------------------------------------------------------------------------------

export function matkaOptionsFrom(items: unknown): MatkaOption[] {
  return Array.isArray(items) ? (items as MatkaOption[]) : []
}

/** `Name (CODE)`: the label the market pickers list and filter on. */
export function matkaOptionLabel(matka: MatkaOption): string {
  return `${matka.name} (${matka.code})`
}

export function matkaListboxOptions(matkas: readonly MatkaOption[]) {
  return matkas.map((matka) => ({ value: matka.id, label: matkaOptionLabel(matka) }))
}

/** The table shows the matka's name, or its raw id when the list does not hold it. */
export function matkaNameFor(result: Pick<MatkaResult, 'matkaId'>, matkas: readonly MatkaOption[]): string {
  const matka = matkas.find((item) => item.id === result.matkaId)
  return matka ? matka.name : result.matkaId
}

// ---------------------------------------------------------------------------------------------------
// Pending bets
// ---------------------------------------------------------------------------------------------------

export interface PendingBetsSummary {
  count: number
  totalBets: number
  results: MatkaResult[]
}

export function summarizePendingBets(results: readonly MatkaResult[]): PendingBetsSummary {
  const resultsWithBets = results.filter((r) => (r.pendingBetsCount || 0) > 0)
  const totalPendingBets = results.reduce((sum, r) => sum + (r.pendingBetsCount || 0), 0)
  return { count: resultsWithBets.length, totalBets: totalPendingBets, results: resultsWithBets }
}

const plural = (count: number, word: string) => `${word}${count > 1 ? 's' : ''}`

export function pendingBetsTitle(totalBets: number): string {
  return `${totalBets} pending ${plural(totalBets, 'bet')} waiting for settlement`
}

export function pendingBetsAcross(count: number): string {
  return `across ${count} ${plural(count, 'result')}`
}

/** The first three results with pending bets, comma-separated, then ` and N more...`. An unknown matka
 *  falls back to the result's date (legacy, so such an entry reads `<date> - <date> (…)`). */
export function pendingBetsDescription(summary: PendingBetsSummary, matkas: readonly MatkaOption[]): string {
  const shown = summary.results.slice(0, 3).map((r, idx) => {
    const matka = matkas.find((m) => m.id === r.matkaId)
    const matkaName = matka ? matkaOptionLabel(matka) : r.date
    const count = r.pendingBetsCount ?? 0
    const separator = idx < Math.min(2, summary.results.length - 1) ? ', ' : ''
    return `${matkaName} - ${r.date} (${count} ${plural(count, 'bet')})${separator}`
  })
  const more = summary.results.length > 3 ? ` and ${summary.results.length - 3} more...` : ''
  return `${shown.join('')}${more}`
}

export function pendingBetsCountLabel(count: number): string {
  return `${count} ${plural(count, 'bet')}`
}

export function pendingBetsWaitingHint(count: number): string {
  return `${count} pending ${plural(count, 'bet')} waiting for result`
}

export function pendingBetsSettlementHint(count: number): string {
  return `${count} pending ${plural(count, 'bet')} need settlement`
}

// ---------------------------------------------------------------------------------------------------
// Statistics (the first 1,000 results, independent of the filters)
// ---------------------------------------------------------------------------------------------------

export interface MatkaResultStats {
  total: number
  today: number
  open: number
  close: number
  rolledBack: number
}

export function computeMatkaResultStats(results: readonly MatkaResult[], todayIst: string): MatkaResultStats {
  return {
    total: results.length,
    today: results.filter((r) => r.date === todayIst).length,
    open: results.filter((r) => r.type === 'open' && !r.rolledBackAt).length,
    close: results.filter((r) => r.type === 'close' && !r.rolledBackAt).length,
    rolledBack: results.filter((r) => r.rolledBackAt).length,
  }
}

export interface MatkaResultStatCard {
  key: 'total' | 'open' | 'close' | 'rolledBack'
  label: string
  value: string | number
  note: string
}

export function matkaResultStatCards(stats: MatkaResultStats): MatkaResultStatCard[] {
  return [
    { key: 'total', label: 'Total Results', value: stats.total.toLocaleString(), note: `${stats.today} today` },
    { key: 'open', label: 'Open Results', value: stats.open, note: `${stats.open - stats.close} pending close` },
    {
      key: 'close',
      label: 'Closed Results',
      value: stats.close,
      note: stats.open > 0 ? `${Math.round((stats.close / stats.open) * 100)}% completion` : '—',
    },
    {
      key: 'rolledBack',
      label: 'Rolled Back',
      value: stats.rolledBack,
      note: stats.total > 0 ? `${Math.round((stats.rolledBack / stats.total) * 100)}%` : '—',
    },
  ]
}

// ---------------------------------------------------------------------------------------------------
// Table rows
// ---------------------------------------------------------------------------------------------------

export type MatkaResultTone = 'ok' | 'neg' | 'info'

/** Rolled Back (was antd's red dot), Open (green) and Closed (blue), on the approved tones. */
export function matkaResultStatus(result: Pick<MatkaResult, 'rolledBackAt' | 'type'>): {
  label: string
  tone: MatkaResultTone
} {
  if (result.rolledBackAt) return { label: 'Rolled Back', tone: 'neg' }
  if (result.type === 'open') return { label: 'Open', tone: 'ok' }
  return { label: 'Closed', tone: 'info' }
}

export function matkaResultTypeLabel(type: string): 'OPEN' | 'CLOSE' {
  return type === 'open' ? 'OPEN' : 'CLOSE'
}

/** Declared within the last hour (the legacy green dot); an unreadable time is never recent. */
export function isRecentDeclaration(declaredAt: string | null | undefined, nowMs: number): boolean {
  if (!declaredAt) return false
  const at = new Date(declaredAt).getTime()
  return Number.isFinite(at) && at > nowMs - 60 * 60 * 1000
}

export function rollbackActionLabel(result: Pick<MatkaResult, 'date' | 'type'>, matkaName: string): string {
  return `Rollback ${matkaName} ${result.date} ${matkaResultTypeLabel(result.type)} result`
}

export function resultCountLabel(fetching: boolean, count: number): string {
  if (fetching) return 'Loading...'
  return `${count} ${count === 1 ? 'result' : 'results'}`
}

// ---------------------------------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------------------------------

export const ROLLBACK_CONFIRM_WORD = 'ROLLBACK'

export const ROLLBACK_TAG_OPTIONS = [
  { value: 'error', label: 'Error' },
  { value: 'correction', label: 'Correction' },
  { value: 'fraud', label: 'Fraud' },
  { value: 'other', label: 'Other' },
] as const

/** antd's `required` rule: an empty reason fails; whitespace counts as a reason (no `whitespace` rule). */
export function rollbackReasonError(reason: string): string | undefined {
  return reason === '' ? 'Please provide a reason for rollback' : undefined
}

export function canConfirmRollback(confirmText: string): boolean {
  return confirmText === ROLLBACK_CONFIRM_WORD
}

export function buildRollbackInput(id: string, reason: string, tag?: string) {
  return { id, reason, tag }
}

/** The four facts above the form; the market is the raw id, the type upper-cased (legacy). */
export function rollbackFacts(result: Pick<MatkaResult, 'matkaId' | 'date' | 'type' | 'result'>) {
  return [
    { key: 'market', term: 'Market', value: result.matkaId },
    { key: 'date', term: 'Date', value: result.date },
    { key: 'type', term: 'Type', value: result.type.toUpperCase() },
    { key: 'result', term: 'Result', value: result.result },
  ]
}

// ---------------------------------------------------------------------------------------------------
// Declare Result
// ---------------------------------------------------------------------------------------------------

export interface DeclareResultValues {
  matkaId: string
  /** `yyyy-MM-dd`, or '' when the field was cleared. */
  date: string
  type: MatkaResultType
  result: string
}

export type DeclareResultField = keyof DeclareResultValues

export const DECLARE_FIELD_ORDER: readonly DeclareResultField[] = ['matkaId', 'date', 'type', 'result']

export const DECLARE_TYPE_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'close', label: 'Close' },
] as const

export const RESULT_PATTERN = /^\d{2,3}$/

export function initialDeclareValues(todayIst: string): DeclareResultValues {
  return { matkaId: '', date: todayIst, type: 'open', result: '' }
}

/** Digits only, as typed (the field also caps the length at three). */
export function sanitizeResultInput(text: string): string {
  return text.replace(/\D/g, '')
}

/** The legacy picker refused days after today (IST); a typed later day is not taken. */
export function acceptDeclareDate(value: string, maxDay: string): boolean {
  return value === '' || value <= maxDay
}

export function declareFieldError(field: DeclareResultField, values: DeclareResultValues): string | undefined {
  switch (field) {
    case 'matkaId':
      return values.matkaId ? undefined : 'Please select a market'
    case 'date':
      return values.date ? undefined : 'Please select a date'
    case 'type':
      return values.type ? undefined : 'Please select type'
    case 'result':
      if (!values.result) return 'Please enter result'
      return RESULT_PATTERN.test(values.result) ? undefined : 'Result must be 2 or 3 digits (00-99 or 000-999)'
  }
}

export function validateDeclareResult(values: DeclareResultValues): Partial<Record<DeclareResultField, string>> {
  const errors: Partial<Record<DeclareResultField, string>> = {}
  for (const field of DECLARE_FIELD_ORDER) {
    const error = declareFieldError(field, values)
    if (error) errors[field] = error
  }
  return errors
}

/** Close needs an open result for the same market and day. */
export function canSubmitDeclare(type: MatkaResultType, openResultExists: boolean): boolean {
  return !(type === 'close' && !openResultExists)
}

export interface AutoTypeInput {
  hasOpen: boolean
  type: MatkaResultType
  matkaId: string | undefined
  date: string | undefined
  existsLoading: boolean
  existsKnown: boolean
  typeManuallyChanged: boolean
}

/** Once the existence check for the chosen market and day has answered, the type follows it — Close
 *  when an open result exists, Open when it does not — unless the type was chosen by hand. */
export function autoDeclareType(input: AutoTypeInput): MatkaResultType | null {
  if (!input.matkaId || !input.date || input.existsLoading || !input.existsKnown || input.typeManuallyChanged) {
    return null
  }
  if (input.hasOpen && input.type === 'open') return 'close'
  if (!input.hasOpen && input.type === 'close') return 'open'
  return null
}

export function buildCreateMatkaResultInput(values: DeclareResultValues) {
  return { matkaId: values.matkaId, date: values.date, type: values.type, result: values.result }
}

export function declarePreviewText(type: MatkaResultType, date: string): string {
  return `This will be the ${type} result for ${date}`
}

/** The notice under Type while Close is chosen. */
export function closeTypeNotice(openResultExists: boolean, existsLoading: boolean): {
  tone: 'ok' | 'info' | 'warn'
  title: string
  body: string
} {
  if (openResultExists) {
    return {
      tone: 'ok',
      title: 'Open result found',
      body: 'Open result exists for the selected market/date. You can safely declare the close result.',
    }
  }
  if (existsLoading) {
    return {
      tone: 'info',
      title: 'Validating open result…',
      body: 'Checking the server for an open result for this date/market.',
    }
  }
  return {
    tone: 'warn',
    title: 'Open result required',
    body: 'Cannot declare close result until open result is declared for this date/market.',
  }
}
