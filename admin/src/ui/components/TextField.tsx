import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { FieldShell, type FieldStatus } from './FieldShell'
import styles from './TextField.module.css'

export type TextFieldType = 'text' | 'email' | 'tel' | 'url'
export type TextFieldSize = 'sm' | 'md'

export interface TextFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'children' | 'defaultValue' | 'onChange' | 'prefix' | 'size' | 'type' | 'value'
  > {
  label: string
  value: string
  onChange: (value: string) => void
  type?: TextFieldType
  size?: TextFieldSize
  help?: ReactNode
  error?: ReactNode
  hideLabel?: boolean
  prefix?: ReactNode
  suffix?: ReactNode
  clearable?: boolean
  showCount?: boolean
  status?: FieldStatus
  /** Class on the complete field. Use inputClassName for the native control. */
  className?: string
  inputClassName?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    value,
    onChange,
    type = 'text',
    size = 'md',
    help,
    error,
    hideLabel = false,
    prefix,
    suffix,
    clearable = false,
    showCount = false,
    status = 'default',
    className,
    inputClassName,
    id,
    maxLength,
    required,
    disabled,
    readOnly,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    ...rest
  },
  forwardedRef,
) {
  const generatedId = useId()
  const controlId = id ?? `text-${generatedId}`
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, [])

  const hasError = error !== undefined && error !== null
  const effectiveStatus = hasError ? 'error' : status
  const count = showCount
    ? maxLength !== undefined
      ? `${value.length} / ${maxLength}`
      : `${value.length} ${value.length === 1 ? 'character' : 'characters'}`
    : undefined
  const liveThreshold = maxLength === undefined ? Number.POSITIVE_INFINITY : Math.max(5, Math.ceil(maxLength * 0.1))
  const countLive = showCount && maxLength !== undefined && maxLength - value.length <= liveThreshold
  const canClear = clearable && value.length > 0 && !disabled && !readOnly

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
      status={effectiveStatus}
      describedBy={describedBy}
      className={className}
    >
      {(accessibility) => (
        <span
          className={clsx(
            styles.field,
            styles[size],
            effectiveStatus !== 'default' && styles[effectiveStatus],
            disabled && styles.disabled,
          )}
        >
          {prefix !== undefined && prefix !== null ? <span className={styles.prefix}>{prefix}</span> : null}
          <input
            {...rest}
            {...accessibility}
            ref={inputRef}
            type={type}
            value={value}
            maxLength={maxLength}
            required={required}
            disabled={disabled}
            readOnly={readOnly}
            aria-invalid={accessibility['aria-invalid'] ?? ariaInvalid}
            aria-required={accessibility['aria-required'] ?? ariaRequired}
            className={clsx(styles.input, inputClassName)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          />
          {canClear ? (
            <button
              type="button"
              className={styles.clearButton}
              aria-label={`Clear ${label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange('')
                inputRef.current?.focus({ preventScroll: true })
              }}
            >
              <IconX size={14} stroke={1.9} aria-hidden="true" />
            </button>
          ) : null}
          {suffix !== undefined && suffix !== null ? <span className={styles.suffix}>{suffix}</span> : null}
        </span>
      )}
    </FieldShell>
  )
})
