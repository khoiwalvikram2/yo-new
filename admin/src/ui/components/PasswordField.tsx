import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { IconEye, IconEyeOff } from '@tabler/icons-react'
import clsx from 'clsx'
import { FieldShell, type FieldStatus } from './FieldShell'
import { IconButton } from './IconButton'
import { strokeFor } from './icons'
import fieldStyles from './TextField.module.css'
import styles from './PasswordField.module.css'

/* A secret entry field: TextField's face and FieldShell wiring around a native password input, plus a
 * reveal toggle. It replaces antd `Input.Password` (14 files).
 *
 * The value is never logged, stored or copied anywhere by the component. Uncontrolled use (omit `value`)
 * keeps the secret in the DOM only, which is also what password managers expect.
 *
 * Controlled use does not hand `value` to React either: React mirrors a controlled input's value into
 * the `value` attribute, where any stylesheet can read it with an attribute selector. The value is
 * written to the DOM property instead, after every render, so the markup never carries the secret. */

/** Every caller states what the browser may do with the field: an admin form that sets someone else's
 *  password must say `new-password`, or the browser offers the admin's own saved password. */
export type PasswordAutoComplete = 'current-password' | 'new-password' | 'one-time-code' | 'off'
export type PasswordFieldSize = 'sm' | 'md'

export interface PasswordFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'autoComplete' | 'children' | 'defaultValue' | 'onChange' | 'prefix' | 'size' | 'type' | 'value'
  > {
  /** Always rendered as a <label>; `hideLabel` keeps it for assistive tech only. */
  label: string
  /** Controlled value. Omit it (and use defaultValue) to leave the secret in the DOM only. */
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  /** Required on purpose, see PasswordAutoComplete. */
  autoComplete: PasswordAutoComplete
  /** md 36px, sm 30px. @default 'md' */
  size?: PasswordFieldSize
  help?: ReactNode
  error?: ReactNode
  hideLabel?: boolean
  prefix?: ReactNode
  status?: FieldStatus
  /** Class on the complete field. Use inputClassName for the native control. */
  className?: string
  inputClassName?: string
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  {
    label,
    value,
    defaultValue,
    onChange,
    autoComplete,
    size = 'md',
    help,
    error,
    hideLabel = false,
    prefix,
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
  forwardedRef,
) {
  const generatedId = useId()
  const controlId = id ?? `password-${generatedId}`
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, [])

  const [revealed, setRevealed] = useState(false)
  // The caret position across the type flip; a browser may move it when the input changes type.
  const pendingSelection = useRef<[number | null, number | null] | null>(null)

  const hasError = error !== undefined && error !== null
  const effectiveStatus: FieldStatus = hasError ? 'error' : status

  // Controlled value → DOM property (never the attribute); runs after every render, as React would.
  const controlledValue = useRef(value)
  useLayoutEffect(() => {
    controlledValue.current = value
    const input = inputRef.current
    if (input && value !== undefined && input.value !== value) input.value = value
  })

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    onChange?.(input.value)
    if (value === undefined) return
    // A parent that refuses the edit does not re-render, so the effect above never runs; put the
    // controlled value back once React has finished with this event, as a controlled input would.
    queueMicrotask(() => {
      const expected = controlledValue.current
      if (expected !== undefined && input.value !== expected) input.value = expected
    })
  }

  useLayoutEffect(() => {
    const input = inputRef.current
    const selection = pendingSelection.current
    pendingSelection.current = null
    if (!input || !selection || document.activeElement !== input) return
    try {
      input.setSelectionRange(selection[0], selection[1])
    } catch {
      // a type that does not support selection; nothing to restore
    }
  }, [revealed])

  // A revealed password is a plain text input, and browsers keep submitted text inputs in their
  // autofill history. Hide it again before any submit handler or the browser sees the form.
  useEffect(() => {
    const form = inputRef.current?.form
    if (!form) return
    const hide = () => {
      if (inputRef.current) inputRef.current.type = 'password'
      setRevealed(false)
    }
    form.addEventListener('submit', hide, true)
    return () => form.removeEventListener('submit', hide, true)
  }, [])

  const toggle = () => {
    const input = inputRef.current
    if (input && document.activeElement === input) {
      pendingSelection.current = [input.selectionStart, input.selectionEnd]
    }
    setRevealed((current) => !current)
  }

  const iconSize = 16

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
          className={clsx(
            fieldStyles.field,
            size === 'sm' && fieldStyles.sm,
            effectiveStatus !== 'default' && fieldStyles[effectiveStatus],
            disabled && fieldStyles.disabled,
            styles.face,
          )}
        >
          {prefix !== undefined && prefix !== null ? <span className={fieldStyles.prefix}>{prefix}</span> : null}
          <input
            {...rest}
            {...accessibility}
            {...(value === undefined && defaultValue !== undefined ? { defaultValue } : null)}
            ref={inputRef}
            type={revealed ? 'text' : 'password'}
            autoComplete={autoComplete}
            // A revealed secret must not reach a spelling service or be rewritten by autocorrect.
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            required={required}
            disabled={disabled}
            aria-invalid={accessibility['aria-invalid'] ?? ariaInvalid}
            aria-required={accessibility['aria-required'] ?? ariaRequired}
            className={clsx(fieldStyles.input, styles.input, inputClassName)}
            onChange={handleChange}
          />
          <IconButton
            label="Show password"
            size="sm"
            aria-pressed={revealed}
            aria-controls={controlId}
            disabled={disabled}
            className={clsx(styles.toggle, size === 'sm' && styles.toggleSm)}
            icon={
              revealed ? (
                <IconEyeOff size={iconSize} stroke={strokeFor(iconSize)} />
              ) : (
                <IconEye size={iconSize} stroke={strokeFor(iconSize)} />
              )
            }
            // A pointer press must not pull focus out of the input the user is typing in.
            onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
            onClick={toggle}
          />
        </span>
      )}
    </FieldShell>
  )
})
