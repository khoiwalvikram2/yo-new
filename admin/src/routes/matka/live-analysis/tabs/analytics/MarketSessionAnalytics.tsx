import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import { StatusPill } from '@/ui/components/StatusPill'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

interface MarketSessionAnalyticsProps {
  breakdown?: {
    bySession: Array<{
      marketSession: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
}

export const MarketSessionAnalytics: React.FC<MarketSessionAnalyticsProps> = ({ breakdown }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const mask = (v: number) => (hasFinanceView ? formatAmount(convertFromWhitelabelCurrency(v)) : '••••')

  const sessionData = useMemo(() => {
    if (!breakdown?.bySession) return []
    
    return breakdown.bySession
      .map(s => ({
        session: s.marketSession || 'NO_SESSION',
        displayName: s.marketSession ? s.marketSession.toUpperCase() : 'No Session',
        wagered: s.wagered,
        payouts: s.payouts,
        exposure: Math.max(0, s.wagered - s.payouts),
        bets: s.bets,
      }))
      .sort((a, b) => b.wagered - a.wagered)
  }, [breakdown])

  const totalWagered = sessionData.reduce((sum, s) => sum + s.wagered, 0)
  if (!sessionData.length) return <Card title="Market Session Analytics" sub="OPEN vs CLOSE performance"><EmptyState title="No session data available" /></Card>
  return <div className={styles.stack}><div className={styles.grid2}>
    {sessionData.map(session => {
      const wageredPercent = totalWagered > 0 ? session.wagered / totalWagered * 100 : 0
      const isOpen = session.session.toUpperCase().includes('OPEN')
      const isClose = session.session.toUpperCase().includes('CLOSE')
      return <Card key={session.session} title={session.displayName} sub={`${session.bets} bets`} tools={<StatusPill tone={isOpen ? 'ok' : isClose ? 'warn' : 'neutral'}>{wageredPercent.toFixed(1)}%</StatusPill>}>
        <div className={styles.stack}><DescriptionList items={[{ term: 'Wagered', value: mask(session.wagered) }, { term: 'Potential Payouts', value: mask(session.payouts) }, { term: 'Exposure', value: <span className={styles.negative}>{mask(session.exposure)}</span> }]} /><Meter value={wageredPercent} tone={isClose ? 'warn' : 'acc'} label={`Wagered share for ${session.displayName}`} /></div>
      </Card>
    })}
  </div>{sessionData.length > 1 && <Card title="Session Comparison" sub="Activity distribution"><ul className={styles.list}>{sessionData.map(session => {
    const wageredPercent = totalWagered > 0 ? session.wagered / totalWagered * 100 : 0
    return <li key={session.session} className={styles.item}><h3 className={styles.heading}>{session.displayName}</h3><DescriptionList items={[{ term: 'Wagered', value: mask(session.wagered) }, { term: 'Bets', value: session.bets }, { term: 'Share', value: `${wageredPercent.toFixed(1)}%` }]} /><Meter value={wageredPercent} label={`Comparison share for ${session.displayName}`} /></li>
  })}</ul></Card>}</div>
}

