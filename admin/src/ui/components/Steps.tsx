import { useId, type ReactNode } from 'react'
import { IconCheck } from '@tabler/icons-react'
import clsx from 'clsx'
import { strokeFor } from './icons'
import styles from './Steps.module.css'

export type StepState = 'done' | 'current' | 'upcoming' | 'error'

export interface StepItem {
  title: ReactNode
  description?: ReactNode
  /** Overrides the state derived from `current` (e.g. 'error' for a step that failed validation). */
  state?: StepState
  /** @default the step's position */
  key?: string
}

export interface StepsProps {
  /** Names the navigation landmark the list sits in. */
  label: string
  steps: readonly StepItem[]
  /** Index of the current step: earlier steps are done, later ones upcoming. */
  current: number
  /** When given, completed steps become buttons that jump back to that step. */
  onSelect?: (index: number) => void
  className?: string
}

function stateFor(step: StepItem, index: number, current: number): StepState {
  if (step.state) return step.state
  if (index < current) return 'done'
  return index === current ? 'current' : 'upcoming'
}

const SR_STATE: Partial<Record<StepState, string>> = { done: ', completed', error: ', has errors' }

/**
 * Wizard progress (kit p3 .steps): one bordered strip of equal cells, an ordered list with
 * aria-current="step" on the current step. It stacks vertically when its own width runs short.
 */
export function Steps({ label, steps, current, onSelect, className }: StepsProps) {
  const baseId = useId()

  return (
    <nav className={clsx(styles.root, className)} aria-label={label}>
      <ol className={styles.list}>
        {steps.map((step, index) => {
          const state = stateFor(step, index, current)
          const isCurrent = index === current
          const titleId = `${baseId}-${index}-title`
          const statusId = `${baseId}-${index}-status`
          const descriptionId = `${baseId}-${index}-description`
          const hasDescription = step.description !== undefined && step.description !== null
          const selectable = Boolean(onSelect) && state === 'done' && !isCurrent
          const body = (
            <>
              <span className={styles.marker} aria-hidden="true">
                {state === 'done' ? <IconCheck size={15} stroke={strokeFor(15)} /> : index + 1}
              </span>
              <span className={styles.text}>
                <span className={styles.title} id={titleId}>{step.title}</span>
                {hasDescription ? (
                  <span className={styles.description} id={descriptionId}>{step.description}</span>
                ) : null}
                {SR_STATE[state] ? (
                  <span className={styles.visuallyHidden} id={statusId}>{SR_STATE[state]}</span>
                ) : null}
              </span>
            </>
          )

          return (
            <li
              key={step.key ?? index}
              className={clsx(styles.step, styles[state])}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {selectable ? (
                // Named by its title and state; the description is read as the description.
                <button
                  type="button"
                  className={styles.select}
                  aria-labelledby={`${titleId} ${statusId}`}
                  aria-describedby={hasDescription ? descriptionId : undefined}
                  onClick={() => onSelect?.(index)}
                >
                  {body}
                </button>
              ) : (
                <span className={styles.cell}>{body}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
