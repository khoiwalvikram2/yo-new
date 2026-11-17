import type { MatkaBetsData, MatkaBet } from '../../liveUiModel'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { Meter } from '@/ui/components/Meter'
import styles from '../../MatkaLiveUi.module.css'
import { useQuery } from '@apollo/client'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { gql } from '@apollo/client'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

const MATKA_BETS_QUERY = gql`
  query MatkaBets($query: MatkaBetsQuery) {
    matkaBets(query: $query) {
      userId
      userName
      betAmount
      potentialWin
      createdAt
    }
  }
`

export const PlayerProfitability: React.FC = () => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data, loading } = useQuery<MatkaBetsData>(MATKA_BETS_QUERY, {
    variables: {
      query: {
        statuses: ['pending', 'active'],
        limit: 10000,
      },
    },
    pollInterval: 30000,
    fetchPolicy: "network-only",
  })

  const riskAnalysis = useMemo(() => {
    const bets = data?.matkaBets || []
    const playerMap = new Map<string, {
      userId: string
      userName: string
      wagered: number
      potentialPayouts: number
      exposure: number
      bets: number
    }>()

    bets.forEach((bet: MatkaBet) => {
      const userId = String(bet.userId)
      const stats = playerMap.get(userId) || {
        userId,
        userName: bet.userName || `User #${userId}`,
        wagered: 0,
        potentialPayouts: 0,
        exposure: 0,
        bets: 0,
      }

      stats.wagered += Number(bet.betAmount) || 0
      stats.potentialPayouts += Number(bet.potentialWin || 0)
      stats.bets += 1

      playerMap.set(userId, stats)
    })

    // Exposure is the net liability if every open bet wins: what they pay minus what was staked, never below 0
    // (MAT-13; the /matka/live Exposure tile's rule). Stake minus payout was always 0, as potentialWin >= betAmount.
    const players = Array.from(playerMap.values()).map(stats => ({
      ...stats,
      exposure: Math.max(0, stats.potentialPayouts - stats.wagered),
    }))

    const totalExposure = players.reduce((sum, p) => sum + p.exposure, 0)
    const totalWagered = players.reduce((sum, p) => sum + p.wagered, 0)
    const totalPotentialPayouts = players.reduce((sum, p) => sum + p.potentialPayouts, 0)
    const totalPlayers = players.length

    // Top risk players (by exposure)
    const topRiskPlayers = [...players]
      .sort((a, b) => b.exposure - a.exposure)
      .slice(0, 10)
      .map((p, idx) => ({
        ...p,
        rank: idx + 1,
        contribution: totalExposure > 0 ? (p.exposure / totalExposure) * 100 : 0,
      }))

    // Risk segments (by exposure level)
    const highRisk = players.filter(p => p.exposure > 1000).length
    const mediumRisk = players.filter(p => p.exposure > 100 && p.exposure <= 1000).length
    const lowRisk = players.filter(p => p.exposure <= 100).length

    // Average metrics
    const avgExposure = totalPlayers > 0 ? totalExposure / totalPlayers : 0
    const avgWagered = totalPlayers > 0 ? totalWagered / totalPlayers : 0
    const avgPotentialPayouts = totalPlayers > 0 ? totalPotentialPayouts / totalPlayers : 0

    return {
      totalPlayers,
      totalExposure,
      totalWagered,
      totalPotentialPayouts,
      topRiskPlayers,
      segments: {
        highRisk,
        mediumRisk,
        lowRisk,
        highRiskPercentage: totalPlayers > 0 ? (highRisk / totalPlayers) * 100 : 0,
      },
      averages: {
        exposure: avgExposure,
        wagered: avgWagered,
        potentialPayouts: avgPotentialPayouts,
      },
    }
  }, [data])

  const maskAmount = (amount: number) => {
    return hasFinanceView ? formatAmount(convertFromWhitelabelCurrency(amount)) : '••••'
  }

  const pending = loading && !data
  return <div className={styles.stack}>
    <div className={styles.grid2} aria-busy={pending || undefined}><Stat label="Total Players" value={riskAnalysis.totalPlayers} hue="blu" loading={pending} /><Stat label="Total Exposure" value={maskAmount(riskAnalysis.totalExposure)} hue="red" loading={pending} /><Stat label="Avg Exposure" value={maskAmount(riskAnalysis.averages.exposure)} hue="amb" loading={pending} /><Stat label="Total Potential Payouts" value={maskAmount(riskAnalysis.totalPotentialPayouts)} hue="vio" loading={pending} /></div>
    <Card title="Risk Segments" sub="Player exposure distribution"><div className={styles.grid3} aria-busy={pending || undefined}><Stat variant="bare" label="High Risk" value={riskAnalysis.segments.highRisk} note={`${riskAnalysis.segments.highRiskPercentage.toFixed(1)}%`} hue="red" loading={pending} /><Stat variant="bare" label="Medium Risk" value={riskAnalysis.segments.mediumRisk} note={`${riskAnalysis.totalPlayers > 0 ? (riskAnalysis.segments.mediumRisk / riskAnalysis.totalPlayers * 100).toFixed(1) : 0}%`} hue="amb" loading={pending} /><Stat variant="bare" label="Low Risk" value={riskAnalysis.segments.lowRisk} note={`${riskAnalysis.totalPlayers > 0 ? (riskAnalysis.segments.lowRisk / riskAnalysis.totalPlayers * 100).toFixed(1) : 0}%`} hue="grn" loading={pending} /></div></Card>
    <Card title="Top Risk Players" sub="Players with highest exposure">{pending ? <LoadingState label="Loading risk analysis data..." /> : !riskAnalysis.topRiskPlayers.length ? <EmptyState title="No risk data" /> : <ol className={styles.list}>{riskAnalysis.topRiskPlayers.map(player => <li key={player.userId} className={styles.item}><div className={styles.inline}><span className={styles.rank}>{player.rank}</span><h3 className={styles.heading}>{player.userName}</h3></div><DescriptionList items={[{ term: 'Exposure', value: maskAmount(player.exposure) }, { term: 'Contribution', value: `${player.contribution.toFixed(1)}%` }]} /><Meter value={player.contribution} tone="neg" label={`Exposure contribution of ${player.userName}`} /></li>)}</ol>}</Card>
  </div>
}

