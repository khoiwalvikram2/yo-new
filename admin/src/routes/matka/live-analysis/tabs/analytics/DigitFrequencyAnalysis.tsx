import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { Stat } from '@/ui/components/Stat'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

interface DigitFrequencyAnalysisProps {
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

export const DigitFrequencyAnalysis: React.FC<DigitFrequencyAnalysisProps> = ({ breakdown }) => {
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
        frequency: d.bets, // Frequency = number of bets
      }))
      .sort((a, b) => b.frequency - a.frequency) // Sort by frequency
  }, [breakdown])

  const totalBets = digitData.reduce((sum, d) => sum + d.bets, 0)
  const maxFrequency = Math.max(...digitData.map(d => d.frequency), 1)
  return <Card title="Digit Frequency Analysis" sub={`${digitData.length} digits active · Most bet digits & frequency distribution`}>
    {!digitData.length ? <EmptyState title="No digit data available" /> : <div className={styles.stack}>
      <ol className={styles.list}>{digitData.map(digit => {
        const frequencyPercent = totalBets > 0 ? digit.frequency / totalBets * 100 : 0
        const intensityPercent = digit.frequency / maxFrequency * 100
        return <li key={digit.digit} className={styles.item}>
          <h3 className={styles.heading}>Digit #{digit.digit}</h3>
          <DescriptionList items={[{ term: 'Bets', value: digit.frequency }, { term: 'Share of total', value: `${frequencyPercent.toFixed(1)}%` }, { term: 'Exposure', value: mask(digit.exposure) }, { term: 'Wagered', value: mask(digit.wagered) }]} />
          <div className={styles.row}><span className={styles.muted}>Relative frequency</span><span className={styles.amount}>{intensityPercent.toFixed(0)}%</span></div><Meter value={intensityPercent} label={`Relative frequency of digit ${digit.digit}`} />
        </li>
      })}</ol>
      <div className={styles.grid3}><Stat variant="bare" size="compact" label="Total Bets" value={totalBets} /><Stat variant="bare" size="compact" label="Active Digits" value={digitData.length} /><Stat variant="bare" size="compact" label="Avg Bets/Digit" value={totalBets > 0 ? (totalBets / digitData.length).toFixed(1) : '0'} /></div>
    </div>}
  </Card>
}

