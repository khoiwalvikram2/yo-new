import { useId, type HTMLAttributes } from 'react'
import clsx from 'clsx'
import { CopyButton } from './CopyButton'
import styles from './CodeBlock.module.css'

export interface CodeBlockProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Visible and programmatic name for the scrollable code region. */
  label: string
  /** Rendered as text and copied exactly; markup in the value is never interpreted. */
  code: string
  /** Allow long lines to wrap instead of scrolling horizontally. @default false */
  wrap?: boolean
}

/** Labelled, focusable code output with an exact-value copy action. */
export function CodeBlock({
  label,
  code,
  wrap = false,
  className,
  ...rest
}: CodeBlockProps) {
  const generatedId = useId()
  const labelId = `code-block-label-${generatedId}`

  return (
    <div {...rest} className={clsx(styles.block, className)}>
      <div className={styles.header}>
        <span className={styles.label} id={labelId}>{label}</span>
        <CopyButton
          value={code}
          label={`Copy ${label}`}
          size="sm"
          variant="plain"
        />
      </div>
      <pre
        className={clsx(styles.pre, wrap && styles.wrap)}
        aria-labelledby={labelId}
        tabIndex={0}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}
