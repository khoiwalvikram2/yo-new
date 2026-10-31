import { useState } from 'react'
import { IconChartLine, IconChartPie, IconUsers } from '@tabler/icons-react'
import { Tabs } from '@/ui/components/Tabs'
import GGRChart from './GGRChart'
import DomainBreakdownChart from './DomainBreakdownChart'
import PlayerActivityChart from './PlayerActivityChart'
import styles from '../AgentHome.module.css'

interface PerformanceChartsProps { agentId: string; periodFrom: string; periodTo: string }
const items = [
  { value: 'ggr', label: 'GGR Trends', icon: <IconChartLine size={16} /> },
  { value: 'domain', label: 'Domain Breakdown', icon: <IconChartPie size={16} /> },
  { value: 'activity', label: 'Player Activity', icon: <IconUsers size={16} /> },
] as const
export default function PerformanceCharts({ agentId, periodFrom, periodTo }: PerformanceChartsProps) {
  const [activeTab, setActiveTab] = useState<'ggr' | 'domain' | 'activity'>('ggr')
  return <div className={styles.stack}>
    <div className={styles.tabRail}><Tabs value={activeTab} items={items} onChange={setActiveTab} label="Performance charts" idPrefix="agent-performance" /></div>
    <div role="tabpanel" id={`agent-performance-panel-${activeTab}`} aria-labelledby={`agent-performance-tab-${activeTab}`}>
      {activeTab === 'ggr' && <GGRChart agentId={agentId} periodFrom={periodFrom} periodTo={periodTo} />}
      {activeTab === 'domain' && <DomainBreakdownChart agentId={agentId} periodFrom={periodFrom} periodTo={periodTo} />}
      {activeTab === 'activity' && <PlayerActivityChart agentId={agentId} periodFrom={periodFrom} periodTo={periodTo} />}
    </div>
  </div>
}

