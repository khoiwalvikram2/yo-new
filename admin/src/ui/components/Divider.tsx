import type { HTMLAttributes } from 'react'
import clsx from 'clsx'
import styles from './Divider.module.css'

export interface DividerProps
  extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'role' | 'aria-orientation'> {
  /** Vertical dividers are only for a group of adjacent controls. @default 'horizontal' */
  orientation?: 'horizontal' | 'vertical'
}

/** A hairline separator. Horizontal uses native hr semantics; vertical orientation is explicit. */
export function Divider({ orientation = 'horizontal', className, ...rest }: DividerProps) {
  if (orientation === 'vertical') {
    return (
      <span
        {...rest}
        className={clsx(styles.divider, styles.vertical, className)}
        role="separator"
        aria-orientation="vertical"
      />
    )
  }

  return <hr {...rest} className={clsx(styles.divider, styles.horizontal, className)} />
}
