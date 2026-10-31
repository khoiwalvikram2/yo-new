import type { ReactNode } from 'react'
import clsx from 'clsx'
import styles from './SegmentedControl.module.css'

/* The mockup's .seg as a group of buttons, one of them pressed (M:778-794, in use M:1741-1746).
 *
 * It is a plain group: every button is a tab stop and each one applies its own value, which is what
 * the mockup renders for the dashboard's period control. A strip that switches panels is a different
 * control with a different keyboard model — one tab stop, arrows moving selection — and that is
 * `Tabs`, which shares this stylesheet. */

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Decorative; the label carries the meaning. */
  icon?: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  /** Names the group for assistive tech, e.g. "Period". */
  label: string
  /** @default 'md' */
  size?: 'md' | 'sm'
  /** 'phone' fills the row below 768px. @default 'never' */
  stretch?: 'never' | 'phone'
  className?: string
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  stretch = 'never',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={clsx(
        styles.seg,
        size === 'sm' && styles.sm,
        stretch === 'phone' && styles.stretchPhone,
        className,
      )}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        /* A value outside the options leaves every button unpressed — the period group sits like that
           while a custom range is applied. */
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            className={styles.button}
            aria-pressed={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? (
              <span className={styles.icon} aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
