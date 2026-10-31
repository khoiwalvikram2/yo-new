import { forwardRef, useId, useRef, useState, type InputHTMLAttributes } from 'react'
import { IconCalendar } from '@tabler/icons-react'
import clsx from 'clsx'
import { CalendarPopover } from './Calendar'
import { FieldShell, type FieldStatus } from './FieldShell'
import { strokeFor } from './icons'
import { isDateTimeString, isWholeMinuteStep } from './istDate'
import styles from './TextField.module.css'
import own from './DateTimeField.module.css'

export interface DateTimeFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'defaultValue' | 'max' | 'min' | 'onChange' | 'size' | 'step' | 'type' | 'value'
  > {
  label: string
  /** A minute-precision `yyyy-MM-ddTHH:mm` calendar value, or an empty string. */
  value: string
  onChange: (value: string) => void
  /** Calendar bounds in the same `yyyy-MM-ddTHH:mm` form as value. */
  min?: string
  max?: string
  /** Whole-minute increment, expressed in seconds (60, 120, 300, ...). @default 60 */
  step?: number
  size?: 'sm' | 'md'
  help?: string
  error?: string
  hideLabel?: boolean
  status?: FieldStatus
  /** Class on the complete field; inputClassName targets the native control. */
  className?: string
  inputClassName?: string
}

/** The day part of a bound, for the calendar; a bound that is not a date-time binds nothing there. */
const dayOf = (value: string | undefined): string | undefined =>
  isDateTimeString(value) ? value.slice(0, 10) : undefined

function wholeMinuteStep(step: number): number {
  if (!isWholeMinuteStep(step)) {
    throw new RangeError('DateTimeField step must be a positive whole-minute increment in seconds')
  }
  return step
}

/**
 * Native local date-time input carrying an IST calendar string; conversion happens at the API boundary.
 * The calendar button picks the date part in the kit's themed Calendar; the time part stays as typed
 * (00:00 while there is none), so the browser's own date-and-time popup is hidden.
 */
export const DateTimeField = forwardRef<HTMLInputElement, DateTimeFieldProps>(function DateTimeField(
  {
    label,
    value,
    onChange,
    min,
    max,
    step = 60,
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
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    ...rest
  },
  ref,
) {
  const generatedId = useId()
  const controlId = id ?? `datetime-${generatedId}`
  const hasError = error !== undefined && error !== null
  const effectiveStatus: FieldStatus = hasError ? 'error' : status
  const nativeStep = wholeMinuteStep(step)
  const faceRef = useRef<HTMLSpanElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const locked = Boolean(disabled || rest.readOnly)
  const time = isDateTimeString(value) ? value.slice(11) : '00:00'

  return (
    <FieldShell
      id={controlId}
      label={label}
      required={required}
      hideLabel={hideLabel}
      help={help}
      error={error}
      status={effectiveStatus}
      describedBy={describedBy}
      className={className}
    >
      {(accessibility) => (
        <span
          ref={faceRef}
          className={clsx(
            styles.field,
            size === 'sm' && styles.sm,
            effectiveStatus !== 'default' && styles[effectiveStatus],
            disabled && styles.disabled,
          )}
        >
          <input
            {...rest}
            {...accessibility}
            ref={ref}
            type="datetime-local"
            value={value}
            min={min}
            max={max}
            step={nativeStep}
            required={required}
            disabled={disabled}
            aria-invalid={accessibility['aria-invalid'] ?? ariaInvalid}
            aria-required={accessibility['aria-required'] ?? ariaRequired}
            className={clsx(styles.input, own.input, inputClassName)}
            onChange={(event) => {
              const next = event.target.value
              if (next === '' || isDateTimeString(next)) onChange(next)
            }}
          />
          <CalendarPopover
            open={pickerOpen && !locked}
            onOpenChange={(next) => setPickerOpen(next && !locked)}
            value={isDateTimeString(value) ? value.slice(0, 10) : ''}
            min={dayOf(min)}
            max={dayOf(max)}
            hint={`Time stays ${time} IST`}
            onSelect={(day) => {
              onChange(`${day}T${time}`)
              setPickerOpen(false)
            }}
            anchorRef={faceRef}
            trigger={
              <button
                type="button"
                className={clsx(own.pick, size === 'sm' && own.pickSm)}
                aria-label="Choose date"
                // Out of the tab order, like Select's themed list: pointer users get the picker, keyboard users keep typing in the native input (pages' tab orders stay as they were).
                tabIndex={-1}
                disabled={locked}
              >
                <IconCalendar size={16} stroke={strokeFor(16)} aria-hidden="true" />
              </button>
            }
          />
        </span>
      )}
    </FieldShell>
  )
})
