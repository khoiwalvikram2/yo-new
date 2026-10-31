import clsx from 'clsx'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Button } from '@/ui/components/Button'
import { Tooltip } from '@/ui/components/Tooltip'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../../MatkaLiveUi.module.css'
import React, { useMemo, useRef, useState, useEffect } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'

interface LiveHeatmapProps {
  breakdown?: {
    byMatka?: Array<{
      matkaId: string
      matkaName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byType?: Array<{
      matkaType: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
}

export const LiveHeatmap: React.FC<LiveHeatmapProps> = ({ breakdown }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showLeftBtn, setShowLeftBtn] = useState(false)
  const [showRightBtn, setShowRightBtn] = useState(false)

  const matkaHeatmapData = useMemo(() => {
    if (!breakdown?.byMatka) return []
    const maxWagered = Math.max(...breakdown.byMatka.map(m => m.wagered), 1)
    return breakdown.byMatka.map(matka => ({
      ...matka,
      intensity: (matka.wagered / maxWagered) * 100,
      profitMargin: matka.wagered > 0 ? (matka.ggr / matka.wagered) * 100 : 0,
    })).sort((a, b) => b.wagered - a.wagered)
  }, [breakdown])

  const checkScrollButtons = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
      setShowLeftBtn(scrollLeft > 0)
      setShowRightBtn(scrollLeft < scrollWidth - clientWidth - 10)
    }
  }

  useEffect(() => {
    checkScrollButtons()
    const scrollEl = scrollRef.current
    if (scrollEl) {
      scrollEl.addEventListener('scroll', checkScrollButtons)
      return () => scrollEl.removeEventListener('scroll', checkScrollButtons)
    }
  }, [matkaHeatmapData])

  const typeHeatmapData = useMemo(() => {
    if (!breakdown?.byType) return []
    const maxWagered = Math.max(...breakdown.byType.map(t => t.wagered), 1)
    return breakdown.byType.map(type => ({
      ...type,
      intensity: (type.wagered / maxWagered) * 100,
      profitMargin: type.wagered > 0 ? (type.ggr / type.wagered) * 100 : 0,
    })).sort((a, b) => b.wagered - a.wagered)
  }, [breakdown])

  const intensityClass = (value: number) => value >= 80 ? styles.heatCritical : value >= 60 ? styles.heatHigh : value >= 40 ? styles.heatElevated : value >= 20 ? styles.heatModerate : styles.heatLow
  const profitTone = (value: number): 'ok' | 'info' | 'warn' | 'neg' => value >= 5 ? 'ok' : value >= 0 ? 'info' : value >= -5 ? 'warn' : 'neg'
  return <Card title="Matka Activity Heatmap" sub="Activity intensity visualization · Low to high">
    {!breakdown || (!matkaHeatmapData.length && !typeHeatmapData.length) ? <EmptyState title="No activity data yet" /> : !matkaHeatmapData.length ? <EmptyState title="No matka activity yet" /> : <div className={styles.stack}>
      <div className={styles.inline}>{showLeftBtn && <Button size="sm" aria-label="Previous Matka heatmap items" onClick={() => scrollRef.current?.scrollBy({ left: -250, behavior: 'smooth' })}>Previous</Button>}{showRightBtn && <Button size="sm" aria-label="Next Matka heatmap items" onClick={() => scrollRef.current?.scrollBy({ left: 250, behavior: 'smooth' })}>Next</Button>}</div>
      <div ref={scrollRef} className={styles.rail} onScroll={checkScrollButtons} tabIndex={0} role="region" aria-label="Matka activity heatmap"><div className={clsx(styles.railItems, matkaHeatmapData.length > 5 && styles.railRows)}>
        {matkaHeatmapData.map(matka => <Tooltip key={matka.matkaId} content={<div className={styles.stack}><strong>{matka.matkaName || `Matka #${matka.matkaId}`}</strong><span>Wagered: {formatAmount(convertFromWhitelabelCurrency(matka.wagered))}</span><span>Payouts: {formatAmount(convertFromWhitelabelCurrency(matka.payouts))}</span><span>GGR: {formatAmount(convertFromWhitelabelCurrency(matka.ggr))}</span><span>Bets: {matka.bets}</span><span>Margin: {matka.profitMargin.toFixed(2)}%</span></div>}>
          <div tabIndex={0} className={clsx(styles.heatCell, intensityClass(matka.intensity))} style={{ opacity: 0.7 + matka.intensity / 100 * 0.3 }}>
            <strong className={styles.heading}>{matka.matkaName || `Matka #${matka.matkaId}`}</strong><span className={styles.heatNumber}>{matka.bets}</span><span>bets</span><StatusPill tone={profitTone(matka.profitMargin)}>{matka.profitMargin >= 0 ? '+' : ''}{matka.profitMargin.toFixed(1)}%</StatusPill>
          </div>
        </Tooltip>)}
      </div></div>
    </div>}
  </Card>
}

