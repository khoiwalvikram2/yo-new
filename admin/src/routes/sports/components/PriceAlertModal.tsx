import { useState } from 'react'
import { IconBell, IconTrash } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Dialog } from '@/ui/components/Dialog'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { StatusPill } from '@/ui/components/StatusPill'
import { toast } from '@/ui/components/toast'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useSportsEventsStore } from '@/state/sportsEventsStore'
import styles from './EventDetailUi.module.css'

interface PriceAlertModalProps { visible: boolean; onClose: () => void; marketId?: string; marketName?: string }
export function PriceAlertModal({ visible, onClose, marketId, marketName }: PriceAlertModalProps) {
  const [targetPrice, setTargetPrice] = useState<number | null>(null)
  const [condition, setCondition] = useState<'above' | 'below'>('above')
  const [error, setError] = useState('')
  const { formatDateTime } = useFormatDate()
  const { addPriceAlert, removePriceAlert, getPriceAlerts } = useSportsEventsStore()
  const alerts = marketId ? getPriceAlerts(marketId) : getPriceAlerts()
  function create() {
    if (!marketId || !marketName) return
    if (targetPrice === null || targetPrice < 1.01 || targetPrice > 1000) { setError('Enter a target price from 1.01 to 1,000.'); return }
    addPriceAlert({ marketId, marketName, targetPrice, condition })
    toast({ tone: 'ok', title: 'Price Alert Created', message: `Alert saved for ${marketName} at ${targetPrice}.` })
    setTargetPrice(null); setCondition('above'); setError('')
  }
  return <Dialog open={visible} onOpenChange={next => { if (!next) onClose() }} title="Price Alerts" size="md">
    <div className={styles.stack}>
      {marketId && marketName && <Card title="Create New Alert" headingLevel={3}><form className={styles.stack} onSubmit={event => { event.preventDefault(); create() }}>
        <p className={styles.muted}>{marketName}</p>
        <NumberField label="Target Price" value={targetPrice} onChange={setTargetPrice} min={1.01} max={1000} step={0.01} required placeholder="Enter target price (e.g., 2.50)" />
        <div className={styles.tabs}><SegmentedControl label="Notify When Price Is" value={condition} onChange={setCondition} options={[{ value: 'above', label: 'Above Target' }, { value: 'below', label: 'Below Target' }]} /></div>
        {error && <Notice tone="error" live="assertive">{error}</Notice>}
        <Button type="submit" variant="primary" icon={<IconBell size={16} />}>Create Alert</Button>
      </form></Card>}
      <Card title={`Active Alerts (${alerts.length})`} headingLevel={3}>
        {!alerts.length ? <EmptyState title="No active alerts" /> : <ul className={styles.list}>{alerts.map(alert => <li key={alert.id} className={styles.listItem}>
          <div className={styles.between}><strong>{alert.marketName}</strong><Button variant="danger" size="sm" icon={<IconTrash size={16} />} onClick={() => removePriceAlert(alert.id)}>Remove</Button></div>
          <div className={styles.row}><StatusPill tone="info">Target: {alert.targetPrice}</StatusPill><StatusPill tone={alert.condition === 'above' ? 'ok' : 'neg'}>{alert.condition === 'above' ? '↑ Above' : '↓ Below'}</StatusPill><span className={styles.muted}>{formatDateTime(alert.createdAt)}</span></div>
        </li>)}</ul>}
      </Card>
    </div>
  </Dialog>
}

