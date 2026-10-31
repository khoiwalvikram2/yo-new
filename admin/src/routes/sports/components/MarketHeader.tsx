import type { ReactNode } from 'react'
import { IconChevronUp } from '@tabler/icons-react'
import { Card } from '@/ui/components/Card'
import { IconButton } from '@/ui/components/IconButton'
import { Tooltip } from '@/ui/components/Tooltip'
import { StatusPill } from '@/ui/components/StatusPill'
import { useCurrency } from '@/shared/core/CurrencyContext'
import styles from './MarketPanel.module.css'

interface MarketHeaderProps {
  market: { name?: string | null; state?: string | null; status?: string | null; kind?: string | null; type?: string | null }
  isExpanded: boolean
  onToggle: () => void
  betCount?: number
  exposure?: number
  liquidity?: number
  /** The panel body under the head; MarketCard passes it only while the market is expanded. */
  children?: ReactNode
}

const KIND_LABELS: Record<string, string> = { exchange: 'Exchange', bookmaker: 'Bookmaker', fancy: 'Fancy', 'match-odds': 'Match odds' }

function kindLabel(kind: string) {
  const known = KIND_LABELS[kind.toLowerCase()]
  if (known) return known
  const words = kind.replace(/[-_]+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The kit market panel: the charcoal head (name, state, kind · bets · liquidity, fold) over the body. */
export function MarketHeader({ market, isExpanded, onToggle, betCount = 0, exposure = 0, liquidity = 0, children }: MarketHeaderProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const state = (market.state || market.status || '').toLowerCase()
  const isActive = ['active', 'open'].includes(state)
  const isSuspended = state === 'suspended'
  const name = market.name || 'Market'
  const kind = market.kind || market.type ? kindLabel(String(market.kind || market.type)) : ''
  return <Card body="flush" title={name}
    sub={<>
      <StatusPill className={styles.state} tone={isActive ? 'ok' : isSuspended ? 'warn' : 'muted'}>{market.state?.toUpperCase() || market.status?.toUpperCase() || 'OPEN'}</StatusPill>
      {/* the merged fancy market is titled "Fancy" already */}
      {kind && kind.toLowerCase() !== name.toLowerCase() && <span className={styles.fact}>{kind}</span>}
      {betCount > 0 && <span className={styles.fact}>{betCount} {betCount === 1 ? 'bet' : 'bets'}</span>}
      {liquidity > 0 && <span className={styles.fact}>Liquidity <span className={styles.figure}>{formatAmount(convertFromWhitelabelCurrency(liquidity))}</span></span>}
    </>}
    tools={<>
      {exposure !== 0 && <Tooltip content={exposure > 0 ? 'Liability' : 'Profit'}><span className={styles.exposure}><StatusPill tone={exposure > 0 ? 'neg' : 'ok'}>{exposure > 0 ? '−' : '+'}{formatAmount(convertFromWhitelabelCurrency(Math.abs(exposure)))}</StatusPill></span></Tooltip>}
      <IconButton className={styles.fold} size="sm" label={`${isExpanded ? 'Fold' : 'Unfold'} ${name}`} aria-expanded={isExpanded} onClick={onToggle} icon={<IconChevronUp size={16} stroke={2} />} />
    </>}>
    {children}
  </Card>
}
