import { useId, type ReactNode } from 'react'
import clsx from 'clsx'
import styles from './FieldShell.module.css'

export type FieldStatus = 'default' | 'error' | 'success'

export interface FieldControlAccessibilityProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  'aria-required'?: true
}

export interface FieldShellProps {
  /** A real label is always rendered; hideLabel only changes its visual presentation. */
  label: ReactNode
  children: (props: FieldControlAccessibilityProps) => ReactNode
  id?: string
  required?: boolean
  hideLabel?: boolean
  help?: ReactNode
  error?: ReactNode
  count?: ReactNode
  /** The character count becomes polite only when the owning control is near its limit. */
  countLive?: boolean
  /** The count is past its limit (kit .fld__count.is-over): drawn in the negative ink. */
  countOver?: boolean
  status?: FieldStatus
  /** Extra ids supplied by the consumer are retained in aria-describedby. */
  describedBy?: string
  className?: string
}

/**
 * Shared semantic frame for native form controls. It owns every generated id so labels, help,
 * errors and counts cannot drift apart when a field is composed in a dialog or drawer.
 */
export function FieldShell({
  label,
  children,
  id,
  required = false,
  hideLabel = false,
  help,
  error,
  count,
  countLive = false,
  countOver = false,
  status = 'default',
  describedBy,
  className,
}: FieldShellProps) {
  const generatedId = useId()
  const controlId = id ?? `field-${generatedId}`
  const helpId = help !== undefined && help !== null ? `${controlId}-help` : undefined
  const errorId = error !== undefined && error !== null ? `${controlId}-error` : undefined
  const countId = count !== undefined && count !== null ? `${controlId}-count` : undefined
  const descriptionIds = [describedBy, helpId, errorId, countId].filter(Boolean).join(' ') || undefined
  const hasError = error !== undefined && error !== null
  const effectiveStatus: FieldStatus = hasError ? 'error' : status
  const invalid = hasError || effectiveStatus === 'error'

  return (
    <span className={clsx(styles.root, effectiveStatus !== 'default' && styles[effectiveStatus], className)}>
      <label htmlFor={controlId} className={hideLabel ? styles.visuallyHidden : styles.label}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {children({
        id: controlId,
        'aria-describedby': descriptionIds,
        'aria-invalid': invalid ? true : undefined,
        'aria-required': required ? true : undefined,
      })}

      {help !== undefined && help !== null ? (
        <span className={styles.help} id={helpId}>
          {help}
        </span>
      ) : null}

      {error !== undefined && error !== null ? (
        <span className={styles.errorText} id={errorId} role="alert">
          {error}
        </span>
      ) : null}

      {count !== undefined && count !== null ? (
        <>
          <span className={clsx(styles.count, countOver && styles.over)} id={countId}>
            {count}
          </span>
          <span className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
            {countLive ? count : ''}
          </span>
        </>
      ) : null}
    </span>
  )
}
