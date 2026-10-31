import { memo, useEffect, useMemo } from 'react'
import { Tabs } from '@/ui/components/Tabs'
import styles from './MarketPanel.module.css'

interface MarketTabsProps {
  markets: { id?: string; kind?: string | null; type?: string | null }[]
  activeTab: string
  onTabChange: (tab: string) => void
}

const KINDS = [{ value: 'exchange', label: 'Match odds' }, { value: 'bookmaker', label: 'Bookmaker' }, { value: 'fancy', label: 'Fancy' }]

/** The page's market list is the tab panel: role="tabpanel", id tabPanelId('event-markets', tab), labelled by tabId('event-markets', tab). */
export const MarketTabs = memo(function MarketTabs({ markets, activeTab, onTabChange }: MarketTabsProps) {
  const tabs = useMemo(() => [
    { value: 'all', label: 'All', count: markets?.length ?? 0 },
    ...KINDS.filter(({ value }) => markets?.some(market => market?.kind === value || market?.type === value)).map(kind => ({
      ...kind,
      // The page filters on `kind || type`, so the count is the number of cards the tab shows.
      count: markets.filter(market => (market?.kind || market?.type || '').toLowerCase() === kind.value).length,
    })),
  ], [markets])
  const available = tabs.some(tab => tab.value === activeTab)
  useEffect(() => { if (!available) onTabChange('all') }, [available, onTabChange])
  return <Tabs className={styles.tabs} label="Market type" idPrefix="event-markets" size="sm" value={available ? activeTab : 'all'} items={tabs} onChange={onTabChange} />
})

