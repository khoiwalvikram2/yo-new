import { IconChevronRight } from '@tabler/icons-react'
import { brandInitials, DEFAULT_BRAND_NAME } from './whitelabelName'
import styles from './PanelFooter.module.css'

export interface PanelFooterProps {
  brandName: string | null
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
    </div>
  )
}
