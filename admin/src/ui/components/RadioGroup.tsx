import { useId, type FocusEventHandler, type ReactNode } from 'react'
import clsx from 'clsx'
import styles from './RadioGroup.module.css'

export type RadioValue = string | number | boolean

export interface RadioOption<T extends RadioValue> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export interface RadioGroupProps<T extends RadioValue> {
  label: ReactNode
  options: readonly RadioOption<T>[]
  value: T | null | undefined
  onChange: (value: T) => void
  name?: string
  id?: string
  onBlur?: FocusEventHandler<HTMLInputElement>
  orientation?: 'horizontal' | 'vertical'
  variant?: 'default' | 'segmented'
  help?: ReactNode
  error?: ReactNode
  required?: boolean
  disabled?: boolean
  hideLabel?: boolean
  className?: string
}

const nativeValue = (value: RadioValue): string => `${typeof value}:${String(value)}`

/**
 * A controlled, native radio group. The segmented variant only changes the presentation: it keeps
 * the same inputs, name and browser keyboard behaviour as the default group.
 */
export function RadioGroup<T extends RadioValue>({
  label,
  options,
  value,
  onChange,
  name,
  id,
  onBlur,
  orientation = 'horizontal',
  variant = 'default',
  help,
  error,
  required = false,
  disabled = false,
  hideLabel = false,
  className,
}: RadioGroupProps<T>) {
  const generatedId = useId()
  const groupId = id ?? `radio-group-${generatedId}`
  const groupName = name ?? groupId
  const helpId = help !== undefined && help !== null ? `${groupId}-help` : undefined
  const errorId = error !== undefined && error !== null ? `${groupId}-error` : undefined
  const groupDescription = [helpId, errorId].filter(Boolean).join(' ') || undefined
  const hasError = error !== undefined && error !== null

  return (
    <fieldset
      className={clsx(styles.root, hasError && styles.invalid, disabled && styles.disabled, className)}
      aria-describedby={groupDescription}
      disabled={disabled}
    >
      <legend className={hideLabel ? styles.visuallyHidden : styles.legend}>
        {label}
        {required ? (
          <>
            <span className={styles.required} aria-hidden="true">
              *
            </span>
            <span className={styles.visuallyHidden}>, required</span>
          </>
        ) : null}
      </legend>

      <span
        className={clsx(
          styles.options,
          orientation === 'vertical' && styles.vertical,
          variant === 'segmented' && styles.segmented,
        )}
      >
        {options.map((option, index) => {
          const optionId = `${groupId}-option-${index}`
          const optionLabelId = `${optionId}-label`
          const descriptionId =
            option.description !== undefined && option.description !== null
              ? `${optionId}-description`
              : undefined
          const describedBy = [descriptionId, helpId, errorId].filter(Boolean).join(' ') || undefined
          const optionDisabled = disabled || option.disabled === true
          const checked = Object.is(option.value, value)

          return (
            <span className={styles.option} key={nativeValue(option.value)}>
              <input
                className={variant === 'segmented' ? styles.segmentedInput : styles.input}
                id={optionId}
                name={groupName}
                type="radio"
                value={String(option.value)}
                checked={checked}
                disabled={optionDisabled}
                required={required}
                aria-invalid={hasError ? true : undefined}
                aria-labelledby={optionLabelId}
                aria-describedby={describedBy}
                onBlur={onBlur}
                onChange={() => {
                  if (!optionDisabled) onChange(option.value)
                }}
              />
              <label className={variant === 'segmented' ? styles.segmentedLabel : styles.optionCopy} htmlFor={optionId}>
                <span className={styles.optionLabel} id={optionLabelId}>{option.label}</span>
                {option.description !== undefined && option.description !== null ? (
                  <span className={styles.description} id={descriptionId}>
                    {option.description}
                  </span>
                ) : null}
              </label>
            </span>
          )
        })}
      </span>

      {help !== undefined && help !== null ? (
        <span className={styles.help} id={helpId}>
          {help}
        </span>
      ) : null}
      {error !== undefined && error !== null ? (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </fieldset>
  )
}
