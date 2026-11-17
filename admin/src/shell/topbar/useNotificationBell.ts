import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import {
  NOTIFICATION_STATS_QUERY,
  MY_NOTIFICATIONS_QUERY,
  MARK_NOTIFICATION_READ_MUTATION,
  MARK_ALL_NOTIFICATIONS_READ_MUTATION,
} from '@/lib/graphql/notifications'
import { useNotificationStore, type Notification } from '@/state/notificationStore'
import { resolveNotificationActionUrl } from '@/shared/core/notificationUtils'
import { mergeUnreadNotifications, type NotificationCategory } from './notificationItems'

export interface NotificationBellState {
  open: boolean
  setOpen: (open: boolean) => void
  unreadCount: number
  initialLoading: boolean
  notifications: Notification[]
  listLoading: boolean
  onNotificationClick: (id: string, actionUrl?: string | null) => Promise<void>
  onMarkAllAsRead: () => Promise<void>
  onViewAll: () => void
}

/**
 * Data behind one notification bell (general or task), moved out of NotificationButton.tsx:20-123, :142-145
 * unchanged: the two Apollo queries, the window `notificationReceived` listener, the "refetch once on open"
 * effect and the two mutations. `popoverOpen`/`setPopoverOpen` are renamed `open`/`setOpen`. The unread merge
 * and cap-at-7 moved to Task 38's `mergeUnreadNotifications` instead of being re-inlined.
 * `enabled` false (the tool rail, for a role without this bell) runs no query at all.
 */
export function useNotificationBell(category: NotificationCategory, enabled = true): NotificationBellState {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const {
    setStats,
    markAsRead: markAsReadStore,
    markAllAsRead: markAllAsReadStore,
    notifications: storeNotifications,
  } = useNotificationStore()

  const { data: statsData, loading: statsLoading, refetch: refetchStats } = useQuery(NOTIFICATION_STATS_QUERY, {
    skip: !enabled,
    pollInterval: 10000, // Poll every 10 seconds for stats
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })

  useEffect(() => {
    if (statsData?.notificationStats) {
      setStats(statsData.notificationStats)
    }
  }, [statsData, setStats])

  const { data: notificationsData, loading: notificationsLoading, refetch: refetchNotifications } = useQuery(
    MY_NOTIFICATIONS_QUERY,
    {
      // Unread rows only, whatever their age: the badge counts every unread notification, and the newest ten
      // rows with the read ones dropped never listed one older than those ten.
      variables: { category, limit: 10, offset: 0, unreadOnly: true },
      skip: !enabled,
      errorPolicy: 'all',
      fetchPolicy: 'cache-and-network',
      pollInterval: open ? 5000 : 30000, // Poll more frequently when open
    },
  )

  // Listen for custom notification events and refetch (window CustomEvent contract with
  // useNotificationSubscription.ts, which stays in place).
  const handleNotificationReceived = useCallback(
    (event: CustomEvent) => {
      const notification = event.detail
      if (enabled && notification?.category === category) {
        refetchNotifications()
        refetchStats()
      }
    },
    [category, enabled, refetchNotifications, refetchStats],
  )

  useEffect(() => {
    window.addEventListener('notificationReceived', handleNotificationReceived as EventListener)
    return () => {
      window.removeEventListener('notificationReceived', handleNotificationReceived as EventListener)
    }
  }, [handleNotificationReceived])

  // Single refetch when the popover opens (deterministic path; no store-driven refetch to avoid
  // overlap with the window event and the poll interval).
  useEffect(() => {
    if (open && enabled) {
      refetchNotifications()
    }
  }, [open, enabled, refetchNotifications])

  const [markAsReadMutation] = useMutation(MARK_NOTIFICATION_READ_MUTATION, {
    refetchQueries: [NOTIFICATION_STATS_QUERY, MY_NOTIFICATIONS_QUERY],
  })

  const [markAllAsReadMutation] = useMutation(MARK_ALL_NOTIFICATIONS_READ_MUTATION, {
    refetchQueries: [NOTIFICATION_STATS_QUERY, MY_NOTIFICATIONS_QUERY],
  })

  const unreadCount = category === 'general'
    ? statsData?.notificationStats?.generalUnread || 0
    : statsData?.notificationStats?.taskUnread || 0

  const queryNotifications: Notification[] = notificationsData?.myNotifications || []
  const notifications = mergeUnreadNotifications(storeNotifications, queryNotifications, category)

  const onNotificationClick = useCallback(
    async (id: string, actionUrl?: string | null) => {
      try {
        await markAsReadMutation({ variables: { id } })
        markAsReadStore(id)
        if (actionUrl) {
          setOpen(false)
          navigate(resolveNotificationActionUrl(actionUrl))
        }
      } catch {
        // Marking read is a convenience; a failed mutation must not block navigation feedback or crash the bell.
      }
    },
    [markAsReadMutation, markAsReadStore, navigate],
  )

  const onMarkAllAsRead = useCallback(async () => {
    try {
      await markAllAsReadMutation({ variables: { category } })
      markAllAsReadStore(category)
      refetchNotifications()
    } catch {
      // Marking all read is a convenience; a failed mutation must not crash the bell.
    }
  }, [markAllAsReadMutation, markAllAsReadStore, category, refetchNotifications])

  const onViewAll = useCallback(() => {
    setOpen(false)
    navigate('/notifications', { state: { category } })
  }, [navigate, category])

  return {
    open,
    setOpen,
    unreadCount,
    initialLoading: statsLoading && !statsData,
    notifications,
    listLoading: notificationsLoading && notifications.length === 0,
    onNotificationClick,
    onMarkAllAsRead,
    onViewAll,
  }
}
