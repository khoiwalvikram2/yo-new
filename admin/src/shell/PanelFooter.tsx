import { IconCalendar, IconChevronRight } from '@tabler/icons-react'
import { useIstClock } from './topbar/useIstClock'
import { brandInitials, DEFAULT_BRAND_NAME } from './whitelabelName'
import styles from './PanelFooter.module.css'

export interface PanelFooterProps {
  brandName: string | null
}

/**
 * The IST date and time, under the brand card. It sat in the topbar until 2026-11-17 (owner's call).
 * Its own component so the 30-second tick re-renders these two labels and not the card above them.
 */
function PanelClock() {
  const { date, time } = useIstClock()
  return (
    <div className={styles.clock}>
      <span className={styles.clockIcon} aria-hidden="true">
        <IconCalendar size={17} stroke={1.6} />
      </span>
      <span className={styles.clockText}>
        <b className={styles.clockDate}>{date}</b>
        <span className={styles.clockTime}>{time}</span>
      </span>
    </div>
  )
}

export function PanelFooter(props: PanelFooterProps) {
  const { brandName } = props

  return (
    <div className={styles.footer} data-ui-radius="square">
      <div className={styles.envCard}>
        <span className={styles.envTile} aria-hidden="true">
          {brandInitials(brandName)}
        </span>
        <span className={styles.envText}>
          <b className={styles.envName}>{brandName ?? DEFAULT_BRAND_NAME}</b>
          <span className={styles.envMeta}>
            <span className={styles.envDot} aria-hidden="true" />
            {import.meta.env.MODE}
          </span>
        </span>
        <span className={styles.envChevron} aria-hidden="true">
          <IconChevronRight size={15} stroke={1.75} />
        </span>
      </div>
      <PanelClock />
    </div>
  )
}
