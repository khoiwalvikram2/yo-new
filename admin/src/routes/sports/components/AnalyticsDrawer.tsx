import { useState } from 'react'
import { Card } from '@/ui/components/Card'
import { DataTable } from '@/ui/components/DataTable'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { Stat } from '@/ui/components/Stat'
import { Tabs } from '@/ui/components/Tabs'
import styles from './EventDetailUi.module.css'

interface AnalyticsDrawerProps { visible: boolean; onClose: () => void; eventData?: unknown }
const volumeTrend = [{ time: '10:00', volume: 45000 }, { time: '10:30', volume: 52000 }, { time: '11:00', volume: 68000 }, { time: '11:30', volume: 85000 }, { time: '12:00', volume: 120000 }]
const liquidityDistribution = [{ market: 'Match Odds', percentage: 45, volume: 110000 }, { market: 'Bookmaker', percentage: 30, volume: 75000 }, { market: 'Fancy Markets', percentage: 25, volume: 65000 }]

export function AnalyticsDrawer({ visible, onClose }: AnalyticsDrawerProps) {
  const [tab, setTab] = useState('overview')
  return <Drawer open={visible} onOpenChange={next => { if (!next) onClose() }} title="Event Analytics" size="lg">
    <div className={styles.stack}>
      <Notice tone="info" title="Illustrative preview only">These are the existing sample figures, not live event analytics. No analytics data source is connected to this drawer.</Notice>
      <div className={styles.tabs}><Tabs label="Event analytics tabs" idPrefix="event-analytics" value={tab} onChange={setTab} items={[{ value: 'overview', label: 'Overview' }, { value: 'distribution', label: 'Distribution' }, { value: 'trends', label: 'Trends' }]} /></div>
      <div role="tabpanel" id={`event-analytics-panel-${tab}`} aria-labelledby={`event-analytics-tab-${tab}`} className={styles.stack}>
        {tab === 'overview' ? <>
          <div className={styles.metrics}><Stat label="Sample Peak Volume" value="$120,000" hue="blu" /><Stat label="Sample Avg Growth Rate" value="15.8%" hue="grn" /></div>
          <Card title="Sample Volume Over Time" body="table" headingLevel={3}><DataTable label="Sample volume over time" columns={[{ key: 'time', header: 'Time', cell: row => row.time }, { key: 'volume', header: 'Volume (USD)', align: 'right', cell: row => '$' + (row.volume / 1000).toFixed(0) + 'k' }]} rows={volumeTrend} rowKey={row => row.time} pagination={false} width="narrow" /></Card>
        </> : tab === 'distribution' ? <Card title="Sample Liquidity Distribution by Market Type" body="table" headingLevel={3}><DataTable label="Sample liquidity distribution" columns={[{ key: 'market', header: 'Market', cell: row => row.market }, { key: 'percentage', header: 'Share', align: 'right', cell: row => row.percentage + '%' }, { key: 'volume', header: 'Volume (USD)', align: 'right', cell: row => '$' + (row.volume / 1000).toFixed(0) + 'k' }]} rows={liquidityDistribution} rowKey={row => row.market} pagination={false} width="narrow" /></Card>
        : <EmptyState title="Trend analysis coming soon" description="No live trend-analysis data is available in this drawer." />}
      </div>
    </div>
  </Drawer>
}

