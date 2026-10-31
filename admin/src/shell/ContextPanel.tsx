import { Fragment } from 'react'
import clsx from 'clsx'
import { SHELL_PANEL_ID } from './shellIds'
import { PanelGroupHeading } from './PanelGroupHeading'
import { PanelRow } from './PanelRow'
// explicit extension: a bare './SavedViews' resolves to savedViews.ts on a case-insensitive
// filesystem (Vite tries the .ts candidate before .tsx and that candidate case-insensitively
// matches the sibling util file) — do not "clean up" this import to drop the extension.
import { SavedViews } from './SavedViews.tsx'
import { PanelFooter } from './PanelFooter'
import type { ShellSection } from './shellTypes'
import styles from './ContextPanel.module.css'

export interface ContextPanelProps {
  section: ShellSection | null
  activeTo: string | null
  collapsed: boolean
  onNavigate: () => void
  sections: readonly ShellSection[]
  brandName: string | null
}

export function ContextPanel({
  section,
  activeTo,
  collapsed,
  onNavigate,
  sections,
  brandName,
}: ContextPanelProps) {
  return (
    <div id={SHELL_PANEL_ID} className={clsx(styles.panel, collapsed && styles.collapsed)} data-ui-radius="square">
      <div className={styles.inner} data-ui-radius="square">
        {section ? (
          <div className={styles.header} data-ui-radius="square">
            <h2 className={styles.title}>{section.title}</h2>
            {section.subtitle ? <p className={styles.subtitle}>{section.subtitle}</p> : null}
          </div>
        ) : null}
        <nav className={styles.nav} aria-label="Pages">
          {section
            ? section.entries.map((entry) =>
                entry.kind === 'group' ? (
                  <Fragment key={entry.id}>
                    <PanelGroupHeading label={entry.label} badgeKey={entry.badgeKey} />
                    {entry.rows.map((row) => (
                      <PanelRow key={row.id} row={row} isCurrent={row.to === activeTo} onNavigate={onNavigate} />
                    ))}
                  </Fragment>
                ) : (
                  <PanelRow
                    key={entry.row.id}
                    row={entry.row}
                    isCurrent={entry.row.to === activeTo}
                    onNavigate={onNavigate}
                  />
                ),
              )
            : null}
          <SavedViews sections={sections} activeTo={activeTo} onNavigate={onNavigate} />
        </nav>
        <PanelFooter brandName={brandName} />
      </div>
    </div>
  )
}
