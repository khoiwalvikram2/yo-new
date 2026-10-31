import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { HeatmapStrip } from '../../components/HeatmapStrip'
import type { CasinoBreakdown } from '../../casinoLiveModel'
interface VendorHeatmapProps { breakdown?: Pick<CasinoBreakdown, 'byVendor'> }
export function VendorHeatmap({ breakdown }: VendorHeatmapProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const items = useMemo(() => {
    if (!breakdown?.byVendor) return []
    const maxWagered = Math.max(...breakdown.byVendor.map(vendor => vendor.wagered), 1)
    return breakdown.byVendor.map(vendor => ({ name: vendor.vendorName || 'Unknown Vendor', wagered: vendor.wagered, ggr: vendor.ggr, bets: vendor.bets, payouts: vendor.payouts, intensity: (vendor.wagered / maxWagered) * 100, profitMargin: vendor.wagered > 0 ? (vendor.ggr / vendor.wagered) * 100 : 0 })).sort((a, b) => b.wagered - a.wagered)
  }, [breakdown])
  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  return <HeatmapStrip title="Vendor Activity Heatmap" empty="No vendor activity data" rowThreshold={4} scrollStep={300} items={items.map((vendor, index) => ({
    id: `${vendor.name}-${index}`, name: vendor.name, bets: vendor.bets, intensity: vendor.intensity, margin: vendor.profitMargin,
    summary: <><span>Volume: {fmt(vendor.wagered)}</span><span>GGR: {fmt(vendor.ggr)}</span></>,
    detail: <><span>Wagered: {fmt(vendor.wagered)}</span><span>Payouts: {fmt(vendor.payouts)}</span><span>GGR: {fmt(vendor.ggr)}</span><span>Bets: {vendor.bets.toLocaleString()}</span><span>Margin: {vendor.profitMargin.toFixed(2)}%</span></>,
  }))} />
}

