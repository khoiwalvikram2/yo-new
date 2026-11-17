import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { Stat } from '@/ui/components/Stat'
import React, { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

interface MatkaAnalyticsProps {
  breakdown?: {
    byMatka: Array<{
      matkaId: string
      matkaName?: string | null
      wagered: number
      payouts: number
      ggr: number
      /** What the open bets pay if they all win; null on an older cached snapshot. */
      potentialPayouts?: number | null
      bets: number
    }>
  }
}

// Net liability if every open bet wins, the /matka/live tile rule. `payouts` counts settled wins only, so it is 0 on
// open bets and says nothing about exposure.
const exposureOf = (matka: { wagered: number; potentialPayouts?: number | null }) => Math.max(0, (matka.potentialPayouts ?? 0) - matka.wagered)

export const MatkaAnalytics: React.FC<MatkaAnalyticsProps> = ({ breakdown }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const mask = (v: number) => (hasFinanceView ? formatAmount(convertFromWhitelabelCurrency(v)) : '••••')

  const topMatkas = useMemo(() => {
    if (!breakdown?.byMatka) return []
    return [...breakdown.byMatka]
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 10)
  }, [breakdown])

  const maxMatkaWagered = Math.max(...topMatkas.map(m => m.wagered), 1)
  const totalWagered = topMatkas.reduce((sum, m) => sum + m.wagered, 0)
  const totalExposure = topMatkas.reduce((sum, m) => sum + exposureOf(m), 0)

  return <Card title="Matka Analytics" sub="Individual matka performance">
    {topMatkas.length === 0 ? <EmptyState title="No matka data yet" /> : <ol className={styles.list}>
      {topMatkas.map((matka, idx) => {
        const percentage = matka.wagered / maxMatkaWagered * 100
        const exposure = exposureOf(matka)
        const exposurePercent = totalWagered > 0 ? matka.wagered / totalWagered * 100 : 0
        return <li key={matka.matkaId} className={styles.item}>
          <div className={styles.inline}><span className={styles.rank}>{idx + 1}</span><h3 className={styles.heading}>{matka.matkaName || `Matka #${matka.matkaId.slice(0, 8)}`}</h3></div>
          <p className={styles.muted}>{matka.bets} bets · {exposurePercent.toFixed(1)}% of total</p>
          <DescriptionList items={[{ term: 'Exposure', value: <span className={styles.negative}>{mask(exposure)}</span> }, { term: 'Wagered', value: mask(matka.wagered) }, { term: 'Potential Payouts', value: mask(matka.potentialPayouts ?? 0) }, { term: 'Payouts', value: mask(matka.payouts) }, { term: 'Bets', value: matka.bets }]} />
          <Meter value={percentage} label={`Wagered intensity for ${matka.matkaName || matka.matkaId}`} />
        </li>
      })}
    </ol>}
    {topMatkas.length > 0 && <div className={styles.footer}><div className={styles.grid3}><Stat variant="bare" size="compact" label="Active Matkas" value={topMatkas.length} /><Stat variant="bare" size="compact" label="Total Wagered" value={mask(totalWagered)} /><Stat variant="bare" size="compact" label="Total Exposure" value={mask(totalExposure)} /></div></div>}
  </Card>
}

