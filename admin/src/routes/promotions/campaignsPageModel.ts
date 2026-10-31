/* The logic of /promotions/campaigns (page migration Task 110), kept React-free so it is tested on
   its own. Every rule here is the legacy page's, written down: the cell texts, the exact mutation
   variables and the "mutate, then refetch" order of each action. */

/** One row of `promotions` as the page's list document selects it. */
export interface PromotionRow {
  id: string
  name: string
  status: string
  updatedAt?: string | null
  scheduleStart?: string | null
  scheduleEnd?: string | null
}

export interface PromotionsQueryData {
  promotions?: PromotionRow[] | null
}

/** The value the name field starts with, as before. */
export const DEFAULT_CAMPAIGN_NAME = 'New Campaign'

/** A missing date prints an em dash, as before. */
export const EMPTY_VALUE = '—'

export type DateFormatter = (value: string) => string

/** `data?.promotions ?? []`: rows in the server's order, nothing filtered or sorted. */
export function promotionRows(data: PromotionsQueryData | null | undefined): PromotionRow[] {
  return data?.promotions ?? []
}

/** `start – end`, each side formatted as a day or an em dash. */
export function scheduleLabel(
  row: Pick<PromotionRow, 'scheduleStart' | 'scheduleEnd'>,
  formatDate: DateFormatter,
): string {
  const start = row.scheduleStart ? formatDate(row.scheduleStart) : EMPTY_VALUE
  const end = row.scheduleEnd ? formatDate(row.scheduleEnd) : EMPTY_VALUE
  return `${start} – ${end}`
}

/** The Updated cell: date and time, or an em dash. */
export function updatedLabel(updatedAt: string | null | undefined, formatDateTime: DateFormatter): string {
  return updatedAt ? formatDateTime(updatedAt) : EMPTY_VALUE
}

/** CreatePromotion's variables: the name exactly as typed. It is neither trimmed nor required, as before. */
export function createPromotionVariables(name: string): { input: { name: string } } {
  return { input: { name } }
}

/** PublishPromotion's and PausePromotion's variables. */
export function promotionIdVariables(id: string): { id: string } {
  return { id }
}

export type CampaignAction = 'create' | 'publish' | 'pause'

/** The key a busy action is tracked by: one per button, so different rows stay independent. */
export function actionKey(action: CampaignAction, id?: string): string {
  return id === undefined ? action : `${action}:${id}`
}

/** A row button's accessible name keeps its visible verb and adds which campaign it acts on. */
export function rowActionLabel(verb: 'Publish' | 'Pause', row: Pick<PromotionRow, 'id' | 'name'>): string {
  const name = row.name.trim()
  return name ? `${verb} ${name}` : `${verb} campaign ${row.id}`
}

/** BEYOND-LEGACY copy: the old page raised nothing when one of these mutations failed. */
export const CAMPAIGN_FAILURE_MESSAGES: Readonly<Record<CampaignAction, string>> = {
  create: 'Failed to create campaign',
  publish: 'Failed to publish campaign',
  pause: 'Failed to pause campaign',
}

/** The server's message when there is one, otherwise the action's fallback. */
export function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

export type ActionOutcome = { ok: true } | { ok: false; message: string }

/**
 * The legacy handler was `await mutate(); await refetch()`. The order is kept: a rejected mutation
 * skips the refetch and reports its message. A refetch that fails is left to the Apollo error link,
 * which already raises query failures, so it never rejects here (it used to escape as an unhandled
 * rejection).
 */
export async function runThenRefetch(
  mutate: () => Promise<unknown>,
  refetch: () => Promise<unknown>,
  fallback: string,
): Promise<ActionOutcome> {
  try {
    await mutate()
  } catch (error) {
    return { ok: false, message: failureMessage(error, fallback) }
  }
  try {
    await refetch()
  } catch {
    // Reported by the Apollo error link; nothing to add here.
  }
  return { ok: true }
}

export type ListState = 'ready' | 'loading' | 'error'

/** The table's state: an error wins (it shows beside any rows still held), then the first load. */
export function listState(loading: boolean, error: unknown): ListState {
  if (error) return 'error'
  return loading ? 'loading' : 'ready'
}
