import type { ReactNode } from 'react'
import styles from './LightRegion.module.css'

export interface LightRegionProps {
  children: ReactNode
}

/** Compatibility frame for route errors outside the shell; it now inherits the saved root theme. */
export function LightRegion({ children }: LightRegionProps) {
  return (
    <div className={styles.root}>
      {children}
    </div>
  )
}
