import { formatDistanceToNow } from 'date-fns'

/* The /notifications page's logic, kept out of React so it can be pinned by unit tests. Every rule is
   the legacy NotificationsPage.tsx rule moved as it was (page migration C, Task 107); the line it came
   from is named beside it. */

export type NotificationCategory = 'general' | 'task'

/** One row of `myNotifications` (lib/graphql/notifications.ts) or of the realtime store. */
export interface NotificationItem {
  id: string | number
  type?: string | null
  category?: string | null
  title?: string | null
  message?: string | null
  metadata?: Record<string, unknown> | null
  isRead?: boolean | null
  actionUrl?: string | null
  createdAt?: string | null
}

export type NotificationIconKey = 'wallet' | 'card' | 'user' | 'alert' | 'currency' | 'settings' | 'bell'

/** Legacy getIcon: Wallet, CreditCard, User (player and agent), ExclamationCircle, Dollar, Setting, else Bell. */
const ICON_BY_TYPE: Readonly<Record<string, NotificationIconKey>> = {
  DEPOSIT: 'wallet',
  WITHDRAWAL: 'card',
  PLAYER: 'user',
  AGENT: 'user',
  SYSTEM: 'alert',
  COMMISSION: 'currency',
  SETTINGS: 'settings',
}

export function notificationIconKey(type: string | null | undefined): NotificationIconKey {
  const key = typeof type === 'string' ? type.toUpperCase() : ''
  return ICON_BY_TYPE[key] ?? 'bell'
}

/**
 * Realtime rows of the shown category that the query has not returned yet, then the query rows
 * (legacy :114-120). An agent only ever sees the general category.
 */
export function mergeNotifications<T extends NotificationItem>(
  storeItems: readonly T[],
  queryItems: readonly T[],
  isAgent: boolean,
  activeTab: NotificationCategory,
): T[] {
  const queryIds = new Set(queryItems.map((n) => String(n.id)))
  const realtime = storeItems.filter((n) => {
    const matchesCategory = isAgent ? n.category === 'general' : n.category === activeTab
    return matchesCategory && !queryIds.has(String(n.id))
  })
  return [...realtime, ...queryItems]
}

export interface DateGroupDeps {
  isToday: (date: Date) => boolean
  isYesterday: (date: Date) => boolean
  formatDate: (date: string, format: string) => string
}

/** The legacy getDateGroup (:56-66): Today, Yesterday, the tenant-zone date, or Other. */
export function notificationDateGroup(dateStr: string, deps: DateGroupDeps): string {
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return 'Other'
    if (deps.isToday(date)) return 'Today'
    if (deps.isYesterday(date)) return 'Yesterday'
    return deps.formatDate(dateStr, 'MMM d, yyyy')
  } catch {
    return 'Other'
  }
}

export interface NotificationGroup<T extends NotificationItem> {
  label: string
  items: T[]
}

/**
 * Groups rows by their date label in first-seen order (legacy :142-149). A row with no createdAt is
 * left out of every group, as before.
 */
export function groupNotificationsByDate<T extends NotificationItem>(
  items: readonly T[],
  groupOf: (createdAt: string) => string,
): NotificationGroup<T>[] {
  const groups: NotificationGroup<T>[] = []
  const byLabel = new Map<string, NotificationGroup<T>>()
  for (const item of items) {
    if (!item?.createdAt) continue
    const label = groupOf(item.createdAt)
    let group = byLabel.get(label)
    if (!group) {
      group = { label, items: [] }
      byLabel.set(label, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

/** Where a row leads (legacy :131), or null for a row with no id, which the legacy click ignored. */
export function notificationDetailPath(notification: NotificationItem | null | undefined): string | null {
  if (!notification?.id) return null
  const id = String(notification.id)
  return notification.category === 'task' ? `/notifications/tasks/${id}` : `/notifications/${id}`
}

export function hasUnreadNotifications(items: readonly NotificationItem[]): boolean {
  return items.some((n) => !n.isRead)
}

/** The store's unread count for the shown category (legacy :152). */
export function unreadForTab(activeTab: NotificationCategory, generalUnread: number, taskUnread: number): number {
  return activeTab === 'general' ? generalUnread : taskUnread
}

/** `General` or `General (3)`: the legacy tab carried its unread count in a pill beside the label. */
export function notificationTabLabel(label: string, unread: number): string {
  return unread > 0 ? `${label} (${unread})` : label
}

export type FormatAmount = (amount: number, currencyCode?: string) => string

/** The row's amount (legacy :219), or null when the metadata carries none. */
export function notificationAmount(notification: NotificationItem, formatAmount: FormatAmount): string | null {
  const metadata = notification.metadata
  if (metadata?.amount == null) return null
  return formatAmount(Number(metadata.amount), metadata.currency as string | undefined)
}

/** `5 minutes ago`, or an empty string for a date date-fns cannot read (legacy :221-222). */
export function notificationTimeAgo(createdAt: string | null | undefined): string {
  try {
    return formatDistanceToNow(new Date(createdAt as string), { addSuffix: true })
  } catch {
    return ''
  }
}

export function notificationUserName(notification: NotificationItem): string | null {
  const userName = notification.metadata?.userName
  return userName ? String(userName) : null
}

export interface ClickLike {
  button: number
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
}

/**
 * A plain primary click runs the legacy handler (mark read, then navigate). A modified or middle click is
 * left to the browser, so the row can now open in a new tab.
 */
export function isPlainPrimaryClick(event: ClickLike): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  )
}

/** The text of the error notice shown when the list failed and nothing can be shown. */
export function notificationsErrorText(error: { message?: string } | null | undefined): string {
  const message = error?.message?.trim()
  return message ? `Failed to load notifications: ${message}` : 'Failed to load notifications'
}
