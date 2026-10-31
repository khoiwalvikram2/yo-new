import { useMemo } from 'react'
import { gql, useQuery } from '@apollo/client'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { nowIST } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { Meter } from '@/ui/components/Meter'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import type { CasinoBet } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
const CASINO_BETS_QUERY = gql`
  query CasinoBets($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      id
      vendorName
      stake
      payout
      createdAt
    }
  }
`

interface VendorAnalyticsProps {
  windowMins: number
}

interface VendorMetrics {
  vendorName: string
  bets: number
  wagered: number
  payouts: number
  ggr: number
  rtp: number
  avgBet: number
  profitMargin: number
  marketShare: number
  betsPerMin: number
  efficiency: number
}

export function VendorAnalytics({ windowMins }: VendorAnalyticsProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const dateFrom = useMemo(() => nowIST().subtract(windowMins, 'minute').toISOString(), [windowMins])
  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data } = useQuery<{ casinoBets: CasinoBet[] }>(CASINO_BETS_QUERY, {
    variables: { query: { dateFrom, limit: 1000 } },
    pollInterval: 5000,
    fetchPolicy: "network-only",
  })

  const { vendorMetrics } = useMemo(() => {
    const bets = data?.casinoBets || []
    const map = new Map<string, { vendorName: string; bets: number; wagered: number; payouts: number }>()
    for (const b of bets) {
      const name = b.vendorName || 'Unknown'
      const rec = map.get(name) || { vendorName: name, bets: 0, wagered: 0, payouts: 0 }
      rec.bets += 1
      rec.wagered += Number(b.stake) || 0
      rec.payouts += Number(b.payout) || 0
      map.set(name, rec)
    }
    const totalWagered = Array.from(map.values()).reduce((s, r) => s + r.wagered, 0)
    const totalPayouts = Array.from(map.values()).reduce((s, r) => s + r.payouts, 0)
    const result: VendorMetrics[] = Array.from(map.values()).map(r => {
      const ggr = r.wagered - r.payouts
      return {
        vendorName: r.vendorName,
        bets: r.bets,
        wagered: r.wagered,
        payouts: r.payouts,
        ggr,
        rtp: r.wagered > 0 ? (r.payouts / r.wagered) * 100 : 0,
        avgBet: r.bets > 0 ? r.wagered / r.bets : 0,
        profitMargin: r.wagered > 0 ? (ggr / r.wagered) * 100 : 0,
        marketShare: totalWagered > 0 ? (r.wagered / totalWagered) * 100 : 0,
        betsPerMin: windowMins > 0 ? r.bets / windowMins : 0,
        efficiency: ggr, // simple proxy (GGR); could divide by games count if available
      }
    }).sort((a, b) => b.wagered - a.wagered)
    return {
      vendorMetrics: result,
      totals: {
        totalVendors: result.length,
        totalBets: result.reduce((s, v) => s + v.bets, 0),
        totalWagered,
        totalPayouts,
        totalGgr: totalWagered - totalPayouts,
        rtp: totalWagered > 0 ? (totalPayouts / totalWagered) * 100 : 0,
      },
    }
  }, [data, windowMins])

  const topVendor = vendorMetrics[0]
  const totalVendors = vendorMetrics.length


  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  return <Card title="Vendor Performance Analytics">{!vendorMetrics.length ? <EmptyState title="No vendor performance data available" /> : <div className={styles.stack}><div className={styles.grid3}><Stat variant="bare" label="Total Vendors" value={totalVendors} note="Active in current window" size="compact" hue="blu" /><Stat variant="bare" label="Top Vendor" value={topVendor.vendorName} note={`${topVendor.marketShare.toFixed(1)}% share`} size="compact" hue="grn" /><Stat variant="bare" label="Best Margin" value={`${Math.max(...vendorMetrics.map(vendor => vendor.profitMargin)).toFixed(2)}%`} note={vendorMetrics.find(vendor => vendor.profitMargin === Math.max(...vendorMetrics.map(item => item.profitMargin)))?.vendorName} size="compact" /></div>
    <h3 className={styles.heading}>Market Share Distribution</h3>{vendorMetrics.map((vendor, index) => <article key={vendor.vendorName} className={styles.details}><div className={styles.feedTop}><div className={styles.actions}><StatusPill tone="info">#{index + 1}</StatusPill><strong>{vendor.vendorName}</strong></div><span className={styles.muted}>{vendor.bets.toLocaleString()} bets • {fmt(vendor.wagered)}</span></div><div className={styles.details}><span className={styles.muted}>{vendor.marketShare.toFixed(1)}%</span><Meter value={Number(vendor.marketShare.toFixed(1))} /></div></article>)}
    <div className={styles.grid2}><section className={styles.stack}><h3 className={styles.heading}>Top Performers by GGR</h3>{vendorMetrics.slice(0, 10).map((vendor, index) => <article key={vendor.vendorName} className={styles.details}><div className={styles.feedTop}><strong>#{index + 1} {vendor.vendorName}</strong><strong className={vendor.ggr >= 0 ? styles.positive : styles.negative}>{fmt(vendor.ggr)}</strong></div><div className={styles.feedTop}><span className={styles.muted}>{vendor.profitMargin.toFixed(2)}% margin</span><span className={styles.muted}>{vendor.bets.toLocaleString()} bets</span></div></article>)}</section>
      <section className={styles.stack}><h3 className={styles.heading}>Most Efficient Vendors</h3>{[...vendorMetrics].sort((a, b) => b.efficiency - a.efficiency).slice(0, 10).map(vendor => <article key={vendor.vendorName} className={styles.details}><div className={styles.feedTop}><strong>{vendor.vendorName}</strong><strong>{fmt(vendor.efficiency)}</strong></div><div className={styles.feedTop}><span className={styles.muted}>{vendor.bets.toLocaleString()} bets</span><span className={styles.muted}>GGR</span></div></article>)}</section>
    </div>
  </div>}</Card>
}
