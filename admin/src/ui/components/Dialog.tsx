import { useId, type MutableRefObject, type ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { IconButton } from './IconButton'
import { Overlay, type OverlayRole } from './Overlay'
import styles from './Dialog.module.css'

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  size?: DialogSize
  footer?: ReactNode
  initialFocus?: MutableRefObject<HTMLElement | null>
  dismissible?: boolean
  role?: OverlayRole
  themeFrom?: { readonly current: Element | null }
  restoreFocusTo?: { readonly current: HTMLElement | null }
  className?: string
  overlayClassName?: string
  /** A flush frame (Drawer): the surface and its head, body and foot are marked data-ui-radius="square",
   *  so none of their corners round. Off, the dialog keeps the 5px card and its head rounds only on top. */
  square?: boolean
}

/** Accessible controlled modal dialog with kit sizing and theme-safe portal mechanics. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  footer,
  initialFocus,
  dismissible = true,
  role = 'dialog',
  themeFrom,
  restoreFocusTo,
  className,
  overlayClassName,
  square = false,
}: DialogProps) {
  const reactId = useId()
  const titleId = `${reactId}-title`
  const descriptionId = description === undefined ? undefined : `${reactId}-description`

  return (
    <Overlay
      open={open}
      onOpenChange={onOpenChange}
      role={role}
      labelledBy={titleId}
      describedBy={descriptionId}
      initialFocus={initialFocus}
      dismissible={dismissible}
      themeFrom={themeFrom}
      restoreFocusTo={restoreFocusTo}
      overlayClassName={clsx(styles.scrim, overlayClassName)}
      className={clsx(styles.dialog, styles[size], className)}
      square={square}
    >
      <header className={styles.header} data-ui-radius={square ? 'square' : 'panel-head'}>
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description !== undefined && (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}
        </div>
        {dismissible && (
          <IconButton
            label="Close dialog"
            icon={<IconX size={18} stroke={1.75} />}
            size="sm"
            onClick={() => onOpenChange(false)}
            className={styles.close}
          />
        )}
      </header>
      <div className={styles.body} data-ui-radius={square ? 'square' : undefined}>{children}</div>
      {footer !== undefined && <footer className={styles.footer} data-ui-radius={square ? 'square' : undefined}>{footer}</footer>}
    </Overlay>
  )
}
