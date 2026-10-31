import { useState } from 'react'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Dialog } from '@/ui/components/Dialog'
import { NumberField } from '@/ui/components/NumberField'
import { Select } from '@/ui/components/Select'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Stat } from '@/ui/components/Stat'
import { Notice } from '@/ui/components/Notice'
import { calculateProfit, type ProfitCalculation } from './eventDetailModel'
import styles from './EventDetailUi.module.css'

interface ProfitCalculatorProps { visible: boolean; onClose: () => void }
export function ProfitCalculator({ visible, onClose }: ProfitCalculatorProps) {
  const [betType, setBetType] = useState<'back' | 'lay'>('back')
  const [stake, setStake] = useState<number | null>(100)
  const [odds, setOdds] = useState<number | null>(2)
  const [commission, setCommission] = useState<number | null>(2)
  const [results, setResults] = useState<ProfitCalculation | null>(null)
  const [error, setError] = useState('')
  function reset() { setStake(100); setOdds(2); setCommission(2); setBetType('back'); setResults(null); setError('') }
  function calculate() {
    if (stake === null || odds === null || stake < 1 || stake > 1000000 || odds < 1.01 || odds > 1000 || (commission !== null && (commission < 0 || commission > 20))) {
      setError('Enter stake from 1 to 1,000,000, odds from 1.01 to 1,000, and commission from 0 to 20%.')
      return
    }
    setError('')
    setResults(calculateProfit(betType, stake, odds, commission ?? 0))
  }
  return <Dialog open={visible} onOpenChange={next => { if (!next) onClose() }} title="Profit Calculator" description="Local USD estimate only. This does not place or settle a bet." size="lg">
    <div className={styles.stack}>
      <Card><form className={styles.stack} onSubmit={event => { event.preventDefault(); calculate() }}>
        <div className={styles.tabs}><SegmentedControl label="Bet Type" value={betType} onChange={value => { setBetType(value); setResults(null) }} options={[{ value: 'back', label: 'Back (Bet For)' }, { value: 'lay', label: 'Lay (Bet Against)' }]} /></div>
        <div className={styles.metrics}>
          <NumberField label="Stake Amount ($)" value={stake} onChange={setStake} min={1} max={1000000} required />
          <NumberField label="Odds" value={odds} onChange={setOdds} min={1.01} max={1000} step={0.01} required />
          <NumberField label="Commission (%)" value={commission} onChange={setCommission} min={0} max={20} step={0.5} />
          <Select label="Quick Stakes" layout="stacked" value="" placeholder="Select quick stake" onChange={value => setStake(Number(value))} options={[10, 25, 50, 100, 250, 500, 1000].map(value => ({ value: String(value), label: '$' + value.toLocaleString('en-US') }))} />
        </div>
        {error && <Notice tone="error" live="assertive">{error}</Notice>}
        <div className={styles.row}><Button variant="primary" type="submit">Calculate</Button><Button onClick={reset}>Reset</Button></div>
      </form></Card>
      {results && <Card title="Calculation Results" headingLevel={3}><div className={styles.stack}>
        <div className={styles.metrics}>
          <Stat label={results.side === 'back' ? 'Net Profit (if wins)' : 'Profit (if loses)'} value={'$' + results.profit} variant="bare" hue="grn" />
          <Stat label={results.side === 'back' ? 'Total Return' : 'Liability'} value={'$' + (results.side === 'back' ? results.totalReturn : results.liability)} variant="bare" hue="blu" />
          <Stat label={results.side === 'back' ? 'Loss (if loses)' : 'Loss (if wins)'} value={'$' + results.loss} variant="bare" hue="red" />
          <Stat label="ROI" value={results.roi + '%'} variant="bare" hue="vio" />
        </div>
        <div className={styles.stack}>
          <p>{results.side === 'back' ? 'Back Bet: You win if the selection wins.' : 'Lay Bet: You win if the selection loses.'}</p>
          <p className={styles.muted}>{results.side === 'back' ? 'Profit = (Stake × Odds - Stake) × (1 - Commission%). Loss = Your stake amount.' : 'Profit = Stake × (1 - Commission%). Liability = Stake × (Odds - 1).'}</p>
        </div>
      </div></Card>}
    </div>
  </Dialog>
}

