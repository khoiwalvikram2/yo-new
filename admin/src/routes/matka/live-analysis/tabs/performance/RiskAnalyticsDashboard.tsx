import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { Meter } from '@/ui/components/Meter'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'

interface RiskAnalyticsDashboardProps {
  kpis?: {
    wagered: number
    payouts: number
    ggr: number
    rtp: number
    activePlayers: number
  }
  breakdown?: {
    byType?: Array<{
      matkaType: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byMatka?: Array<{
      matkaId: string
      matkaName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
}

export const RiskAnalyticsDashboard: React.FC<RiskAnalyticsDashboardProps> = ({
  kpis,
  breakdown,
}) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  // Calculate exposure limits
  const exposureMetrics = useMemo(() => {
    if (!kpis) return null

    // Estimate exposure from pending bets (10% of wagered)
    const totalExposure = kpis.wagered * 0.1
    const maxExposureLimit = kpis.wagered * 0.5 // 50% of wagered as max limit
    const exposureRatio = (totalExposure / maxExposureLimit) * 100
    const exposureStatus = exposureRatio < 30 ? 'low' : exposureRatio < 70 ? 'moderate' : 'high'

    return {
      totalExposure,
      maxExposureLimit,
      exposureRatio,
      exposureStatus,
    }
  }, [kpis])

  // Calculate concentration risk
  const concentrationRisk = useMemo(() => {
    if (!breakdown?.byMatka || breakdown.byMatka.length === 0) return null

    const totalWagered = breakdown.byMatka.reduce((sum, matka) => sum + matka.wagered, 0)
    if (totalWagered === 0) return null

    // Top matka concentration
    const topMatka = breakdown.byMatka[0]
    const topMatkaShare = (topMatka.wagered / totalWagered) * 100

    // Top 3 matkas concentration
    const top3Wagered = breakdown.byMatka.slice(0, 3).reduce((sum, matka) => sum + matka.wagered, 0)
    const top3Share = (top3Wagered / totalWagered) * 100

    // Type concentration
    let typeConcentration = 0
    if (breakdown.byType && breakdown.byType.length > 0) {
      const totalTypeWagered = breakdown.byType.reduce((sum, t) => sum + t.wagered, 0)
      if (totalTypeWagered > 0) {
        const topType = breakdown.byType[0]
        typeConcentration = (topType.wagered / totalTypeWagered) * 100
      }
    }

    const riskLevel =
      topMatkaShare > 50 || top3Share > 80 || typeConcentration > 60
        ? 'high'
        : topMatkaShare > 30 || top3Share > 60 || typeConcentration > 40
        ? 'moderate'
        : 'low'

    return {
      topMatkaShare,
      top3Share,
      typeConcentration,
      riskLevel,
      topMatka: topMatka.matkaName || topMatka.matkaId,
    }
  }, [breakdown])

  // Open bets have no realised RTP, so they cannot supply an RTP-volatility score.
  // Calculate liquidity risk
  const liquidityRisk = useMemo(() => {
    if (!kpis || !exposureMetrics) return null

    // Estimate available liquidity (would come from actual wallet balances)
    const estimatedLiquidity = kpis.ggr * 50
    const requiredLiquidity = kpis.payouts * 2 + exposureMetrics.totalExposure
    const liquidityRatio = estimatedLiquidity > 0 ? (requiredLiquidity / estimatedLiquidity) * 100 : 0
    const liquidityStatus = liquidityRatio < 50 ? 'healthy' : liquidityRatio < 80 ? 'moderate' : 'low'

    return {
      estimatedLiquidity,
      requiredLiquidity,
      liquidityRatio,
      liquidityStatus,
    }
  }, [kpis, exposureMetrics])

  // Overall risk score
  const overallRiskScore = useMemo(() => {
    if (!exposureMetrics || !concentrationRisk || !liquidityRisk) return null

    let riskPoints = 0

    // Exposure risk (0-25 points)
    if (exposureMetrics.exposureStatus === 'high') riskPoints += 25
    else if (exposureMetrics.exposureStatus === 'moderate') riskPoints += 12

    // Concentration risk (0-25 points)
    if (concentrationRisk.riskLevel === 'high') riskPoints += 25
    else if (concentrationRisk.riskLevel === 'moderate') riskPoints += 12

    // Liquidity risk (0-25 points)
    if (liquidityRisk.liquidityStatus === 'low') riskPoints += 25
    else if (liquidityRisk.liquidityStatus === 'moderate') riskPoints += 12

    const riskScore = riskPoints
    const riskLevel =
      riskScore >= 75 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 25 ? 'moderate' : 'low'

    return {
      score: riskScore,
      level: riskLevel,
    }
  }, [exposureMetrics, concentrationRisk, liquidityRisk])

  if (!kpis || !exposureMetrics || !concentrationRisk || !liquidityRisk || !overallRiskScore) return <Card title="Risk Analytics" sub="Open-bet exposure, concentration & liquidity"><EmptyState title="No risk data yet" description="Risk analytics appear once there are Matka wagers to analyse." /></Card>
  const tone = (level: string) => level === 'critical' || level === 'high' || level === 'low' && liquidityRisk.liquidityStatus === level ? 'neg' as const : level === 'moderate' ? 'warn' as const : 'ok' as const
  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const highRisks = [exposureMetrics.exposureStatus === 'high' && 'Exposure risk is HIGH', concentrationRisk.riskLevel === 'high' && 'Concentration risk is HIGH', liquidityRisk.liquidityStatus === 'low' && 'Liquidity risk is HIGH'].filter(Boolean)
  return <Card title="Risk Analytics" sub="Open-bet exposure, concentration & liquidity"><div className={styles.stack}>
    <Notice title="Estimated risk indicators" tone="info">Exposure and liquidity retain the existing estimation model, not confirmed wallet balances or configurable server limits.</Notice>
    <div className={styles.item}><Stat variant="bare" label="Overall Risk Score" value={overallRiskScore.score} /><StatusPill tone={overallRiskScore.level === 'critical' || overallRiskScore.level === 'high' ? 'neg' : overallRiskScore.level === 'moderate' ? 'warn' : 'ok'}>{overallRiskScore.level.toUpperCase()} RISK</StatusPill><Meter value={overallRiskScore.score} tone={overallRiskScore.level === 'critical' || overallRiskScore.level === 'high' ? 'neg' : overallRiskScore.level === 'moderate' ? 'warn' : 'acc'} label="Overall risk score" /></div>
    <div className={styles.grid2}>
      <section className={styles.item}><h3 className={styles.heading}>Exposure Risk</h3><DescriptionList items={[{ term: 'Estimated exposure', value: money(exposureMetrics.totalExposure) }, { term: 'Estimated limit', value: money(exposureMetrics.maxExposureLimit) }]} /><StatusPill tone={exposureMetrics.exposureStatus === 'high' ? 'neg' : exposureMetrics.exposureStatus === 'moderate' ? 'warn' : 'ok'}>{exposureMetrics.exposureStatus.toUpperCase()}</StatusPill><Meter value={exposureMetrics.exposureRatio} label="Estimated exposure ratio" /></section>
      <section className={styles.item}><h3 className={styles.heading}>Concentration</h3><DescriptionList items={[{ term: 'Top Matka share', value: `${concentrationRisk.topMatkaShare.toFixed(1)}%` }, { term: 'Top Matka', value: concentrationRisk.topMatka }, { term: 'Top three share', value: `${concentrationRisk.top3Share.toFixed(1)}%` }]} /><StatusPill tone={concentrationRisk.riskLevel === 'high' ? 'neg' : concentrationRisk.riskLevel === 'moderate' ? 'warn' : 'ok'}>{concentrationRisk.riskLevel.toUpperCase()}</StatusPill></section>
      <section className={styles.item}><h3 className={styles.heading}>RTP / Volatility</h3><p className={styles.text}>Unavailable for open bets. Final payouts are required to calculate realised RTP.</p><StatusPill tone="neutral">Pending settlement</StatusPill></section>
      <section className={styles.item}><h3 className={styles.heading}>Liquidity</h3><DescriptionList items={[{ term: 'Estimated ratio', value: `${liquidityRisk.liquidityRatio.toFixed(1)}%` }, { term: 'Required liquidity', value: money(liquidityRisk.requiredLiquidity) }]} /><StatusPill tone={tone(liquidityRisk.liquidityStatus)}>{liquidityRisk.liquidityStatus.toUpperCase()}</StatusPill></section>
    </div>
    {(overallRiskScore.level === 'critical' || overallRiskScore.level === 'high') && <Notice title="High Risk Detected" tone="error">{highRisks.join('; ')}</Notice>}
  </div></Card>
}

