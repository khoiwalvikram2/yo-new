import { formatDistanceToNow } from 'date-fns'

/* The /notifications/:id page's logic, kept out of React so it can be pinned by unit tests. Every rule is
   the legacy NotificationDetailPage.tsx rule moved as it was (page migration C, Task 108); the line it
   came from is named beside it. */

/** One row of `myNotifications` (lib/graphql/notifications.ts). */
export interface NotificationDetailItem {
  id: string | number
  type?: string | null
  category?: string | null
  title?: string | null
  message?: string | null
  metadata?: unknown
  isRead?: boolean | null
  actionUrl?: string | null
  createdAt?: string | Date | null
}

/** The legacy lookup (:44): the first row whose id is the route id, compared strictly. */
export function findNotificationById<T extends NotificationDetailItem>(
  rows: readonly T[] | null | undefined,
  id: string | undefined,
): T | undefined {
  return rows?.find((n) => n.id === id)
}

/** The legacy createdAt (:84-88): a Date as it is, a string parsed, and now when there is none. */
export function notificationCreatedAt(value: string | Date | null | undefined, now: Date = new Date()): Date {
  if (!value) return now
  return value instanceof Date ? value : new Date(value)
}

export function isValidDate(date: Date): boolean {
  return !isNaN(date.getTime())
}

export type FormatDateTime = (date: Date, format: string) => string

/** `dd MMM yyyy, HH:mm:ss` in the tenant zone, or `Invalid date` (legacy :150). */
export function createdAtLabel(createdAt: Date, formatDateTime: FormatDateTime): string {
  return isValidDate(createdAt) ? formatDateTime(createdAt, 'dd MMM yyyy, HH:mm:ss') : 'Invalid date'
}

/** `(5 minutes ago)`, or null for an invalid date (legacy :152-156). */
export function createdAtRelative(createdAt: Date): string | null {
  return isValidDate(createdAt) ? `(${formatDistanceToNow(createdAt, { addSuffix: true })})` : null
}

/** A decorative hue on the mockup's ramp; the tag's text carries the meaning. */
export type TagHue = 'grn' | 'amb' | 'blu' | 'vio' | 'ind' | 'red' | 'neutral'

/** The legacy typeColors (:96-105, antd preset colours) on the nearest decorative hue: green and lime
 *  grn, orange and gold amb, blue blu, purple vio, cyan ind, magenta red. Exact-case keys, as before. */
const HUE_BY_TYPE: Readonly<Record<string, TagHue>> = {
  DEPOSIT: 'grn',
  WITHDRAWAL: 'amb',
  KYC: 'blu',
  SYSTEM: 'vio',
  AGENT: 'ind',
  PLAYER: 'red',
  SETTLEMENT: 'amb',
  COMMISSION: 'grn',
}

export function notificationTypeHue(type: string | null | undefined): TagHue {
  return (type && HUE_BY_TYPE[type]) || 'neutral'
}

/** The category tag (legacy :130-132): Task in orange, anything else General in blue. */
export function notificationCategoryTag(category: string | null | undefined): { label: 'Task' | 'General'; hue: TagHue } {
  return category === 'task' ? { label: 'Task', hue: 'amb' } : { label: 'General', hue: 'blu' }
}

export function isMetadataObject(metadata: unknown): metadata is Record<string, unknown> {
  return Boolean(metadata) && typeof metadata === 'object'
}

export interface MetadataLine {
  key: string
  label: string
  value: string
}

export type FormatAmount = (amount: number) => string

/** The amount line (legacy :178-180): a number through formatAmount, anything else as sent, then the
 *  currency code or nothing. */
export function metadataAmountText(amount: unknown, currency: unknown, formatAmount: FormatAmount): string {
  const shown = typeof amount === 'number' ? formatAmount(amount) : String(amount)
  return `${shown} ${currency ? String(currency) : ''}`
}

/** The Details lines (legacy :162-183): User, Phone unless `N/A`, Amount, each only when present. */
export function notificationMetadataLines(metadata: Record<string, unknown>, formatAmount: FormatAmount): MetadataLine[] {
  const lines: MetadataLine[] = []
  if (metadata.userName) lines.push({ key: 'user', label: 'User:', value: String(metadata.userName) })
  if (metadata.userPhone && metadata.userPhone !== 'N/A') {
    lines.push({ key: 'phone', label: 'Phone:', value: String(metadata.userPhone) })
  }
  if (metadata.amount) {
    lines.push({ key: 'amount', label: 'Amount:', value: metadataAmountText(metadata.amount, metadata.currency, formatAmount) })
  }
  return lines
}

const KNOWN_METADATA_KEYS = ['userName', 'userPhone', 'amount', 'currency']

/** "Show all metadata" appears when the metadata holds any key beyond the ones listed (legacy :184). */
export function hasExtraMetadata(metadata: Record<string, unknown>): boolean {
  return Object.keys(metadata).some((key) => !KNOWN_METADATA_KEYS.includes(key))
}

export function metadataJson(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, null, 2)
}

/** The text of the error notice shown when the lookup failed and the notification cannot be shown. */
export function notificationDetailErrorText(error: { message?: string } | null | undefined): string {
  const message = error?.message?.trim()
  return message ? `Failed to load notification: ${message}` : 'Failed to load notification'
}
