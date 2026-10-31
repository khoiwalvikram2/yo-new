import type { ReactNode } from 'react'
import styles from './PublicRegion.module.css'

/** The shell supplies viewport space for public routes while inheriting the saved theme. */
export function PublicRegion({ children }: { children: ReactNode }) {
  return <div className={styles.root}>{children}</div>
}
