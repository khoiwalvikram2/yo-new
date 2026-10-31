import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react'
import { IconSearch, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import styles from './SearchField.module.css'

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'value' | 'onChange' | 'onSubmit'> {
  label: string
  value: string
  /** Updates the visible, controlled value immediately. */
  onChange: (value: string) => void
  /** When supplied, receives user edits after debounceMs; Enter and clearing submit immediately. */
  onSubmit?: (value: string) => void
  /** @default 300 */
  debounceMs?: number
  /** @default 'md' */
  size?: 'sm' | 'md'
  /** The real label remains in the DOM. @default true */
  hideLabel?: boolean
  className?: string
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    label,
    value,
    onChange,
    onSubmit,
    debounceMs = 300,
    size = 'md',
    hideLabel = true,
    className,
    id,
    disabled,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? `search-${generatedId}`
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submitRef = useRef(onSubmit)

  useEffect(() => {
    submitRef.current = onSubmit
  }, [onSubmit])

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  const cancelPending = () => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const submitNow = (nextValue: string) => {
    cancelPending()
    submitRef.current?.(nextValue)
  }

  const scheduleSubmit = (nextValue: string) => {
    cancelPending()
    if (!submitRef.current) return
    const delay = Number.isFinite(debounceMs) ? Math.max(0, debounceMs) : 300
    if (delay === 0) {
      submitRef.current(nextValue)
      return
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      submitRef.current?.(nextValue)
    }, delay)
  }

  const clear = () => {
    if (value !== '') onChange('')
    submitNow('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      clear()
      return
    }
    if (event.key === 'Enter' && submitRef.current) {
      event.preventDefault()
      submitNow(value)
    }
  }

  return (
    <span className={clsx(styles.root, className)}>
      <label htmlFor={inputId} className={hideLabel ? styles.visuallyHidden : styles.label}>
        {label}
      </label>
      <span className={clsx(styles.field, styles[size])}>
        <span className={styles.searchIcon} aria-hidden="true">
          <IconSearch size={size === 'sm' ? 14 : 16} stroke={1.75} />
        </span>
        <input
          {...rest}
          ref={ref}
          id={inputId}
          type="search"
          value={value}
          disabled={disabled}
          className={styles.input}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const nextValue = event.target.value
            onChange(nextValue)
            scheduleSubmit(nextValue)
          }}
          onKeyDown={handleKeyDown}
        />
        {value !== '' && !disabled ? (
          <button type="button" className={styles.clearButton} aria-label={`Clear ${label}`} onClick={clear}>
            <IconX size={14} stroke={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </span>
  )
})
