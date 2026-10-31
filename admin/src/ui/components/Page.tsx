import type { ReactNode } from 'react'
import clsx from 'clsx'
import styles from './Page.module.css'

export type PageMaxWidth = 'default' | 'wide' | 'none'

export interface PageProps {
  children: ReactNode
  /** The content cap only; the Page always keeps the shared responsive gutters. @default 'default' */
  maxWidth?: PageMaxWidth
  className?: string
}

/**
 * Content frame for a routed page. AppShell already owns the main landmark and scrolling, so this
 * stays a plain div and contributes only the page width, gutters, base type and legacy antd reset.
 */
export function Page({ children, maxWidth = 'default', className }: PageProps) {
  return <div className={clsx(styles.page, styles[maxWidth], className)}>{children}</div>
}
