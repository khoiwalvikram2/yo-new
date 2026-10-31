import type { ReactNode } from 'react'

export type TabItem = {
  key: string
  label: string
  icon?: ReactNode
}

type SegmentedTabsProps = {
  tabs: TabItem[]
  value: string
  onChange: (key: string) => void
  /** Kept for existing callers; every variant now renders the matchbook strip. */
  theme?: 'default' | 'slate'
  /** Kept for existing callers; the strip is always flat (3px corners). */
  rounded?: 'default' | '5px'
  /** Stretch tabs to full width; each tab gets equal space */
  fullWidth?: boolean
}

/**
 * Account-page tabs as the matchbook strip: white bar, hairline dividers, the active tab filled red
 * (styles in styles/nova-account.css).
 */
export function SegmentedTabs({ tabs, value, onChange, fullWidth = false }: SegmentedTabsProps) {
  return (
    <div className={`nova-seg${fullWidth ? ' is-full' : ''}`} role="group">
      {tabs.map((tab) => {
        const isActive = value === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(tab.key)}
            className={`nova-seg-tab${isActive ? ' is-active' : ''}`}
          >
            {tab.icon && <span className="nova-seg-icon" aria-hidden="true">{tab.icon}</span>}
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
