import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import styles from './Kbd.module.css'

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** e.g. "⌘ K". */
  children: ReactNode
}

export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd {...rest} className={clsx(styles.kbd, className)}>
      {children}
    </kbd>
  )
}
