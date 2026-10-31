import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconCopy, IconExclamationCircle } from '@tabler/icons-react'
import type { IconButtonProps } from './IconButton'
import { IconButton } from './IconButton'
import { strokeFor } from './icons'
import { Tooltip } from './Tooltip'
import styles from './CopyButton.module.css'

type CopyFeedback = 'idle' | 'copied' | 'error'

export interface CopyButtonProps
  extends Omit<IconButtonProps, 'children' | 'icon' | 'label' | 'onClick'> {
  /** Copied byte-for-byte; never trimmed or reformatted. */
  value: string
  /** Stable accessible action name. @default 'Copy to clipboard' */
  label?: string
  /** Tooltip and polite success announcement. @default 'Copied' */
  copiedLabel?: string
  /** Tooltip and polite failure announcement. @default 'Copy failed' */
  errorLabel?: string
  onCopied?: () => void
  onCopyError?: (error: unknown) => void
}

/** Clipboard action with keyboard-visible feedback and a polite result announcement. */
export function CopyButton({
  value,
  label = 'Copy to clipboard',
  copiedLabel = 'Copied',
  errorLabel = 'Copy failed',
  onCopied,
  onCopyError,
  ...rest
}: CopyButtonProps) {
  const [feedback, setFeedback] = useState<CopyFeedback>('idle')
  const resetTimer = useRef<number | undefined>(undefined)
  const operation = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current += 1
      window.clearTimeout(resetTimer.current)
    }
  }, [])

  const feedbackLabel = feedback === 'copied'
    ? copiedLabel
    : feedback === 'error'
      ? errorLabel
      : label

  const icon = feedback === 'copied'
    ? <IconCheck size={16} stroke={strokeFor(16)} />
    : feedback === 'error'
      ? <IconExclamationCircle size={16} stroke={strokeFor(16)} />
      : <IconCopy size={16} stroke={strokeFor(16)} />

  const scheduleReset = (id: number) => {
    window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => {
      if (mounted.current && operation.current === id) setFeedback('idle')
    }, 1800)
  }

  const copyValue = async () => {
    const id = operation.current + 1
    operation.current = id
    window.clearTimeout(resetTimer.current)
    setFeedback('idle')

    try {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!clipboard) throw new Error('Clipboard API is unavailable')
      await clipboard.writeText(value)
    } catch (error: unknown) {
      if (!mounted.current || operation.current !== id) return
      setFeedback('error')
      scheduleReset(id)
      onCopyError?.(error)
      return
    }

    if (!mounted.current || operation.current !== id) return
    setFeedback('copied')
    scheduleReset(id)
    onCopied?.()
  }

  return (
    <>
      <Tooltip content={feedbackLabel}>
        <IconButton
          {...rest}
          label={label}
          icon={icon}
          onClick={() => void copyValue()}
        />
      </Tooltip>
      <span className={styles.announcement} role="status" aria-live="polite" aria-atomic="true">
        {feedback === 'idle' ? '' : feedbackLabel}
      </span>
    </>
  )
}
