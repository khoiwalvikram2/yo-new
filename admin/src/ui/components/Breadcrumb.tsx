import { Link, useLocation } from 'react-router-dom'
import { IconChevronRight, IconHome } from '@tabler/icons-react'
import clsx from 'clsx'
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs'
import { toBreadcrumbTrail } from './breadcrumbTrail'
import styles from './Breadcrumb.module.css'

export interface BreadcrumbProps {
  /** On the <nav>; the Topbar (T49) uses it for placement. */
  className?: string
}

/** Renders useBreadcrumbs() with DynamicBreadcrumb's rules (breadcrumbTrail.ts), as real links. */
export function Breadcrumb({ className }: BreadcrumbProps) {
  const items = useBreadcrumbs()
  const { pathname } = useLocation()
  const trail = toBreadcrumbTrail(items, pathname)

  if (trail.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className={clsx(styles.breadcrumb, className)}>
      <ol className={styles.list}>
        {trail.map((crumb, index) => {
          const content = (
            <>
              {crumb.isHome && (
                <span className={styles.home} aria-hidden="true">
                  <IconHome size={14} stroke={1.75} />
                </span>
              )}
              <span className={styles.text}>{crumb.label}</span>
            </>
          )

          return (
            // labels can repeat non-adjacently, so the index is the stable key
            <li key={index} className={styles.item}>
              {index > 0 && (
                <span className={styles.separator} aria-hidden="true">
                  <IconChevronRight size={14} stroke={1.75} />
                </span>
              )}
              {crumb.href !== null ? (
                <Link to={crumb.href} className={clsx(styles.crumb, styles.link)}>
                  {content}
                </Link>
              ) : (
                <span
                  className={clsx(styles.crumb, crumb.isCurrent && styles.current)}
                  aria-current={crumb.isFinal ? 'page' : undefined}
                >
                  {content}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
