import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Meter } from '@/ui/components/Meter'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../../CasinoLive.module.css'
interface VendorChartsProps {
  breakdown?: {
    byVendor: Array<{
      vendorId: string
      vendorName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
}

export function VendorCharts({ breakdown }: VendorChartsProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const vendorData = useMemo(() => {
    if (!breakdown?.byVendor) return []
    
    return breakdown.byVendor
      .map(vendor => ({
        name: vendor.vendorName || 'Unknown Vendor',
        wagered: vendor.wagered,
        ggr: vendor.ggr,
        bets: vendor.bets,
        payouts: vendor.payouts,
        rtp: vendor.wagered > 0 ? (vendor.payouts / vendor.wagered) * 100 : 0,
        margin: vendor.wagered > 0 ? (vendor.ggr / vendor.wagered) * 100 : 0,
      }))
      .sort((a, b) => b.wagered - a.wagered)
  }, [breakdown])


  const maxWagered = Math.max(...vendorData.map(vendor => vendor.wagered), 1)
  const maxBets = Math.max(...vendorData.map(vendor => vendor.bets), 1)
  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  return <Card title="Vendor Analytics" sub={`${vendorData.length} vendors`}>{!vendorData.length ? <EmptyState title="No vendor data available" /> : <div className={styles.stack}><h3 className={styles.heading}>Volume Distribution</h3>{vendorData.map((vendor, index) => <article key={vendor.name} className={styles.details}><div className={styles.feedTop}><div className={styles.actions}><StatusPill tone="info">#{index + 1}</StatusPill><strong>{vendor.name}</strong><StatusPill tone={vendor.ggr >= 0 ? 'ok' : 'neg'}>{vendor.margin >= 0 ? '+' : ''}{vendor.margin.toFixed(1)}%</StatusPill></div><strong>{fmt(vendor.wagered)}</strong></div><Meter value={vendor.wagered / maxWagered * 100} /></article>)}<h3 className={styles.heading}>Activity Levels</h3>{vendorData.map((vendor, index) => <article key={vendor.name} className={styles.details}><div className={styles.actions}><StatusPill tone="info">#{index + 1}</StatusPill><strong>{vendor.name}</strong></div><div className={styles.grid2}><Stat variant="bare" size="compact" label="Bets" value={vendor.bets.toLocaleString()} /><div className={styles.details}><span className={styles.muted}>RTP</span><StatusPill tone={vendor.rtp < 95 ? 'ok' : vendor.rtp < 105 ? 'info' : 'neg'}>{vendor.rtp.toFixed(1)}%</StatusPill></div></div><Meter value={vendor.bets / maxBets * 100} /></article>)}</div>}</Card>
}

