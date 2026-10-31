import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { Spinner } from './Spinner'
import styles from './Button.module.css'

/** primary/secondary/ghost are the shell's three. Page migration (C) adds:
 *  `pill` the header control (M:765-775), `link` a text action inside a card head (M:879-886),
 *  `danger` a destructive action that looks like `secondary` until it is hovered, and `dangerSolid`
 *  the confirming button of a destructive dialog. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'pill' | 'link' | 'danger' | 'dangerSolid'
/** md 36, sm 30, xs 26 (a table row action, M:1036), lg 42 (a banner call to action, M:1118). */
export type ButtonSize = 'sm' | 'md' | 'xs' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** @default 'secondary' */
  variant?: ButtonVariant
  /** md 36px, sm 30px, xs 26px, lg 42px. @default 'md' */
  size?: ButtonSize
  /** Fill the width of the row it sits in (a phone call to action, a form's submit). @default false */
  block?: boolean
  /** Shows a spinner in the icon slot, sets aria-busy + aria-disabled, swallows clicks, keeps focus. @default false */
  loading?: boolean
  /** Leading icon, e.g. <IconDownload size={16} stroke={1.75} />. Hidden from assistive tech. */
  icon?: ReactNode
}

/**
 * Native <button>. forwardRef + ...rest are REQUIRED: Tooltip / Popover / Menu clone the trigger
 * and inject ref, on* handlers and aria-* through props (R5 §4.1).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    block = false,
    loading = false,
    icon,
    type = 'button',
    className,
    children,
    onClick,
    'aria-disabled': ariaDisabled,
    ...rest
  },
  ref,
) {
  const inert = loading || ariaDisabled === true || ariaDisabled === 'true'

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={clsx(styles.button, styles[variant], styles[size], block && styles.block, className)}
      aria-disabled={inert ? true : undefined}
      aria-busy={loading ? true : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (inert) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
    >
      {loading ? (
        <Spinner size="sm" decorative className={styles.icon} />
      ) : (
        icon && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )
      )}
      {children !== undefined && children !== null && children !== false && (
        <span className={styles.label}>{children}</span>
      )}
    </button>
  )
})
