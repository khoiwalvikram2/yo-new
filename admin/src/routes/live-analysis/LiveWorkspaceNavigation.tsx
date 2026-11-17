import { IconActivity, IconChartBar, IconChartLine, IconFlame, IconGauge,
  IconLayoutDashboard, IconList, IconScale, IconShield, IconTestPipe, IconUsers } from '@tabler/icons-react'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { tabId } from '@/ui/components/tabIds'
import { StatusPill } from '@/ui/components/StatusPill'
import type { LiveFeature } from './LiveWorkspace'
import styles from './LiveWorkspace.module.css'

const COMMON: readonly TabItem<string>[] = [
  { value: 'overview', label: 'Overview', icon: <IconLayoutDashboard size={16} /> },
  { value: 'analytics', label: 'Analytics', icon: <IconChartLine size={16} /> },
  { value: 'performance', label: 'Performance', icon: <IconGauge size={16} /> },
]
const OTHER: readonly TabItem<string>[] = [
  { value: 'bet-list', label: 'Bet List', icon: <IconList size={16} /> },
  { value: 'comparison', label: 'Compare', icon: <IconScale size={16} /> },
  { value: 'players', label: 'Players', icon: <IconUsers size={16} /> },
]
const SPORTS: readonly TabItem<string>[] = [
  { value: 'running-events', label: 'Running Events', icon: <IconActivity size={16} /> },
  ...COMMON,
  { value: 'exposure', label: 'Exposure', icon: <IconShield size={16} /> },
  ...OTHER,
  { value: 'markets', label: 'Markets', icon: <IconChartBar size={16} /> },
]
const GAMING: readonly TabItem<string>[] = [
  ...COMMON,
  { value: 'heatmap', label: 'Heatmap', icon: <IconFlame size={16} /> },
  ...OTHER,
  { value: 'testing', label: 'Testing', icon: <IconTestPipe size={16} /> },
]

export interface LiveNavigationProps {
  activeTab: string
  setActiveTab: (tab: string) => void
  hasDashData: boolean
  isUpdating: boolean
  cubeRotation: number
  compact?: boolean
  /** The Testing tab is a diagnostic the server lets only some callers run; false leaves it out. @default true */
  showTesting?: boolean
}

function liveTabPrefix(feature: LiveFeature) {
  return `${feature}-live`
}

export function LiveWorkspaceNavigation({
  feature, activeTab, setActiveTab, hasDashData, isUpdating, showTesting = true,
}: LiveNavigationProps & { feature: LiveFeature }) {
  const tabs = feature === 'sports' ? SPORTS : showTesting ? GAMING : GAMING.filter((tab) => tab.value !== 'testing')
  return (
    <nav className={styles.navigation} aria-label={`${feature} analysis navigation`}>
      <div className={styles.navigationScroll}>
        <Tabs value={activeTab} onChange={setActiveTab} items={tabs} size="sm"
          label={`${feature} analysis views`} idPrefix={liveTabPrefix(feature)} />
      </div>
      <span className={styles.connectionState}>
        <StatusPill tone={hasDashData ? 'ok' : 'neutral'}>
          {isUpdating ? 'Updating' : hasDashData ? 'Connected' : 'Waiting for data'}
        </StatusPill>
      </span>
    </nav>
  )
}

export function LiveWorkspaceTitle({ feature, activeTab, windowMins }: {
  feature: LiveFeature
  activeTab: string
  windowMins?: number
}) {
  const tabs = feature === 'sports' ? SPORTS : GAMING
  const tab = tabs.find((item) => item.value === activeTab) ||
    (activeTab === 'exposure' ? { label: 'Exposure', icon: <IconShield size={16} /> } : undefined)
  if (!tab) return null
  return (
    <div className={styles.sectionHeader}>
      <div className={styles.sectionIdentity}>
        <span className={styles.sectionIcon} aria-hidden="true">{tab.icon}</span>
        <h2 className={styles.sectionTitle} id={tabId(liveTabPrefix(feature), activeTab) + '-heading'}>{tab.label}</h2>
      </div>
      {feature === 'casino' ? <span className={styles.sectionMeta}>{windowMins}m</span> :
        feature === 'matka' ? <span className={styles.sectionMeta}>Open bets</span> :
          activeTab === 'running-events' ? <span className={styles.sectionMeta}>Live Events</span> : null}
    </div>
  )
}
