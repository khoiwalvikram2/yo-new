import { useId, type HTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import type { Accent } from './accent'
import styles from './Card.module.css'

/**
 * The shared card surface promoted from the Overview page's SectionCard (M:853-869).
 *
 * A Card owns one surface only. Content that needs subdivision should use layout primitives or
 * Divider rather than asking Card to paint another nested card.
 */
export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  /** Adds the card head and gives the card its accessible name. */
  title?: ReactNode
  /** Supporting copy directly below the title. Ignored when there is no title. */
  sub?: ReactNode
  /** Controls at the head's trailing edge. Ignored when there is no title. */
  tools?: ReactNode
  /** @default 2 */
  headingLevel?: 2 | 3
  /** @default 'padded' */
  body?: 'padded' | 'flush' | 'table'
  /** Adds the visible semantic Live marker beside the tools. */
  live?: boolean
  /** @default 'section' */
  as?: 'section' | 'div'
  /** A dashboard accent: sets --accent / --accent-bg for the card's content (e.g. a title chip). It paints no
   *  border of its own; the owner asked for no coloured borders (2026-10-29). */
  accent?: Accent
  children: ReactNode
}

export function Card({
  title,
  sub,
  tools,
  headingLevel = 2,
  body = 'padded',
  live = false,
  as: Root = 'section',
  accent,
  className,
  children,
  ...rest
}: CardProps) {
  const generatedId = useId()
  const titleId = `card-title-${generatedId}`
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const hasHead = title !== undefined && title !== null && title !== false

  return (
    <Root
      {...rest}
      data-accent={accent}
      className={clsx(styles.card, className)}
      aria-labelledby={hasHead ? titleId : undefined}
    >
      {hasHead ? (
        <div className={styles.head} data-ui-radius="panel-head">
          <div className={styles.headText}>
            <Heading className={styles.title} id={titleId}>
              {title}
            </Heading>
            {sub !== undefined && sub !== null && sub !== false ? (
              <p className={styles.sub}>{sub}</p>
            ) : null}
          </div>
          {live || tools ? (
            <div className={styles.tools}>
              {live ? (
                <span className={styles.live}>
                  <span className={styles.liveDot} aria-hidden="true" />
                  Live
                </span>
              ) : null}
              {tools}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={clsx(styles.body, styles[body])}>{children}</div>
    </Root>
  )
}
