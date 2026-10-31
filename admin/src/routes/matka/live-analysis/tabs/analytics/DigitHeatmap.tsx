import clsx from 'clsx'
import { Card } from '@/ui/components/Card'
import { Tooltip } from '@/ui/components/Tooltip'
import styles from '../../MatkaLiveUi.module.css'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

interface DigitHeatmapProps {
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

export const DigitHeatmap: React.FC<DigitHeatmapProps> = ({ breakdown }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const mask = (v: number) => (hasFinanceView ? formatAmount(convertFromWhitelabelCurrency(v)) : '••••')

  // Create a map of all digits 0-9
  const digitMap = useMemo(() => {
    const map = new Map<string, { wagered: number; exposure: number; bets: number }>()
    
    // Initialize all digits 0-9
    for (let i = 0; i <= 9; i++) {
      map.set(String(i), { wagered: 0, exposure: 0, bets: 0 })
    }
    
    // Populate with actual data
    if (breakdown?.byDigit) {
      breakdown.byDigit.forEach(d => {
        if (map.has(d.digit)) {
          const existing = map.get(d.digit)!
          map.set(d.digit, {
            wagered: existing.wagered + d.wagered,
            exposure: existing.exposure + d.exposure,
            bets: existing.bets + d.bets,
          })
        }
      })
    }
    
    return map
  }, [breakdown])

  const maxExposure = Math.max(...Array.from(digitMap.values()).map(d => d.exposure), 1)

  const getIntensity = (value: number, max: number) => {
    if (max === 0) return 0
    return Math.min(100, (value / max) * 100)
  }

  const getColor = (intensity: number) => intensity === 0 ? styles.heatNeutral : intensity < 20 ? styles.heatLow : intensity < 40 ? styles.heatModerate : intensity < 60 ? styles.heatElevated : intensity < 80 ? styles.heatHigh : styles.heatCritical
  return <Card title="Digit Heatmap" sub="Real-time digit activity & exposure">
    <div className={styles.heatGrid}>{Array.from({ length: 10 }, (_, i) => String(i)).map(digit => {
      const data = digitMap.get(digit) || { wagered: 0, exposure: 0, bets: 0 }
      const exposureIntensity = getIntensity(data.exposure, maxExposure)
      return <Tooltip key={digit} content={<div className={styles.stack}><strong>Digit #{digit}</strong><span>Bets: {data.bets}</span><span>Wagered: {mask(data.wagered)}</span><span>Exposure: {mask(data.exposure)}</span></div>}>
        <div tabIndex={0} className={clsx(styles.heatCell, getColor(exposureIntensity), data.bets > 0 && styles.heatActive)} aria-label={`Digit ${digit}: ${data.bets} bets, exposure ${mask(data.exposure)}`}>
          <span className={styles.heatNumber}>#{digit}</span><span>{data.bets} bets</span>{data.exposure > 0 && <span>{mask(data.exposure)}</span>}
        </div>
      </Tooltip>
    })}</div>
    <div className={styles.footer}><p className={styles.muted}>Color intensity based on exposure · Low to high · {Array.from(digitMap.values()).filter(d => d.bets > 0).length}/10 digits active</p></div>
  </Card>
}

