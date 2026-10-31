import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

interface DigitAnalyticsProps {
  breakdown?: {
    byDigit: Array<{
      digit: string
      wagered: number
      payouts: number
      exposure: number
      bets: number
    }>
  }
}

export const DigitAnalytics: React.FC<DigitAnalyticsProps> = ({ breakdown }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const mask = (v: number) => (hasFinanceView ? formatAmount(convertFromWhitelabelCurrency(v)) : '••••')

  const digitData = useMemo(() => {
    if (!breakdown?.byDigit) return []
    
    return breakdown.byDigit
      .map(d => ({
        digit: d.digit,
        wagered: d.wagered,
        payouts: d.payouts,
        exposure: d.exposure,
        bets: d.bets,
        popularity: d.bets, // For sorting by popularity
      }))
      .sort((a, b) => b.exposure - a.exposure) // Sort by exposure (risk)
  }, [breakdown])

  // Hot digits (most bets)
  const hotDigits = useMemo(() => {
    return [...digitData].sort((a, b) => b.popularity - a.popularity).slice(0, 10)
  }, [digitData])

  // Cold digits (least bets)
  const coldDigits = useMemo(() => {
    return [...digitData].sort((a, b) => a.popularity - b.popularity).slice(0, 10)
  }, [digitData])

  // Risky digits (highest exposure)
  const riskyDigits = useMemo(() => {
    return [...digitData].sort((a, b) => b.exposure - a.exposure).slice(0, 10)
  }, [digitData])

  const maxExposure = Math.max(...digitData.map(d => d.exposure), 1)
  if (!digitData.length) return <Card title="Digit Analytics" sub="Hot/Cold digits & exposure"><EmptyState title="No digit data available" /></Card>
  return <div className={styles.stack}><div className={styles.grid2}>
    {[{ title: 'Hot Digits', sub: 'Most Bets', rows: hotDigits }, { title: 'Cold Digits', sub: 'Least Bets', rows: coldDigits }].map(group => <Card key={group.title} title={group.title} sub={group.sub}><ol className={styles.list}>{group.rows.map((digit, idx) => <li className={styles.item} key={digit.digit}><div className={styles.row}><span className={styles.inline}><span className={styles.rank}>{idx + 1}</span><strong>#{digit.digit}</strong></span><span className={styles.amount}>{digit.bets} bets</span></div></li>)}</ol></Card>)}
    </div><Card title="Risky Digits (High Exposure)" sub="Digits with highest exposure"><ol className={styles.list}>{riskyDigits.map((digit, idx) => <li className={styles.item} key={digit.digit}>
      <div className={styles.inline}><span className={styles.rank}>{idx + 1}</span><h3 className={styles.heading}>Digit #{digit.digit}</h3></div>
      <DescriptionList items={[{ term: 'Bets', value: digit.bets }, { term: 'Exposure', value: <span className={styles.negative}>{mask(digit.exposure)}</span> }, { term: 'Wagered', value: mask(digit.wagered) }]} />
      <Meter value={digit.exposure / maxExposure * 100} tone="neg" label={`Exposure intensity for digit ${digit.digit}`} />
    </li>)}</ol></Card>
  </div>
}

