/* Pure helpers for /matka/:id (routes/matka/ViewPage.tsx): which status action the header offers and
 * what it sends, the clone variables, the fact rows, the three JSON blocks and the failed-load copy.
 * React-free, so the legacy behaviour they carry is tested on its own. */

/** The fields of MATKA_QUERY the page reads (the query also returns description, visibility, createdAt
 *  and deletedAt, which the page never showed). */
export interface MatkaDetail {
  id: string
  name: string
  code: string
  timezone?: string | null
  schedule?: unknown
  status?: string | null
  limits?: unknown
  priority?: number | null
  settings?: unknown
  updatedAt?: string | null
}

export type MatkaStatusTarget = 'ACTIVE' | 'PAUSED'

export interface MatkaStatusAction {
  label: 'Activate' | 'Pause'
  toStatus: MatkaStatusTarget
  variant: 'primary' | 'secondary'
}

/**
 * Legacy: `Activate` (primary) for any status other than ACTIVE, `Pause` (default button) for ACTIVE.
 * Pause sends `PAUSED`, which is not a value of the server's MatkaStatus enum (ACTIVE, INACTIVE, SUSPEND):
 * the server refuses the variable, so Pause has never worked. It is kept as sent (a UI migration does not
 * change an operation's variables) and reported for the owner.
 */
export function matkaStatusAction(status: string | null | undefined): MatkaStatusAction {
  return status === 'ACTIVE'
    ? { label: 'Pause', toStatus: 'PAUSED', variant: 'secondary' }
    : { label: 'Activate', toStatus: 'ACTIVE', variant: 'primary' }
}

export function matkaStatusVariables(id: string, toStatus: MatkaStatusTarget): { id: string; toStatus: MatkaStatusTarget } {
  return { id, toStatus }
}

/** Clone keeps the legacy naming: `<name> Copy` and `<code>-copy`. */
export function cloneMatkaVariables(matka: Pick<MatkaDetail, 'id' | 'name' | 'code'>): {
  id: string
  name: string
  code: string
} {
  return { id: matka.id, name: `${matka.name} Copy`, code: `${matka.code}-copy` }
}

/** What React printed for a raw value: nothing for null/undefined, the text otherwise (0 included). */
export function matkaText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

export type MatkaFactKey = 'code' | 'status' | 'timezone' | 'priority' | 'updated'

export interface MatkaFact {
  key: MatkaFactKey
  term: string
  value: string
}

/** The short facts in legacy order; `Updated` (the last cell of the old grid) joins them, above the JSON. */
export function matkaFacts(matka: MatkaDetail): MatkaFact[] {
  return [
    { key: 'code', term: 'Code', value: matkaText(matka.code) },
    { key: 'status', term: 'Status', value: matkaText(matka.status) },
    { key: 'timezone', term: 'Timezone', value: matkaText(matka.timezone) },
    { key: 'priority', term: 'Priority', value: matkaText(matka.priority) },
    { key: 'updated', term: 'Updated', value: matkaText(matka.updatedAt) },
  ]
}

/** `JSON.stringify(value, null, 2)` as the legacy `<pre>` printed it; a missing value printed nothing. */
export function matkaJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? ''
}

export interface MatkaJsonBlock {
  key: 'schedule' | 'limits' | 'settings'
  label: 'Schedule' | 'Limits' | 'Settings'
  code: string
}

export function matkaJsonBlocks(matka: MatkaDetail): MatkaJsonBlock[] {
  return [
    { key: 'schedule', label: 'Schedule', code: matkaJson(matka.schedule) },
    { key: 'limits', label: 'Limits', code: matkaJson(matka.limits) },
    { key: 'settings', label: 'Settings', code: matkaJson(matka.settings) },
  ]
}

/** The breadcrumb label of `/matka/:id` (shared/core/routeConfig.ts), the h1 while there is no matka. */
export const MATKA_DETAILS_TITLE = 'Matka Details'

export function matkaLoadErrorText(error: { message?: string } | null | undefined): string {
  const message = error?.message?.trim()
  return message ? `Failed to load matka: ${message}` : 'Failed to load matka'
}
