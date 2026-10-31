/* The logic of /promotions/content (page migration Task 111), kept React-free so it is tested on its
   own. Every rule here is the legacy page's, written down: the cell texts, the exact mutation
   variables and the "mutate, then refetch" order of each action. It deliberately shares no file with
   the Campaigns page, so each page stays its own task's to change. */

/** One row of `content` as the page's list document selects it. */
export interface ContentRow {
  id: string
  name: string
  locale: string
  body: string
  status: string
  updatedAt?: string | null
}

export interface ContentQueryData {
  content?: ContentRow[] | null
}

/** The new block's fields. */
export interface ContentDraft {
  name: string
  locale: string
  body: string
}

/** The values the create fields start with, as before. */
export const DEFAULT_CONTENT_DRAFT: Readonly<ContentDraft> = { name: 'New Block', locale: 'en', body: '' }

/** A missing date prints an em dash, as before. */
export const EMPTY_VALUE = '—'

export type DateFormatter = (value: string) => string

/** `data?.content ?? []`: rows in the server's order, nothing filtered or sorted. */
export function contentRows(data: ContentQueryData | null | undefined): ContentRow[] {
  return data?.content ?? []
}

/** The Updated cell: date and time, or an em dash. */
export function updatedLabel(updatedAt: string | null | undefined, formatDateTime: DateFormatter): string {
  return updatedAt ? formatDateTime(updatedAt) : EMPTY_VALUE
}

/** CreateContent's variables: the three fields exactly as typed, none trimmed or required, as before. */
export function createContentVariables(draft: ContentDraft): { input: ContentDraft } {
  return { input: { name: draft.name, locale: draft.locale, body: draft.body } }
}

/**
 * UpdateContent's variables. The legacy Update button re-sent the row's own id, name and body (no
 * locale) and nothing the user typed; that is kept exactly.
 */
export function updateContentVariables(
  row: Pick<ContentRow, 'id' | 'name' | 'body'>,
): { input: { id: string; name: string; body: string } } {
  return { input: { id: row.id, name: row.name, body: row.body } }
}

/** PublishContent's variables. */
export function publishContentVariables(id: string): { id: string } {
  return { id }
}

export type ContentAction = 'create' | 'update' | 'publish'

/** The key a busy action is tracked by: one per button, so different rows stay independent. */
export function actionKey(action: ContentAction, id?: string): string {
  return id === undefined ? action : `${action}:${id}`
}

/** A row button's accessible name keeps its visible verb and adds which block it acts on. */
export function rowActionLabel(verb: 'Update' | 'Publish', row: Pick<ContentRow, 'id' | 'name'>): string {
  const name = row.name.trim()
  return name ? `${verb} ${name}` : `${verb} content ${row.id}`
}

/** BEYOND-LEGACY copy: the old page raised nothing when one of these mutations failed. */
export const CONTENT_FAILURE_MESSAGES: Readonly<Record<ContentAction, string>> = {
  create: 'Failed to create content',
  update: 'Failed to update content',
  publish: 'Failed to publish content',
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
