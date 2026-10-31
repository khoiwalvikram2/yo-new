import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { HeatmapStrip } from '../../components/HeatmapStrip'
import type { CasinoBreakdown } from '../../casinoLiveModel'
interface LiveHeatmapProps { breakdown?: Pick<CasinoBreakdown, 'byGame' | 'byProvider'>; windowMins?: number }
export function LiveHeatmap({ breakdown }: LiveHeatmapProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const items = useMemo(() => {
    if (!breakdown?.byGame) return []
    const maxWagered = Math.max(...breakdown.byGame.map(game => game.wagered), 1)
    return breakdown.byGame.map(game => ({ ...game, intensity: (game.wagered / maxWagered) * 100, profitMargin: game.wagered > 0 ? (game.ggr / game.wagered) * 100 : 0 })).sort((a, b) => b.wagered - a.wagered)
  }, [breakdown])
  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  return <HeatmapStrip title="Games Activity Heatmap" empty={!breakdown || (!items.length && !breakdown.byProvider.length) ? 'No activity data yet' : 'No game activity yet'} items={items.map(game => ({
    id: game.gameId, name: game.gameName || `Game #${game.gameId}`, bets: game.bets, intensity: game.intensity, margin: game.profitMargin,
    detail: <><span>Wagered: {fmt(game.wagered)}</span><span>Payouts: {fmt(game.payouts)}</span><span>GGR: {fmt(game.ggr)}</span><span>Bets: {game.bets}</span><span>Margin: {game.profitMargin.toFixed(2)}%</span></>,
  }))} />
}

