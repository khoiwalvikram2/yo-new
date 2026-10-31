import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Dialog, type DialogProps } from './Dialog'
import styles from './Drawer.module.css'

export type DrawerSize = 'sm' | 'md' | 'lg'

export interface DrawerProps extends Omit<DialogProps, 'size' | 'description' | 'square'> {
  size?: DrawerSize
  sub?: ReactNode
}

/** Right-edge detail surface composed on the modal Dialog base. Square on all four corners (the owner,
 *  2026-10-28): Dialog marks its surface, head, body and foot so the 5px radius policy skips them. */
export function Drawer({ size = 'md', sub, className, overlayClassName, ...props }: DrawerProps) {
  return (
    <Dialog
      {...props}
      size="xl"
      description={sub}
      square
      className={clsx(styles.drawer, styles[size], className)}
      overlayClassName={clsx(styles.drawerOverlay, overlayClassName)}
    />
  )
}
