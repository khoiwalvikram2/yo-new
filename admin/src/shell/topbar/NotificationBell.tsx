import { IconBell, IconCircleCheck } from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { IconButton } from '@/ui/components/IconButton'
import { Popover } from '@/ui/components/Popover'
import { NotificationList } from './NotificationList'
import { useNotificationBell } from './useNotificationBell'
import type { NotificationCategory } from './notificationItems'
import styles from './NotificationBell.module.css'

export interface NotificationBellProps {
  category: NotificationCategory
}

/**
 * Trigger + Popover for one notification bell (NotificationButton.tsx:125-190, R8-popover-content.md §7
 * "Notifications"). All Apollo/store logic lives in useNotificationBell (Step 3); this component only
 * renders what the hook returns, plus the kit and Task 38's NotificationList.
 */
export function NotificationBell({ category }: NotificationBellProps) {
  const state = useNotificationBell(category)
  const { formatAmount } = useCurrency()
  const titleId = `notification-bell-${category}-title`

  if (state.initialLoading) {
    return <span className={styles.skeleton} aria-hidden="true" />
  }

  const baseLabel = category === 'general' ? 'Notifications' : 'Pending Tasks'
  const label = state.unreadCount > 0 ? `${baseLabel}, ${state.unreadCount} unread` : baseLabel

  return (
    <Popover
      open={state.open}
      onOpenChange={state.setOpen}
      labelledBy={titleId}
      trigger={
        <IconButton
          label={label}
          className={styles.bell}
          icon={
            category === 'general' ? (
              <IconBell size={19} stroke={1.6} />
            ) : (
              <IconCircleCheck size={19} stroke={1.6} />
            )
          }
        >
          {state.unreadCount > 0 ? (
            <span className={clsx(styles.count, category === 'task' && styles.task)} aria-hidden="true" />
          ) : null}
        </IconButton>
      }
    >
      <NotificationList
        category={category}
        titleId={titleId}
        notifications={state.notifications}
        loading={state.listLoading}
        formatAmount={formatAmount}
        onNotificationClick={state.onNotificationClick}
        onMarkAllAsRead={state.onMarkAllAsRead}
        onViewAll={state.onViewAll}
        unreadCount={state.unreadCount}
      />
    </Popover>
  )
}
