import { useId, type FocusEventHandler, type ReactNode } from 'react'
import clsx from 'clsx'
import { Checkbox } from './Checkbox'
import styles from './RadioGroup.module.css'

export interface CheckboxGroupOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export interface CheckboxGroupProps {
  label: ReactNode
  options: readonly CheckboxGroupOption[]
  value: readonly string[]
  onChange: (value: string[]) => void
  name?: string
  id?: string
  onBlur?: FocusEventHandler<HTMLInputElement>
  orientation?: 'horizontal' | 'vertical'
  help?: ReactNode
  error?: ReactNode
  required?: boolean
  disabled?: boolean
  hideLabel?: boolean
  className?: string
}

/** A controlled set of native checkboxes grouped by a fieldset and legend. */
export function CheckboxGroup({
  label,
  options,
  value,
  onChange,
  name,
  id,
  onBlur,
  orientation = 'vertical',
  help,
  error,
  required = false,
  disabled = false,
  hideLabel = false,
  className,
}: CheckboxGroupProps) {
  const generatedId = useId()
  const groupId = id ?? `checkbox-group-${generatedId}`
  const groupName = name ?? groupId
  const helpId = help !== undefined && help !== null ? `${groupId}-help` : undefined
  const errorId = error !== undefined && error !== null ? `${groupId}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  const selected = new Set(value)
  const hasError = error !== undefined && error !== null

  const changeOption = (optionValue: string, checked: boolean) => {
    const next = new Set(value)
    if (checked) next.add(optionValue)
    else next.delete(optionValue)
    // Keep form state deterministic even when a consumer supplies values in a different order.
    onChange(options.filter((option) => next.has(option.value)).map((option) => option.value))
  }

  return (
    <fieldset
      className={clsx(styles.root, hasError && styles.invalid, disabled && styles.disabled, className)}
      aria-describedby={describedBy}
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

      <span className={clsx(styles.options, orientation === 'vertical' && styles.vertical)}>
        {options.map((option, index) => (
          <Checkbox
            key={option.value}
            id={`${groupId}-option-${index}`}
            name={groupName}
            value={option.value}
            checked={selected.has(option.value)}
            disabled={disabled || option.disabled}
            aria-invalid={hasError ? true : undefined}
            aria-errormessage={hasError ? errorId : undefined}
            label={option.label}
            description={option.description}
            onBlur={onBlur}
            onChange={(checked) => changeOption(option.value, checked)}
          />
        ))}
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
