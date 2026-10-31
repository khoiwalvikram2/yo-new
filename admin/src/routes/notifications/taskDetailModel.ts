import { formatDistanceToNow } from 'date-fns'

/* The /notifications/tasks/:id page's logic, kept out of React so it can be pinned by unit tests. Every
   rule is the legacy TaskDetailPage.tsx rule moved as it was (page migration C, Task 109); the line it
   came from is named beside it. It deliberately repeats the few helpers it shares with
   notificationDetailModel.ts rather than importing them, so each page owns its own files. */

/** One task row of `myNotifications` (lib/graphql/notifications.ts). */
export interface TaskDetailItem {
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

/** The legacy lookup (:45): the first row whose id is the route id, compared strictly. */
export function findTaskById<T extends TaskDetailItem>(rows: readonly T[] | null | undefined, id: string | undefined): T | undefined {
  return rows?.find((n) => n.id === id)
}

/** The legacy createdAt (:85-89): a Date as it is, a string parsed, and now when there is none. */
export function taskCreatedAt(value: string | Date | null | undefined, now: Date = new Date()): Date {
  if (!value) return now
  return value instanceof Date ? value : new Date(value)
}

export function isValidDate(date: Date): boolean {
  return !isNaN(date.getTime())
}

export type FormatDateTime = (date: Date, format: string) => string

/** `dd MMM yyyy, HH:mm:ss` in the tenant zone, or `Invalid date` (legacy :113, :173). */
export function taskCreatedAtLabel(createdAt: Date, formatDateTime: FormatDateTime): string {
  return isValidDate(createdAt) ? formatDateTime(createdAt, 'dd MMM yyyy, HH:mm:ss') : 'Invalid date'
}

/** `(5 minutes ago)`, or null for an invalid date (legacy :175-179). */
export function taskCreatedAtRelative(createdAt: Date): string | null {
  return isValidDate(createdAt) ? `(${formatDistanceToNow(createdAt, { addSuffix: true })})` : null
}

/** A decorative hue on the mockup's ramp; the tag's text carries the meaning. */
export type TaskTagHue = 'grn' | 'amb' | 'blu' | 'vio' | 'ind' | 'red' | 'neutral'

/** The legacy typeColors (:95-104, antd preset colours) on the nearest decorative hue, as on the
 *  notification page: green and lime grn, orange and gold amb, blue blu, purple vio, cyan ind, magenta red. */
const HUE_BY_TYPE: Readonly<Record<string, TaskTagHue>> = {
  DEPOSIT: 'grn',
  WITHDRAWAL: 'amb',
  KYC: 'blu',
  SYSTEM: 'vio',
  AGENT: 'ind',
  PLAYER: 'red',
  SETTLEMENT: 'amb',
  COMMISSION: 'grn',
}

export function taskTypeHue(type: string | null | undefined): TaskTagHue {
  return (type && HUE_BY_TYPE[type]) || 'neutral'
}

export function isMetadataObject(metadata: unknown): metadata is Record<string, unknown> {
  return Boolean(metadata) && typeof metadata === 'object'
}

/**
 * The task's status (legacy :107-109): the metadata's own `status` when it has that key (whatever its
 * value), otherwise completed once read and pending before.
 */
export function taskStatus(task: Pick<TaskDetailItem, 'metadata' | 'isRead'>): unknown {
  const metadata = task.metadata
  if (isMetadataObject(metadata) && 'status' in metadata) return metadata.status
  return task.isRead ? 'completed' : 'pending'
}

export function isTaskCompleted(status: unknown): boolean {
  return status === 'completed'
}

/** The status tag (legacy :149-151): Completed in green, anything else Pending in orange. */
export function taskStatusTag(status: unknown): { label: 'Completed' | 'Pending'; tone: 'ok' | 'warn' } {
  return isTaskCompleted(status) ? { label: 'Completed', tone: 'ok' } : { label: 'Pending', tone: 'warn' }
}

export interface TaskStep {
  key: 'created' | 'progress'
  title: string
  description: string
  /** antd's step status: `finish` is done, `process` is the step in progress. */
  state: 'finish' | 'process'
}

/** The two steps (legacy :110-123): Created, then Completed or In Progress. */
export function taskSteps(createdAt: Date, status: unknown, formatDateTime: FormatDateTime): TaskStep[] {
  const completed = isTaskCompleted(status)
  return [
    { key: 'created', title: 'Created', description: taskCreatedAtLabel(createdAt, formatDateTime), state: 'finish' },
    {
      key: 'progress',
      title: completed ? 'Completed' : 'In Progress',
      description: completed ? 'Task has been completed' : 'Task is currently in progress',
      state: completed ? 'finish' : 'process',
    },
  ]
}

export interface TaskMetadataLine {
  key: string
  label: string
  value: string
}

export type FormatAmount = (amount: number) => string

/** The amount line (legacy :201-203): a number through formatAmount, anything else as sent, then the
 *  currency code or nothing. */
export function taskAmountText(amount: unknown, currency: unknown, formatAmount: FormatAmount): string {
  const shown = typeof amount === 'number' ? formatAmount(amount) : String(amount)
  return `${shown} ${currency ? String(currency) : ''}`
}

/** The Task Details lines (legacy :185-212): User, Phone unless `N/A`, Amount and Method, each only when present. */
export function taskMetadataLines(metadata: Record<string, unknown>, formatAmount: FormatAmount): TaskMetadataLine[] {
  const lines: TaskMetadataLine[] = []
  if (metadata.userName) lines.push({ key: 'user', label: 'User:', value: String(metadata.userName) })
  if (metadata.userPhone && metadata.userPhone !== 'N/A') {
    lines.push({ key: 'phone', label: 'Phone:', value: String(metadata.userPhone) })
  }
  if (metadata.amount) {
    lines.push({ key: 'amount', label: 'Amount:', value: taskAmountText(metadata.amount, metadata.currency, formatAmount) })
  }
  if (metadata.method) lines.push({ key: 'method', label: 'Method:', value: String(metadata.method) })
  return lines
}

const KNOWN_TASK_METADATA_KEYS = ['userName', 'userPhone', 'amount', 'currency', 'method']

/** "Show all metadata" appears when the metadata holds any key beyond the ones listed (legacy :213). */
export function hasExtraTaskMetadata(metadata: Record<string, unknown>): boolean {
  return Object.keys(metadata).some((key) => !KNOWN_TASK_METADATA_KEYS.includes(key))
}

export function taskMetadataJson(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, null, 2)
}

/** The text of the error notice shown when the lookup failed and the task cannot be shown. */
export function taskDetailErrorText(error: { message?: string } | null | undefined): string {
  const message = error?.message?.trim()
  return message ? `Failed to load task: ${message}` : 'Failed to load task'
}
