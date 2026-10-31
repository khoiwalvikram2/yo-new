import clsx from 'clsx'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import React, { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'

interface BidTypeAnalyticsProps {
  breakdown?: {
    byBidType: Array<{
      bidType: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
}

export const BidTypeAnalytics: React.FC<BidTypeAnalyticsProps> = ({ breakdown }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const topBidTypes = useMemo(() => {
    if (!breakdown?.byBidType) return []
    return [...breakdown.byBidType]
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 10)
  }, [breakdown])

  const maxBidTypeWagered = Math.max(...topBidTypes.map(b => b.wagered), 1)

  return <Card title="Bid Type Analytics" sub="Volume & performance">
    {topBidTypes.length === 0 ? <EmptyState title="No bid type data yet" /> : <ol className={styles.list}>
      {topBidTypes.map((bidType, idx) => <li key={bidType.bidType} className={styles.item}>
        <div className={styles.inline}><span className={styles.rank}>{idx + 1}</span><h3 className={styles.heading}>{bidType.bidType}</h3></div>
        <DescriptionList items={[{ term: 'Volume', value: formatAmount(convertFromWhitelabelCurrency(bidType.wagered)) }, { term: 'GGR', value: <span className={clsx(styles.amount, bidType.ggr > 0 ? styles.positive : styles.negative)}>{formatAmount(convertFromWhitelabelCurrency(bidType.ggr))}</span> }, { term: 'Bets', value: bidType.bets }]} />
        <Meter value={bidType.wagered / maxBidTypeWagered * 100} label={`Volume intensity for ${bidType.bidType}`} />
      </li>)}
    </ol>}
  </Card>
}

