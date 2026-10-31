import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import { Popover } from '@/ui/components/Popover'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../CasinoLive.module.css'

export interface HeatmapItem {
  id: string
  name: string
  bets: number
  intensity: number
  margin?: number
  detail: ReactNode
  summary?: ReactNode
}

/** Activity stays comparable by magnitude; details are also reachable by touch and keyboard. */
export function HeatmapStrip({ title, items, empty, rowThreshold = 5, scrollStep = 250 }: {
  title: string; items: HeatmapItem[]; empty: string; rowThreshold?: number; scrollStep?: number
}) {
  const rail = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = () => {
    const element = rail.current
    if (element) setEdges({ left: element.scrollLeft > 0, right: element.scrollLeft < element.scrollWidth - element.clientWidth - 10 })
  }
  useEffect(() => {
    measure()
    const element = rail.current
    if (!element) return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [items])
  return <Card title={title} sub="Intensity: low to high. Open an item to inspect its activity." tools={<div className={styles.actions}>
    <Button size="sm" variant="ghost" disabled={!edges.left} aria-label={`Scroll ${title} left`} onClick={() => rail.current?.scrollBy({ left: -scrollStep, behavior: 'smooth' })}>Previous</Button>
    <Button size="sm" variant="ghost" disabled={!edges.right} aria-label={`Scroll ${title} right`} onClick={() => rail.current?.scrollBy({ left: scrollStep, behavior: 'smooth' })}>Next</Button>
  </div>}>
    {!items.length ? <EmptyState title={empty} /> : <div ref={rail} className={styles.heatmapRail} onScroll={measure} tabIndex={0} role="region" aria-label={`${title} scrollable activity`}>
      <div className={clsx(styles.heatmapItems, items.length > rowThreshold && styles.heatmapTwoRows)}>{items.map(item => <Popover key={item.id} label={`${item.name} activity details`} trigger={
        <button type="button" className={clsx(styles.heatmapItem, item.intensity >= 80 ? styles.heatHigh : item.intensity >= 60 ? styles.heatWarm : item.intensity >= 40 ? styles.heatMid : item.intensity >= 20 ? styles.heatLow : styles.heatQuiet)}>
          <strong className={styles.heatmapName}>{item.name}</strong>
          <span className={styles.heatmapCount}>{item.bets.toLocaleString()}</span><span className={styles.muted}>bets</span>
          <StatusPill tone={item.margin === undefined ? 'info' : item.margin >= 0 ? 'ok' : 'neg'}>{item.margin === undefined ? `${item.intensity.toFixed(0)}% activity` : `${item.margin >= 0 ? '+' : ''}${item.margin.toFixed(1)}% margin`}</StatusPill>
          <Meter value={item.intensity} tone={item.intensity >= 80 ? 'neg' : item.intensity >= 40 ? 'warn' : 'acc'} label={`${item.name} intensity`} />
          {item.summary}
        </button>}><div className={styles.details}><strong>{item.name}</strong>{item.detail}</div></Popover>)}</div>
    </div>}
  </Card>
}
