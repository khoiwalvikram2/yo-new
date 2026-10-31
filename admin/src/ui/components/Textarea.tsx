import {
  forwardRef,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type TextareaHTMLAttributes,
} from 'react'
import clsx from 'clsx'
import { FieldShell, type FieldStatus } from './FieldShell'
import styles from './Textarea.module.css'

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'children' | 'defaultValue' | 'onChange' | 'value'> {
  label: string
  value: string
  onChange: (value: string) => void
  help?: string
  error?: string
  hideLabel?: boolean
  /** Grows to the native scroll height as the controlled value changes. @default false */
  autoGrow?: boolean
  /** Shows the current length and, when supplied, maxLength. @default false */
  showCount?: boolean
  status?: FieldStatus
  /** Class on the complete field. Use textareaClassName for the native control. */
  className?: string
  textareaClassName?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    value,
    onChange,
    help,
    error,
    hideLabel = false,
    autoGrow = false,
    showCount = false,
    status = 'default',
    className,
    textareaClassName,
    id,
    rows = 4,
    maxLength,
    required,
    disabled,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    ...rest
  },
  forwardedRef,
) {
  const generatedId = useId()
  const controlId = id ?? `textarea-${generatedId}`
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(forwardedRef, () => textareaRef.current as HTMLTextAreaElement, [])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (!autoGrow) {
      textarea.style.height = ''
      return
    }

    const resizeToContent = () => {
      textarea.style.height = 'auto'
      const computed = window.getComputedStyle(textarea)
      const borderBlock =
        (Number.parseFloat(computed.borderTopWidth) || 0) +
        (Number.parseFloat(computed.borderBottomWidth) || 0)
      textarea.style.height = `${textarea.scrollHeight + borderBlock}px`
    }

    resizeToContent()
    if (typeof ResizeObserver === 'undefined') return

    let measuredWidth = textarea.getBoundingClientRect().width
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? textarea.getBoundingClientRect().width
      if (nextWidth === measuredWidth) return
      measuredWidth = nextWidth
      resizeToContent()
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [autoGrow, rows, value])

  const effectiveStatus = error ? 'error' : status
  const count = showCount
    ? maxLength !== undefined
      ? `${value.length} / ${maxLength}`
      : `${value.length} ${value.length === 1 ? 'character' : 'characters'}`
    : undefined
  const liveThreshold = maxLength === undefined ? Number.POSITIVE_INFINITY : Math.max(5, Math.ceil(maxLength * 0.1))
  const countLive =
    showCount && maxLength !== undefined && maxLength - value.length <= liveThreshold
  /* The native maxLength stops typing at the limit, but only user edits: a value the page sets (a saved
     remark, a limit lowered under it) can still be longer, and the counter says so. */
  const countOver = showCount && maxLength !== undefined && value.length > maxLength

  return (
    <FieldShell
      id={controlId}
      label={label}
      required={required}
      hideLabel={hideLabel}
      help={help}
      error={error}
      count={count}
      countLive={countLive}
      countOver={countOver}
      status={effectiveStatus}
      describedBy={describedBy}
      className={className}
    >
      {(accessibility) => (
        <textarea
          {...rest}
          {...accessibility}
          ref={textareaRef}
          value={value}
          rows={rows}
          maxLength={maxLength}
          required={required}
          disabled={disabled}
          aria-invalid={ariaInvalid ?? accessibility['aria-invalid']}
          className={clsx(
            styles.textarea,
            effectiveStatus !== 'default' && styles[effectiveStatus],
            autoGrow && styles.autoGrow,
            textareaClassName,
          )}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        />
      )}
    </FieldShell>
  )
})
