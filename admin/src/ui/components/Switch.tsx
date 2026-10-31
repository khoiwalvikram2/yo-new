import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import clsx from 'clsx'
import styles from './Switch.module.css'

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type' | 'aria-checked' | 'children' | 'value'> {
  checked: boolean
  /** Receives the NEXT state (same shape as antd Switch's onChange(checked)). */
  onChange: (checked: boolean) => void
  /** Visible text beside the track; with hideLabel it becomes aria-label instead. */
  label: string
  /** @default false */
  hideLabel?: boolean
  /** Keeps the established 32x18 track by default. */
  size?: 'sm' | 'md'
  /** Danger affects only the checked state; off remains the established neutral track. */
  tone?: 'default' | 'danger'
}

/** <button role="switch">: Space and Enter toggle natively, no key handling needed. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    onChange,
    label,
    hideLabel = false,
    size = 'md',
    tone = 'default',
    className,
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
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      aria-disabled={inert ? true : undefined}
      className={clsx(styles.switch, styles[size], tone === 'danger' && styles.danger, className)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (inert || event.defaultPrevented) return
        onChange(!checked)
      }}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      {!hideLabel && <span className={styles.label}>{label}</span>}
    </button>
  )
})
