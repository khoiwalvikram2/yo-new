import { useEffect } from 'react'
import type { Market } from './types'

interface MarketTabsProps {
  markets: Market[]
  activeTab: string
  onTabChange: (tab: string) => void
}

/** Market families on the event page: line tabs (the active one underlined in the brand colour), each with its count. */
export default function MarketTabs({ markets, activeTab, onTabChange }: MarketTabsProps) {
  const hasExchange = Array.isArray(markets) && markets.some(m => m?.type === 'match-odds' || (m as any)?.marketType === 'exchange')
  const hasBookmaker = Array.isArray(markets) && markets.some(m => m?.type === 'bookmaker' || (m as any)?.marketType === 'bookmaker')
  const hasFancy = Array.isArray(markets) && markets.some(m => m?.type === 'fancy' || (m as any)?.marketType === 'fancy')

  const count = (type: string, marketType: string) => (Array.isArray(markets) ? markets : []).filter(m => m?.type === type || (m as any)?.marketType === marketType).length
  const tabs = [
    { id: 'all', label: 'All', count: Array.isArray(markets) ? markets.length : 0 },
    ...(hasExchange ? [{ id: 'exchange', label: 'Match Odds', count: count('match-odds', 'exchange') }] as const : []),
    ...(hasBookmaker ? [{ id: 'bookmaker', label: 'Bookmaker', count: count('bookmaker', 'bookmaker') }] as const : []),
    ...(hasFancy ? [{ id: 'fancy', label: 'Fancy', count: count('fancy', 'fancy') }] as const : []),
  ] as Array<{ id: string; label: string; count: number }>

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
          {tab.count > 0 && <small>{tab.count}</small>}
        </button>
      ))}
    </div>
  )
}
