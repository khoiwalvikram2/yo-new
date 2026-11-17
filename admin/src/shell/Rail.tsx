import type { ShellSection } from './shellTypes'
import { SHELL_PANEL_ID } from './shellIds'
import { brandInitials } from './whitelabelName'
import { useOptionalBadgeCount } from '@/shared/services/badgeService'
import { Badge } from '@/ui/components/Badge'
import { IconChevronRight } from '@tabler/icons-react'
import styles from './Rail.module.css'

export interface RailProps {
  sections: readonly ShellSection[]
  shownKey: string | null
  onSelectSection: (key: string) => void
  brandName: string | null
  showPanelToggle: boolean
  panelExpanded: boolean
  onTogglePanel: () => void
}

interface RailButtonProps {
  section: ShellSection
  isShown: boolean
  onSelectSection: (key: string) => void
}

function RailButton({ section, isShown, onSelectSection }: RailButtonProps) {
  const count = useOptionalBadgeCount(section.badgeKey)
  const Icon = section.icon
  const label = count > 0 ? `${section.title}, ${count} waiting` : section.title
  return (
    <button
      type="button"
      className={styles.button}
      aria-pressed={isShown}
      aria-controls={SHELL_PANEL_ID}
      aria-label={label}
      title={section.title}
      onClick={() => onSelectSection(section.key)}
    >
      <Icon size={19} stroke={1.6} aria-hidden="true" />
      {/* Visible short name under the icon (the player skin). The button's accessible name stays
          aria-label. */}
      <span className={styles.label} aria-hidden="true">{section.title}</span>
      <Badge count={count} tone="solid" className={styles.badge} aria-hidden="true" />
    </button>
  )
}

export function Rail(props: RailProps) {
  const {
    sections,
    shownKey,
    onSelectSection,
    brandName,
    showPanelToggle,
    panelExpanded,
    onTogglePanel,
  } = props
  return (
    <nav aria-label="Sections" className={styles.rail} data-ui-radius="square">
      <div className={styles.brandTile} aria-hidden="true">
        {brandInitials(brandName)}
      </div>
      <div className={styles.buttons}>
        {sections.map((section) => (
          <RailButton
            key={section.key}
            section={section}
            isShown={section.key === shownKey}
            onSelectSection={onSelectSection}
          />
        ))}
      </div>
      {showPanelToggle ? (
        <div className={styles.foot}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={panelExpanded}
            aria-controls={SHELL_PANEL_ID}
            aria-label={panelExpanded ? 'Collapse the section panel' : 'Expand the section panel'}
            onClick={onTogglePanel}
          >
            <IconChevronRight size={15} stroke={1.75} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </nav>
  )
}
