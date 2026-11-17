import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import clsx from 'clsx'
import { FieldShell, type FieldStatus } from './FieldShell'
import styles from './NumberField.module.css'

export type NumberGrouping = 'en-IN' | 'en-US' | false
export type NumberFieldSize = 'sm' | 'md'

export interface NumberFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    | 'children'
    | 'defaultValue'
    | 'inputMode'
    | 'max'
    | 'min'
    | 'onChange'
    | 'prefix'
    | 'size'
    | 'step'
    | 'type'
    | 'value'
  > {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  precision?: number
  /** Grouping is display-only; focus always reveals raw decimal digits. @default false */
  grouping?: NumberGrouping
  prefix?: ReactNode
  suffix?: ReactNode
  /** Adds compact increment/decrement buttons. Arrow keys work whether or not these are shown. */
  stepper?: boolean
  size?: NumberFieldSize
  help?: ReactNode
  error?: ReactNode
  hideLabel?: boolean
  status?: FieldStatus
  /** Class on the complete field. Use inputClassName for the native control. */
  className?: string
  inputClassName?: string
}

const EDITABLE_NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d*)?$/
const TRANSIENT_NUMBER = new Set(['-', '.', '-.'])

function safePrecision(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(20, Math.max(0, Math.trunc(value)))
}

function round(value: number, precision: number | undefined) {
  // Without an explicit precision the field must preserve every number the
  // caller can represent.  Rounding to an arbitrary significant-digit count
  // corrupts otherwise safe large integers merely by focusing and blurring.
  if (precision === undefined) return value
  return Number(value.toFixed(precision))
}

function normalise(value: number, min: number | undefined, max: number | undefined, precision: number | undefined) {
  let next = value
  if (min !== undefined) next = Math.max(min, next)
  if (max !== undefined) next = Math.min(max, next)
  next = round(next, precision)
  if (min !== undefined) next = Math.max(min, next)
  if (max !== undefined) next = Math.min(max, next)
  return Object.is(next, -0) ? 0 : next
}

function parseRaw(raw: string): number | null | undefined {
  if (raw === '') return null
  if (!EDITABLE_NUMBER.test(raw) || TRANSIENT_NUMBER.has(raw)) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function rawNumber(value: number | null, precision: number | undefined) {
  if (value === null || !Number.isFinite(value)) return ''
  return precision === undefined ? String(value) : value.toFixed(precision)
}

function displayNumber(value: number | null, grouping: NumberGrouping, precision: number | undefined) {
  if (value === null || !Number.isFinite(value)) return ''
  if (grouping === false) return rawNumber(value, precision)
  return new Intl.NumberFormat(grouping, {
    useGrouping: true,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision ?? 20,
  }).format(value)
}

function valuesMatch(left: number | null | undefined, right: number | null) {
  return left !== undefined && Object.is(left, right)
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  {
    label,
    value,
    onChange,
    min,
    max,
    step = 1,
    precision,
    grouping = false,
    prefix,
    suffix,
    stepper = false,
    size = 'md',
    help,
    error,
    hideLabel = false,
    status = 'default',
    className,
    inputClassName,
    id,
    required,
    disabled,
    readOnly,
    onFocus,
    onBlur,
    onKeyDown,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    ...rest
  },
  forwardedRef,
) {
  const generatedId = useId()
  const controlId = id ?? `number-${generatedId}`
  const inputRef = useRef<HTMLInputElement>(null)
  const normalisedPrecision = safePrecision(precision)
  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState(() => displayNumber(value, grouping, normalisedPrecision))
  const [announcement, setAnnouncement] = useState('')
  // Keyboard focus (Tab) selects the whole value, so typing replaces it. Focus swaps grouped text for raw
  // digits, and rewriting the input collapses that selection to a caret at the end: typed digits were
  // appended (50,000 then 60000 became 5,000,060,000). The swap restores a selection the browser made.
  const reselectAllRef = useRef(false)
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, [])

  useLayoutEffect(() => {
    if (!reselectAllRef.current) return
    reselectAllRef.current = false
    const input = inputRef.current
    if (input && input.ownerDocument.activeElement === input) input.select()
  }, [raw])

  useEffect(() => {
    setRaw((currentRaw) => {
      const parsed = parseRaw(currentRaw)
      if (focused && valuesMatch(parsed, value)) return currentRaw
      return focused ? rawNumber(value, normalisedPrecision) : displayNumber(value, grouping, normalisedPrecision)
    })
  }, [focused, grouping, normalisedPrecision, value])

  const hasError = error !== undefined && error !== null
  const effectiveStatus = hasError ? 'error' : status
  const formattedMin = min === undefined ? undefined : displayNumber(min, grouping, normalisedPrecision)
  const formattedMax = max === undefined ? undefined : displayNumber(max, grouping, normalisedPrecision)
  const rangeHelp =
    min !== undefined && max !== undefined
      ? `Allowed range: ${formattedMin} to ${formattedMax}.`
      : min !== undefined
        ? `Minimum: ${formattedMin}.`
        : max !== undefined
          ? `Maximum: ${formattedMax}.`
          : undefined
  const effectiveHelp =
    help !== undefined && help !== null && rangeHelp ? (
      <>
        {help} {rangeHelp}
      </>
    ) : (help ?? rangeHelp)

  const emitSteppedValue = (direction: 1 | -1, multiplier = 1) => {
    const parsed = parseRaw(raw)
    const base = typeof parsed === 'number' ? parsed : value ?? 0
    const usableStep = Number.isFinite(step) && step > 0 ? step : 1
    const unbounded = base + direction * usableStep * multiplier
    const next = normalise(unbounded, min, max, normalisedPrecision)
    setRaw(rawNumber(next, normalisedPrecision))
    setAnnouncement(next !== unbounded ? `Value adjusted to ${displayNumber(next, grouping, normalisedPrecision)}.` : '')
    if (!Object.is(next, value)) onChange(next)
  }

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    setFocused(false)
    const parsed = parseRaw(raw)
    if (parsed === undefined) {
      setRaw(displayNumber(value, grouping, normalisedPrecision))
    } else if (parsed === null) {
      setRaw('')
      if (value !== null) onChange(null)
    } else {
      const next = normalise(parsed, min, max, normalisedPrecision)
      setRaw(displayNumber(next, grouping, normalisedPrecision))
      setAnnouncement(next !== parsed ? `Value adjusted to ${displayNumber(next, grouping, normalisedPrecision)}.` : '')
      if (!Object.is(next, value)) onChange(next)
    }
    onBlur?.(event)
  }

  const atMaximum = max !== undefined && value !== null && value >= max
  const atMinimum = min !== undefined && value !== null && value <= min

  return (
    <FieldShell
      id={controlId}
      label={label}
      required={required}
      hideLabel={hideLabel}
      help={effectiveHelp}
      error={error}
      status={effectiveStatus}
      describedBy={describedBy}
      className={className}
    >
      {(accessibility) => (
        <>
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
              type="text"
              inputMode="decimal"
              value={raw}
              required={required}
              disabled={disabled}
              readOnly={readOnly}
              aria-invalid={accessibility['aria-invalid'] ?? ariaInvalid}
              aria-required={accessibility['aria-required'] ?? ariaRequired}
              className={clsx(styles.input, inputClassName)}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const nextRaw = event.target.value
                if (!EDITABLE_NUMBER.test(nextRaw)) return
                setRaw(nextRaw)
                const parsed = parseRaw(nextRaw)
                if (parsed === null) {
                  if (value !== null) onChange(null)
                } else if (parsed !== undefined && !Object.is(parsed, value)) {
                  onChange(parsed)
                }
              }}
              onFocus={(event) => {
                const input = event.currentTarget
                const nextRaw = rawNumber(value, normalisedPrecision)
                // Only a whole-value selection is restored: a click keeps its caret where it landed.
                reselectAllRef.current =
                  nextRaw !== input.value &&
                  input.value !== '' &&
                  input.selectionStart === 0 &&
                  input.selectionEnd === input.value.length
                setFocused(true)
                setRaw(nextRaw)
                onFocus?.(event)
              }}
              onBlur={handleBlur}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                onKeyDown?.(event)
                if (event.defaultPrevented || disabled || readOnly) return
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                emitSteppedValue(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey ? 10 : 1)
              }}
            />
            {suffix !== undefined && suffix !== null ? <span className={styles.suffix}>{suffix}</span> : null}
            {stepper ? (
              <span className={styles.stepper}>
                <button
                  type="button"
                  className={styles.stepButton}
                  aria-label={`Increase ${label}`}
                  disabled={disabled || readOnly || atMaximum}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => emitSteppedValue(1)}
                >
                  <IconChevronUp size={11} stroke={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.stepButton}
                  aria-label={`Decrease ${label}`}
                  disabled={disabled || readOnly || atMinimum}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => emitSteppedValue(-1)}
                >
                  <IconChevronDown size={11} stroke={2} aria-hidden="true" />
                </button>
              </span>
            ) : null}
          </span>
          <span className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
            {announcement}
          </span>
        </>
      )}
    </FieldShell>
  )
})
