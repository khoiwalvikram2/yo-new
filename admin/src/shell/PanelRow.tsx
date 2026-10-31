import type { MouseEvent, ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useOptionalBadgeCount } from '@/shared/services/badgeService'
import { Badge } from '@/ui/components/Badge'
import { hardNavigateIfLeavingSportsEvent } from './navClick'
import type { ShellRow } from './shellTypes'
import styles from './ContextPanel.module.css'

export interface PanelRowProps {
  row: ShellRow
  /** active styling (data-current="true"): primary rows, Saved-view rows (T34) */
  isCurrent: boolean
  /** default true: also sets aria-current="page" when isCurrent. Saved-view rows pass false (T34) */
  announceCurrent?: boolean
  onNavigate?: () => void
  quiet?: boolean
  /** px size of the row icon; 16 for panel nav rows, 15 for the footer plinks */
  iconSize?: number
  trailing?: ReactNode
}

export function PanelRow({
  row,
  isCurrent,
  announceCurrent = true,
  onNavigate,
  quiet = false,
  iconSize = 16,
  trailing,
}: PanelRowProps) {
  const location = useLocation()
  const count = useOptionalBadgeCount(row.badgeKey)
  const Icon = row.icon

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (hardNavigateIfLeavingSportsEvent(event, location.pathname, row.to)) return
    onNavigate?.()
  }

  return (
    <>
      <Link
        to={row.to}
        className={clsx(styles.row, quiet && styles.quiet)}
        data-current={isCurrent ? 'true' : undefined}
        aria-current={isCurrent && announceCurrent ? 'page' : undefined}
        onClick={handleClick}
      >
        <Icon size={iconSize} stroke={1.75} className={styles.rowIcon} aria-hidden="true" />
        <span className={styles.rowLabel}>{row.label}</span>
        {row.badgeKey ? <Badge count={count} tone="soft" className={styles.rowBadge} /> : null}
      </Link>
      {trailing}
    </>
  )
}
