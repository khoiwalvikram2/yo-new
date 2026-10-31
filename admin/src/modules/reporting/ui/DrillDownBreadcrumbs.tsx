import { useLayoutEffect, useRef } from 'react'
import { IconChevronRight, IconHome } from '@tabler/icons-react'
import clsx from 'clsx'
import { strokeFor } from '@/ui/components/icons'
import { domainRootLabel } from './drillDownModel'
import styles from './DrillDownBreadcrumbs.module.css'

export interface BreadcrumbLevel {
  label: string
  key: string
  value?: string | number
  /** Carried for parity; the legacy component never called it — a crumb reports its index instead. */
  onClick: () => void
}

export interface DrillDownBreadcrumbsProps {
  levels: BreadcrumbLevel[]
  /** Carried for parity; unused, as before. */
  currentLevel: string
  domain: 'sports' | 'casino' | 'matka' | 'bonuses'
  /** -1 for the domain root, else the level's index. */
  onLevelClick: (index: number) => void
}

const GLYPH = 14

/**
 * The report's drill-down path as a labelled navigation list: the domain root, then each level, the
 * last one current. Earlier crumbs are buttons. Same props as components/DrillDownBreadcrumbs.tsx.
 *
 * The crumb a user activates usually becomes the current one and stops being a button, which would
 * drop focus to the document; focus then moves to the new current crumb instead.
 */
export function DrillDownBreadcrumbs({ levels, domain, onLevelClick }: DrillDownBreadcrumbsProps) {
  const label = domainRootLabel(domain)
  const currentRef = useRef<HTMLSpanElement>(null)
  const pendingFocus = useRef(false)

  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    const active = document.activeElement
    if (!active || active === document.body) currentRef.current?.focus()
  }, [levels])

  const go = (index: number) => {
    pendingFocus.current = true
    onLevelClick(index)
  }

  const home = (
    <>
      <span className={styles.home} aria-hidden="true">
        <IconHome size={GLYPH} stroke={strokeFor(GLYPH)} />
      </span>
      <span className={styles.text}>{label}</span>
    </>
  )

  const separator = (
    <span className={styles.separator} aria-hidden="true">
      <IconChevronRight size={GLYPH} stroke={strokeFor(GLYPH)} />
    </span>
  )

  return (
    <nav aria-label="Drill-down path" className={styles.root}>
      <ol className={styles.list}>
        <li className={styles.item}>
          {levels.length === 0 ? (
            <span ref={currentRef} className={clsx(styles.crumb, styles.current)} aria-current="location" tabIndex={-1}>
              {home}
            </span>
          ) : (
            <button type="button" className={clsx(styles.crumb, styles.link)} onClick={() => go(-1)}>
              {home}
            </button>
          )}
        </li>
        {levels.map((level, index) => {
          const last = index === levels.length - 1
          return (
            <li key={`${level.key}-${level.value ?? index}`} className={styles.item}>
              {separator}
              {last ? (
                <span ref={currentRef} className={clsx(styles.crumb, styles.current)} aria-current="location" tabIndex={-1}>
                  <span className={styles.text}>{level.label}</span>
                </span>
              ) : (
                <button type="button" className={clsx(styles.crumb, styles.link)} onClick={() => go(index)}>
                  <span className={styles.text}>{level.label}</span>
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
