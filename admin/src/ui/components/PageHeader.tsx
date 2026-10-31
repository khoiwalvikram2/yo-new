import type { HTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowLeft } from '@tabler/icons-react'
import clsx from 'clsx'
import { strokeFor } from './icons'
import styles from './PageHeader.module.css'

export interface PageHeaderBackLink {
  to: string
  /** Accessible name and tooltip for the back icon. */
  label: string
}

interface PageHeaderBackAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
  /** The routed page's only level-one heading. */
  title: ReactNode
  /** @deprecated Category copy is no longer rendered in page headings. */
  eyebrow?: ReactNode
  /** @deprecated Descriptive copy is no longer rendered in page headings. */
  sub?: ReactNode
  /** Operational identity/status, displayed beside actions rather than beneath the title. */
  meta?: ReactNode
  actions?: ReactNode
  back?: PageHeaderBackLink | PageHeaderBackAction
}

/** The page-level heading block. It deliberately depends only on the kit and react-router. */
export function PageHeader({
  title,
  meta,
  actions,
  back,
  className,
  ...rest
}: PageHeaderProps) {
  // Consume legacy presentation props without forwarding them to the DOM.
  delete rest.eyebrow
  delete rest.sub
  const hasMeta = meta !== null && meta !== undefined && meta !== false
  const hasActions = actions !== null && actions !== undefined && actions !== false
  return (
    <header
      {...rest}
      className={clsx(styles.header, className)}
      data-page-header="title-only"
    >
      <div className={styles.copy}>
        {back ? 'to' in back ? (
          <Link className={styles.back} to={back.to} aria-label={back.label} title={back.label}>
            <IconArrowLeft size={20} stroke={strokeFor(20)} aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" className={styles.back} onClick={back.onClick} disabled={back.disabled} aria-label={back.label} title={back.label}>
            <IconArrowLeft size={20} stroke={strokeFor(20)} aria-hidden="true" />
          </button>
        ) : null}
        <h1 className={styles.title}>{title}</h1>
      </div>
      {hasMeta || hasActions ? (
        <div className={styles.actions}>
          {hasMeta ? <div className={styles.meta} data-page-meta="">{meta}</div> : null}
          {actions}
        </div>
      ) : null}
    </header>
  )
}
