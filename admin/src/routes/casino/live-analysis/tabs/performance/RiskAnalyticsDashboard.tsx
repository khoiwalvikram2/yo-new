import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { Meter } from '@/ui/components/Meter'
import { StatusPill } from '@/ui/components/StatusPill'
import { Notice } from '@/ui/components/Notice'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../../CasinoLive.module.css'
interface RiskAnalyticsDashboardProps {
  kpis?: {
    wagered: number
    payouts: number
    ggr: number
    rtp: number
    activePlayers: number
  }
  breakdown?: {
    byGame?: Array<{
      gameId: string
      gameName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byVendor?: Array<{
      vendorId: string
      vendorName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
  windowMins?: number
}

export function RiskAnalyticsDashboard({
  kpis,
  breakdown,
}: RiskAnalyticsDashboardProps) {
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
    if (!breakdown?.byGame || breakdown.byGame.length === 0) return null

    const totalWagered = breakdown.byGame.reduce((sum, game) => sum + game.wagered, 0)
    if (totalWagered === 0) return null

    // Top game concentration
    const topGame = breakdown.byGame[0]
    const topGameShare = (topGame.wagered / totalWagered) * 100

    // Top 3 games concentration
    const top3Wagered = breakdown.byGame.slice(0, 3).reduce((sum, game) => sum + game.wagered, 0)
    const top3Share = (top3Wagered / totalWagered) * 100

    // Vendor concentration
    let vendorConcentration = 0
    if (breakdown.byVendor && breakdown.byVendor.length > 0) {
      const totalVendorWagered = breakdown.byVendor.reduce((sum, v) => sum + v.wagered, 0)
      if (totalVendorWagered > 0) {
        const topVendor = breakdown.byVendor[0]
        vendorConcentration = (topVendor.wagered / totalVendorWagered) * 100
      }
    }

    const riskLevel =
      topGameShare > 50 || top3Share > 80 || vendorConcentration > 60
        ? 'high'
        : topGameShare > 30 || top3Share > 60 || vendorConcentration > 40
        ? 'moderate'
        : 'low'

    return {
      topGameShare,
      top3Share,
      vendorConcentration,
      riskLevel,
      topGame: topGame.gameName || topGame.gameId,
    }
  }, [breakdown])

  // Calculate volatility risk
  const volatilityRisk = useMemo(() => {
    if (!kpis) return null

    // RTP volatility indicator
    const rtpDeviation = Math.abs(kpis.rtp - 95) // Deviation from expected 95%
    const volatilityLevel =
      rtpDeviation > 15 ? 'high' : rtpDeviation > 8 ? 'moderate' : 'low'

    // Payout volatility (payouts vs wagered ratio)
    const payoutRatio = kpis.wagered > 0 ? (kpis.payouts / kpis.wagered) * 100 : 0
    const payoutVolatility = payoutRatio > 110 ? 'high' : payoutRatio < 85 ? 'high' : 'low'

    return {
      rtpDeviation,
      volatilityLevel,
      payoutRatio,
      payoutVolatility,
    }
  }, [kpis])

  // Calculate liquidity risk
  const liquidityRisk = useMemo(() => {
    if (!kpis || !exposureMetrics) return null

    // These are the existing estimates, not actual wallet balances.
    const estimatedLiquidity = kpis.ggr * 50
    const requiredLiquidity = kpis.payouts * 2 + exposureMetrics.totalExposure
    const liquidityRatio = estimatedLiquidity > 0 ? (requiredLiquidity / estimatedLiquidity) * 100 : 0
    const liquidityStatus = liquidityRatio < 50 ? 'healthy' : liquidityRatio < 80 ? 'moderate' : 'low'

    return { estimatedLiquidity, requiredLiquidity, liquidityRatio, liquidityStatus }
  }, [kpis, exposureMetrics])

  const overallRiskScore = useMemo(() => {
    if (!exposureMetrics || !concentrationRisk || !volatilityRisk || !liquidityRisk) return null

    let riskPoints = 0
    if (exposureMetrics.exposureStatus === 'high') riskPoints += 25
    else if (exposureMetrics.exposureStatus === 'moderate') riskPoints += 12
    if (concentrationRisk.riskLevel === 'high') riskPoints += 25
    else if (concentrationRisk.riskLevel === 'moderate') riskPoints += 12
    if (volatilityRisk.volatilityLevel === 'high') riskPoints += 25
    else if (volatilityRisk.volatilityLevel === 'moderate') riskPoints += 12
    if (liquidityRisk.liquidityStatus === 'low') riskPoints += 25
    else if (liquidityRisk.liquidityStatus === 'moderate') riskPoints += 12

    const riskScore = riskPoints
    const riskLevel = riskScore >= 75 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 25 ? 'moderate' : 'low'
    return { score: riskScore, level: riskLevel }
  }, [exposureMetrics, concentrationRisk, volatilityRisk, liquidityRisk])

  if (!kpis || !exposureMetrics || !concentrationRisk || !volatilityRisk || !liquidityRisk || !overallRiskScore) return <Card title="Risk Analytics"><EmptyState title="No risk data yet" description="Risk analytics appear once there are casino wagers to analyse." /></Card>
  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  return <Card title="Risk Analytics"><div className={styles.stack}><div className={styles.details}><Stat variant="bare" label="Overall Risk Score" value={overallRiskScore.score} hue={overallRiskScore.level === 'critical' || overallRiskScore.level === 'high' ? 'red' : overallRiskScore.level === 'moderate' ? 'amb' : 'grn'} /><Meter value={overallRiskScore.score} tone={overallRiskScore.level === 'critical' || overallRiskScore.level === 'high' ? 'neg' : overallRiskScore.level === 'moderate' ? 'warn' : 'acc'} /><StatusPill tone={overallRiskScore.level === 'critical' || overallRiskScore.level === 'high' ? 'neg' : overallRiskScore.level === 'moderate' ? 'warn' : 'ok'}>{overallRiskScore.level.toUpperCase()} RISK</StatusPill></div>
    <div className={styles.grid4}><div className={styles.details}><Stat variant="bare" label="Exposure Risk" value={fmt(exposureMetrics.totalExposure)} size="compact" hue="amb" /><StatusPill tone={exposureMetrics.exposureStatus === 'high' ? 'neg' : exposureMetrics.exposureStatus === 'moderate' ? 'warn' : 'ok'}>{exposureMetrics.exposureStatus.toUpperCase()}</StatusPill><Meter value={exposureMetrics.exposureRatio} tone={exposureMetrics.exposureStatus === 'high' ? 'neg' : 'acc'} /></div>
      <div className={styles.details}><Stat variant="bare" label="Concentration" value={`${concentrationRisk.topGameShare.toFixed(1)}%`} note={concentrationRisk.topGame.slice(0, 18)} size="compact" /><StatusPill tone={concentrationRisk.riskLevel === 'high' ? 'neg' : concentrationRisk.riskLevel === 'moderate' ? 'warn' : 'ok'}>{concentrationRisk.riskLevel.toUpperCase()}</StatusPill></div>
      <div className={styles.details}><Stat variant="bare" label="Volatility" value={`${volatilityRisk.rtpDeviation.toFixed(1)}%`} note={`RTP: ${kpis.rtp.toFixed(2)}%`} size="compact" hue="blu" /><StatusPill tone={volatilityRisk.volatilityLevel === 'high' ? 'neg' : volatilityRisk.volatilityLevel === 'moderate' ? 'warn' : 'ok'}>{volatilityRisk.volatilityLevel.toUpperCase()}</StatusPill></div>
      <div className={styles.details}><Stat variant="bare" label="Liquidity" value={`${liquidityRisk.liquidityRatio.toFixed(1)}%`} note={`Req: ${fmt(liquidityRisk.requiredLiquidity)}`} size="compact" /><StatusPill tone={liquidityRisk.liquidityStatus === 'low' ? 'neg' : liquidityRisk.liquidityStatus === 'moderate' ? 'warn' : 'ok'}>{liquidityRisk.liquidityStatus.toUpperCase()}</StatusPill></div>
    </div>
    {(overallRiskScore.level === 'critical' || overallRiskScore.level === 'high') && <Notice tone="error" title="High Risk Detected">{[exposureMetrics.exposureStatus === 'high' ? 'Exposure risk is HIGH' : '', concentrationRisk.riskLevel === 'high' ? 'Concentration risk is HIGH' : '', volatilityRisk.volatilityLevel === 'high' ? 'Volatility risk is HIGH' : '', liquidityRisk.liquidityStatus === 'low' ? 'Liquidity risk is HIGH' : ''].filter(Boolean).join('. ')}</Notice>}
  </div></Card>
}

