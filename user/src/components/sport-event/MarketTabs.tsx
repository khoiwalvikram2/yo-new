import { useEffect } from 'react'
import type { Market } from './types'

interface MarketTabsProps {
  markets: Market[]
  activeTab: string
  onTabChange: (tab: string) => void
}

/** Market families on the event page, as the matchbook tab strip (white, red active tab). */
export default function MarketTabs({ markets, activeTab, onTabChange }: MarketTabsProps) {
  const hasExchange = Array.isArray(markets) && markets.some(m => m?.type === 'match-odds' || (m as any)?.marketType === 'exchange')
  const hasBookmaker = Array.isArray(markets) && markets.some(m => m?.type === 'bookmaker' || (m as any)?.marketType === 'bookmaker')
  const hasFancy = Array.isArray(markets) && markets.some(m => m?.type === 'fancy' || (m as any)?.marketType === 'fancy')

  const tabs = [
    { id: 'all', label: 'All' },
    ...(hasExchange ? [{ id: 'exchange', label: 'Match Odds' }] as const : []),
    ...(hasBookmaker ? [{ id: 'bookmaker', label: 'Bookmaker' }] as const : []),
    ...(hasFancy ? [{ id: 'fancy', label: 'Fancy' }] as const : []),
  ] as Array<{ id: string; label: string }>

  useEffect(() => {
    if (!tabs.some(t => t.id === activeTab)) {
      onTabChange(tabs[0]?.id || 'all')
    }
  }, [markets, activeTab])

  return (
    <div className="nova-ex-sport-tabs nova-ev-tabs" role="group" aria-label="Markets">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          className={activeTab === tab.id ? 'active' : ''}
          aria-pressed={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        >
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  )
}
