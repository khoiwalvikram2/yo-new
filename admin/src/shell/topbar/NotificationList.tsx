import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { IconArrowRight, IconCheck } from '@tabler/icons-react'
import { Spinner } from '@/ui/components/Spinner'
import { notificationTypeIcon } from './notificationItems'
import type { NotificationCategory } from './notificationItems'
import type { FormatAmount } from './formatAmount'
import type { Notification } from '@/state/notificationStore'
import p from './TopbarPopover.module.css'
import n from './NotificationList.module.css'

export interface NotificationListProps {
  category: NotificationCategory
  titleId: string
  notifications: readonly Notification[]
  loading: boolean
  formatAmount: FormatAmount
  onNotificationClick: (id: string, actionUrl?: string | null) => void
  onMarkAllAsRead: () => void
  onViewAll: () => void
  /** The bell's unread count. Clear all shows while it is above zero even when no row is listed: an unread item
   *  the list does not hold still counts in the badge, and Clear all is the popover's one way to clear it. */
  unreadCount?: number
  /** `sheet`: the tool rail's drawer, which carries the title, Clear all and View all itself, so the list
   *  renders only its rows (or the loading / empty state) at the drawer's width. @default 'popover' */
  variant?: 'popover' | 'sheet'
}

export function NotificationList(props: NotificationListProps) {
  const {
    category,
    titleId,
    notifications,
    loading,
    formatAmount,
    onNotificationClick,
    onMarkAllAsRead,
    onViewAll,
    unreadCount = 0,
    variant = 'popover',
  } = props

  if (variant === 'sheet') {
    if (loading) {
      return <div className={p.loading}><Spinner size="md" /></div>
    }
    if (notifications.length === 0) {
      return (
        <div className={p.empty}>
          <span className={p.emptyTile} aria-hidden="true">
            <IconCheck size={20} stroke={1.75} />
          </span>
          <span className={p.emptyText}>No new {category === 'task' ? 'tasks' : 'notifications'}</span>
        </div>
      )
    }
    return <NotificationRows notifications={notifications} formatAmount={formatAmount} onNotificationClick={onNotificationClick} sheet />
  }

  if (loading) {
    return (
      <div className={clsx(p.panel, n.notifications)}>
        <div className={p.loading}>
          <Spinner size="md" />
        </div>
      </div>
    )
  }

  return (
    <div className={clsx(p.panel, n.notifications)}>
      <div className={p.head} data-ui-radius="panel-head">
        <span id={titleId} className={clsx(p.title, p.headText)}>
          {category === 'general' ? 'Notifications' : 'Tasks'}
          {notifications.length > 0 && <span className={n.count}>({notifications.length})</span>}
        </span>
        {(notifications.length > 0 || unreadCount > 0) && (
          <button type="button" className={n.clear} onClick={onMarkAllAsRead}>
            Clear all
          </button>
        )}
      </div>
      <div className={p.body}>
        {notifications.length === 0 ? (
          <div className={p.empty}>
            <span className={p.emptyTile} aria-hidden="true">
              <IconCheck size={20} stroke={1.75} />
            </span>
            <span className={p.emptyText}>No new {category === 'task' ? 'tasks' : 'notifications'}</span>
          </div>
        ) : (
          <NotificationRows notifications={notifications} formatAmount={formatAmount} onNotificationClick={onNotificationClick} />
        )}
      </div>
      <div className={p.foot}>
        <button type="button" className={p.footAction} onClick={onViewAll}>
          View all
          <span className={p.footIcon} aria-hidden="true">
            <IconArrowRight size={14} stroke={1.75} />
          </span>
        </button>
      </div>
    </div>
  )
}

function NotificationRows({ notifications, formatAmount, onNotificationClick, sheet = false }: Pick<NotificationListProps, 'notifications' | 'formatAmount' | 'onNotificationClick'> & { sheet?: boolean }) {
  return (
    <div className={clsx(n.list, sheet && n.sheetList)}>
      {notifications.map((item) => {
        const Icon = notificationTypeIcon(item.type)
        const rawAmount = item.metadata?.amount
        const amount =
          rawAmount === null || rawAmount === undefined
            ? null
            : formatAmount(Number(rawAmount), (item.metadata?.currency as string) ?? undefined)
        return (
          <button
            key={item.id}
            type="button"
            className={n.item}
            onClick={() => onNotificationClick(item.id, item.actionUrl)}
          >
            <span className={n.itemTile} aria-hidden="true">
              <Icon size={16} stroke={1.75} />
            </span>
            <span className={n.itemBody}>
              <span className={n.itemTop}>
                <span className={n.itemTitle}>{item.title}</span>
                {amount !== null && <span className={n.itemAmount}>{amount}</span>}
              </span>
              <span className={n.itemMessage}>{item.message}</span>
              <span className={n.itemTime}>
                {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
              </span>
            </span>
            <span className={n.unreadDot} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
