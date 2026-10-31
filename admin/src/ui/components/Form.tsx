import {
  forwardRef,
  useId,
  type FieldsetHTMLAttributes,
  type FormHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import clsx from 'clsx'
import { Grid, type GridColumns, type GridGap } from './LayoutPrimitives'
import styles from './Form.module.css'

export interface FormProps extends FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode
  /** Persistent polite message from the form engine, e.g. "2 fields need attention". */
  errorAnnouncement?: ReactNode
  /** Remounts only the live-region content so an equal-count failed submit is announced again. */
  errorAnnouncementRevision?: string | number
}

/**
 * The kit form deliberately keeps native submit behaviour. In particular, it does not add a
 * key handler: pressing Enter in a text control follows the browser's submit algorithm exactly
 * once and reaches the supplied onSubmit handler as one submit event.
 */
export const Form = forwardRef<HTMLFormElement, FormProps>(function Form(
  { children, className, errorAnnouncement, errorAnnouncementRevision, ...rest },
  ref,
) {
  return (
    <form {...rest} ref={ref} noValidate className={clsx(styles.form, className)}>
      <span className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        <span key={errorAnnouncementRevision}>{errorAnnouncement}</span>
      </span>
      {children}
    </form>
  )
})

export interface FormFieldProps
  extends Omit<
    FieldsetHTMLAttributes<HTMLFieldSetElement>,
    'aria-invalid' | 'aria-required' | 'children'
  > {
  label: ReactNode
  children: ReactNode
  required?: boolean
  help?: ReactNode
  error?: ReactNode
}

/**
 * Semantic frame for a composite field such as a date range, radio cluster or checkbox list.
 * Individual native controls use FieldShell; a related set of controls needs one fieldset and
 * legend so the group name and its help/error copy are announced together.
 */
export function FormField({
  label,
  children,
  required = false,
  help,
  error,
  id,
  className,
  'aria-describedby': describedBy,
  ...rest
}: FormFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? `form-field-${generatedId}`
  const helpId = help !== undefined && help !== null ? `${fieldId}-help` : undefined
  const errorId = error !== undefined && error !== null ? `${fieldId}-error` : undefined
  const descriptionIds = [describedBy, helpId, errorId].filter(Boolean).join(' ') || undefined
  const hasError = error !== undefined && error !== null

  return (
    <fieldset
      {...rest}
      id={fieldId}
      className={clsx(styles.fieldGroup, hasError && styles.fieldInvalid, className)}
      aria-describedby={descriptionIds}
      aria-invalid={hasError ? true : undefined}
    >
      <legend className={styles.fieldLegend}>
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
      <div className={styles.fieldBody}>{children}</div>
      {help !== undefined && help !== null ? (
        <span className={styles.fieldHelp} id={helpId}>
          {help}
        </span>
      ) : null}
      {error !== undefined && error !== null ? (
        <span className={styles.fieldError} id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </fieldset>
  )
}

export interface FormSectionProps
  extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, 'children' | 'title'> {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  /** Mobile-first field columns. @default `{ base: 1, md: 2 }` */
  cols?: GridColumns
  /** @default 20 */
  gap?: GridGap
  gridClassName?: string
}

/** A semantic field group with the kit's responsive field grid. */
export function FormSection({
  title,
  description,
  children,
  cols = { base: 1, md: 2 },
  gap = 20,
  className,
  gridClassName,
  ...rest
}: FormSectionProps) {
  return (
    <fieldset {...rest} className={clsx(styles.section, className)}>
      <legend className={styles.legend}>{title}</legend>
      {description !== undefined && description !== null ? (
        <p className={styles.description}>{description}</p>
      ) : null}
      <Grid cols={cols} gap={gap} className={gridClassName}>
        {children}
      </Grid>
    </fieldset>
  )
}

export interface FormActionsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode
}

/** Sticky action row for a long page, dialog or drawer form. */
export function FormActions({ children, className, ...rest }: FormActionsProps) {
  return (
    <div {...rest} className={clsx(styles.actions, className)}>
      {children}
    </div>
  )
}
