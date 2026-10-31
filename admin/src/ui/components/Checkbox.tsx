import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react'
import clsx from 'clsx'
import styles from './Checkbox.module.css'

export interface CheckboxProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'checked' | 'defaultChecked' | 'onChange' | 'children' | 'size'
  > {
  checked: boolean
  /** Sets the native HTMLInputElement.indeterminate property. @default false */
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  label: string
  /** Keeps the real label in the accessibility tree while hiding it visually. @default false */
  hideLabel?: boolean
  description?: string
  /** Class on the root wrapper; other native attributes are passed to the input. */
  className?: string
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    checked,
    indeterminate = false,
    onChange,
    label,
    hideLabel = false,
    description,
    id,
    className,
    disabled,
    ...rest
  },
  forwardedRef,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = description ? `${inputId}-description` : undefined
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, [])

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <span className={clsx(styles.root, disabled && styles.disabled, className)}>
      <input
        {...rest}
        ref={inputRef}
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        className={styles.input}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          if (disabled) return
          onChange(event.target.checked)
        }}
      />
      <span className={styles.copy}>
        <label className={clsx(styles.label, hideLabel && styles.visuallyHidden)} htmlFor={inputId}>
          {label}
        </label>
        {description ? (
          <span className={styles.description} id={descriptionId}>
            {description}
          </span>
        ) : null}
      </span>
    </span>
  )
})
