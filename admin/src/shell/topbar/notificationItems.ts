import type { Notification } from '@/state/notificationStore'
import type { TablerIcon } from '@tabler/icons-react'
import {
  IconWallet,
  IconCreditCard,
  IconUser,
  IconAlertCircle,
  IconCurrencyDollar,
  IconSettings,
  IconBell,
} from '@tabler/icons-react'

export type NotificationCategory = 'general' | 'task'

export const NOTIFICATION_LIST_LIMIT = 7

/** store-first, then query results not already in the store (by String(id)); unread only; capped (NotificationButton.tsx:80-95) */
export function mergeUnreadNotifications(
  storeItems: readonly Notification[],
  queryItems: readonly Notification[],
  category: NotificationCategory,
  limit: number = NOTIFICATION_LIST_LIMIT,
): Notification[] {
  const queryIds = new Set(queryItems.map((n) => String(n.id)))
  const newStoreItems = storeItems.filter((n) => n.category === category && !queryIds.has(String(n.id)))
  return [...newStoreItems, ...queryItems].filter((n) => !n.isRead).slice(0, limit)
}

const TYPE_ICONS: Partial<Record<string, TablerIcon>> = {
  DEPOSIT: IconWallet,
  WITHDRAWAL: IconCreditCard,
  PLAYER: IconUser,
  AGENT: IconUser,
  SYSTEM: IconAlertCircle,
  COMMISSION: IconCurrencyDollar,
  SETTINGS: IconSettings,
}

/** DEPOSIT IconWallet, WITHDRAWAL IconCreditCard, PLAYER/AGENT IconUser, SYSTEM IconAlertCircle, COMMISSION IconCurrencyDollar, SETTINGS IconSettings, default IconBell */
export function notificationTypeIcon(type: string | null | undefined): TablerIcon {
  const key = (type ?? '').toUpperCase()
  return TYPE_ICONS[key] ?? IconBell
}
