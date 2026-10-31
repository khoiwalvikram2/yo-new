import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import styles from './IconButton.module.css'

export type IconButtonSize = 'sm' | 'md'
/** plain: a bare glyph (the shell's). bordered: the card head's 30px bordered tile (M:888-894), which
 *  brings its own box and therefore ignores `size`. */
export type IconButtonVariant = 'plain' | 'bordered'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required. Becomes aria-label. */
  label: string
  /** The glyph, e.g. <IconBell size={19} stroke={1.6} />. Wrapped in aria-hidden. */
  icon: ReactNode
  /** @default 'plain' */
  variant?: IconButtonVariant
  /** md 34px, sm 26px. Ignored by the bordered variant, which is 30px. @default 'md' */
  size?: IconButtonSize
  /** Overlay slot rendered after the icon inside the button (a Badge or a dot, positioned by the caller). */
  children?: ReactNode
}

/** forwardRef + ...rest are REQUIRED (it is the usual Tooltip / Popover / Menu trigger). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    variant = 'plain',
    size = 'md',
    type = 'button',
    className,
    children,
    onClick,
    'aria-disabled': ariaDisabled,
    ...rest
  },
  ref,
) {
  const inert = ariaDisabled === true || ariaDisabled === 'true'

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      aria-disabled={inert ? true : undefined}
      className={clsx(
        styles.iconButton,
        variant === 'bordered' ? styles.bordered : styles[size],
        className,
      )}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (inert) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      {children}
    </button>
  )
})
