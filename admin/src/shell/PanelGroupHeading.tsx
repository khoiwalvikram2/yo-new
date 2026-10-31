import { useOptionalBadgeCount } from '@/shared/services/badgeService'
import { Badge } from '@/ui/components/Badge'
import type { ShellBadgeKey } from './shellTypes'
import styles from './ContextPanel.module.css'

export interface PanelGroupHeadingProps {
  label: string
  badgeKey: ShellBadgeKey | null
}

export function PanelGroupHeading({ label, badgeKey }: PanelGroupHeadingProps) {
  const count = useOptionalBadgeCount(badgeKey)
  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>{label}</h3>
      {count > 0 ? (
        <>
          <Badge count={count} tone="soft" className={styles.rowBadge} aria-hidden="true" />
          <span className={styles.srOnly}>{`${count} waiting`}</span>
        </>
      ) : null}
    </div>
  )
}
