import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { IconCoins } from '@tabler/icons-react'
import type { Accent } from '@/ui/components/accent'
import { Card } from '@/ui/components/Card'
import { Skeleton } from '@/ui/components/Skeleton'
import { DrillButton } from './DrilldownDialog'
import type { DrillRequest } from './drilldownContext'
import styles from './FigureSection.module.css'

/* One of the dashboard's figure sections (Overview operations, Players retention, Financial bonus): a Card
   whose flush body is a grid of figures split by hairlines, each a caps label, a value and a muted note.
   The section's accent tints a glyph chip by its title (no coloured borders: the owner asked). Only a
   headline figure takes colour, and only in its text: the value in the accent, on the card's own ground
   (the owner asked for coloured text, not coloured boxes, 2026-10-29); every other figure stays in the ink. */

export type TablerIcon = typeof IconCoins

export interface Figure {
  label: string
  value: string
  note?: string
  /** A page that acts on the figure (a pending queue, a player). */
  to?: string
  /** The list behind the figure, opened in the drill-down modal when the figure is clicked. */
  drill?: DrillRequest
  /** A headline figure's colour, for its value's text. None leaves the figure in the ink. */
  accent?: Accent
}

/** Columns once the card is wide: a row of three, four or five; six as two rows of three. */
const columns = (count: number) => (count <= 5 ? count : count === 6 ? 3 : 4)

export interface FigureSectionProps {
  title: string
  sub: string
  icon: TablerIcon
  accent: Accent
  figures: Figure[]
  /** Waiting for the first answer: placeholders hold every figure's line. */
  pending: boolean
  /** Content under the grid, e.g. a breakdown list. */
  children?: ReactNode
}

export function FigureSection({ title, sub, icon: Glyph, accent, figures, pending, children }: FigureSectionProps) {
  return (
    <Card
      accent={accent}
      title={
        <span className={styles.title}>
          <span className={styles.chip} aria-hidden="true"><Glyph size={15} stroke={2} /></span>
          {title}
        </span>
      }
      sub={sub}
      body="flush"
    >
      <div className={styles.wrap} aria-busy={pending || undefined}>
        <dl className={styles.grid} style={{ '--ops-cols': columns(figures.length) } as CSSProperties}>
          {figures.map((figure) => {
            const value: ReactNode = pending ? <Skeleton width={84} height={18} /> : figure.value
            const coloured = !pending && figure.accent
            return (
              <div
                key={figure.label}
                className={styles.cell}
                data-accent={coloured ? figure.accent : undefined}
              >
                <dt className={styles.label}>{figure.label}</dt>
                <dd className={coloured ? `${styles.value} ${styles.coloured}` : styles.value}>
                  {pending ? value
                    : figure.drill ? <DrillButton drill={{ title: figure.label, ...figure.drill }}>{value}</DrillButton>
                    : figure.to ? <Link className={styles.link} to={figure.to}>{value}</Link>
                    : value}
                </dd>
                {figure.note ? <dd className={styles.note}>{pending ? <Skeleton width={96} height={10} /> : figure.note}</dd> : null}
              </div>
            )
          })}
        </dl>
        {children}
      </div>
    </Card>
  )
}
