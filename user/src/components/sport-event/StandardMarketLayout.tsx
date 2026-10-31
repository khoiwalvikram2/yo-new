import type { Market, BetSlipData, EventDetails, Bet } from './types'
import { Lock, Minus, BarChart3 } from "lucide-react"
import { useMemo, useCallback, useState, memo } from 'react'
import FancyBookDisplay from './FancyBookDisplay'
import { formatAmount } from '@/lib/currency'

interface StandardMarketLayoutProps {
  market: Market
  betSlip?: BetSlipData | null
  event?: EventDetails
  myBets?: Bet[]
  onOddsClick?: (team: string, odds: number, type: 'back' | 'lay', market: string, teamIndex: number, event: React.MouseEvent, extras?: { marketId?: string; marketType?: 'exchange' | 'bookmaker' | 'fancy'; marketCode?: string; selectionId?: string | number; backOdds?: number; layOdds?: number; oddsSize?: number }) => void
}

const StandardMarketLayout = memo(function StandardMarketLayout({ market, myBets = [], onOddsClick }: StandardMarketLayoutProps) {
  const isFancyMarket = market.type === 'fancy'
  const [bookModalOpen, setBookModalOpen] = useState(false)
  const [selectedFancyForBook, setSelectedFancyForBook] = useState<string | null>(null)
  
  // Sort fancy odds: selections with bets go to top
  const sortedOdds = useMemo(() => {
    if (!isFancyMarket) return market.odds
    
    const oddsWithBets: typeof market.odds = []
    const oddsWithoutBets: typeof market.odds = []
    
    market.odds.forEach(odds => {
      const hasBet = myBets?.some(bet => 
        bet.selection === odds.selection || 
        (bet as any).selectionId === odds.selectionId ||
        bet.market === odds.selection
      )
      if (hasBet) {
        oddsWithBets.push(odds)
      } else {
        oddsWithoutBets.push(odds)
      }
    })
    
    return [...oddsWithBets, ...oddsWithoutBets]
  }, [isFancyMarket, market.odds, myBets])
  
  // Calculate exposure for each fancy selection
  const getExposureForSelection = useCallback((selection: string, selectionId?: number | string) => {
    if (!isFancyMarket) return 0
    
    const relevantBets = myBets?.filter(bet => 
      bet.selection === selection || 
      (bet as any).selectionId === selectionId ||
      bet.market === selection
    ) || []
    
    let exposure = 0
    relevantBets.forEach(bet => {
      const stake = Number(bet.stake || 0)
      const oddsSize = (bet as any).oddsSize || 100
      
      if (bet.type === 'lay') {
        // LAY: Liability = stake * (oddsSize / 100)
        exposure += stake * (oddsSize / 100)
      } else {
        // BACK: Liability = stake
        exposure += stake
      }
    })
    
    return exposure
  }, [isFancyMarket, myBets])
  

  const formatVolume = (vol: number | string) => {
    const num = typeof vol === 'string' ? parseFloat(vol) : vol
    if (isNaN(num)) return vol
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`
    return num.toFixed(0)
  }
  
  // Fancy lines read No (lay) then Yes (back); other markets Back then Lay. Each line is its own row with a
  // hairline, under a header naming the two price columns, like Match Odds (styles in nova-sports-event.css).
  const columns = isFancyMarket
    ? [{ side: 'lay' as const, label: 'No' }, { side: 'back' as const, label: 'Yes' }]
    : [{ side: 'back' as const, label: 'Back' }, { side: 'lay' as const, label: 'Lay' }]

  if (market.status === 'suspended') {
    return (
      <div className="nova-ev-market-suspended" role="status">
        <Lock aria-hidden="true" />
        <span>Suspended</span>
      </div>
    )
  }

  return (
    <div className="nova-ev-lines" data-market-group>
      <div className="nova-ev-cols nova-ev-lines-head">
        <span className="nova-ev-cols-label">{isFancyMarket ? 'Line' : 'Selection'}</span>
        <span className="nova-ev-lines-cols">
          {columns.map(({ side, label }) => <span key={side} className={`nova-ev-cols-label is-${side}`}>{label}</span>)}
        </span>
      </div>
      {sortedOdds.map((odds, index) => {
        const exposure = isFancyMarket ? getExposureForSelection(odds.selection, odds.selectionId) : 0
        const hasExposure = exposure > 0
        const status = isFancyMarket ? odds.fancyData?.status1 : undefined
        // A closed line keeps its row: the name stays, the prices give way to its status.
        const closed = status === 'SUSPENDED' || status === 'Ball Running'

        return (
          <div key={index} className={`nova-ev-runner nova-ev-line${closed ? ' is-closed' : ''}`} data-market-row>
            <div className="nova-ev-line-info">
              <div className="nova-ev-runner-name">{odds.selection}</div>
              {isFancyMarket && hasExposure && (
                <div className="nova-ev-line-book">
                  <span><Minus aria-hidden="true" />{formatAmount(exposure)}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedFancyForBook(odds.selection)
                      setBookModalOpen(true)
                    }}
                  >
                    <BarChart3 aria-hidden="true" />Book
                  </button>
                </div>
              )}
            </div>
            <div className="nova-ev-line-prices">
              {closed ? (
                <span className="nova-ev-line-status"><Lock aria-hidden="true" />{status === 'Ball Running' ? 'Ball running' : 'Suspended'}</span>
              ) : columns.map(({ side }) => {
                const price = side === 'back' ? odds.back : odds.lay
                const size = side === 'back' ? odds.fancyData?.bs1 : odds.fancyData?.ls1
                return (
                  <button
                    key={side}
                    type="button"
                    className={`nova-ev-odd is-${side} is-main`}
                    onClick={(e) => onOddsClick?.(odds.selection, price, side, market.name, index, e, {
                      marketId: market.id,
                      marketType: market.marketType as any,
                      marketCode: (market as any).marketCode,
                      selectionId: odds.selectionId,
                      backOdds: odds.back,
                      layOdds: odds.lay,
                      ...(isFancyMarket ? { oddsSize: size ? Number(size) : undefined } : {}),
                    })}
                  >
                    <span className="nova-ev-odd-price">{isFancyMarket ? price.toFixed(0) : price.toFixed(2)}</span>
                    {size
                      ? <span className="nova-ev-odd-size">{size}</span>
                      : odds.volume ? <span className="nova-ev-odd-size">{formatVolume(odds.volume)}</span> : null}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Book Modal for Fancy Markets */}
      {isFancyMarket && selectedFancyForBook && (
        <FancyBookDisplay
          isOpen={bookModalOpen}
          onClose={() => {
            setBookModalOpen(false)
            setSelectedFancyForBook(null)
          }}
          marketName={selectedFancyForBook}
          bets={myBets
            ?.filter(bet => 
              bet.selection === selectedFancyForBook || 
              (bet as any).selectionId === sortedOdds.find(o => o.selection === selectedFancyForBook)?.selectionId ||
              bet.market === selectedFancyForBook
            )
            .map(bet => ({
              selection: bet.selection || '',
              odds: Number(bet.odds || 0),
              stake: Number(bet.stake || 0),
              type: (bet.type || 'back').toLowerCase() as 'back' | 'lay',
              odds_size: (bet as any).oddsSize || 100,
            })) || []}
        />
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  // Only re-render if odds values or market state changes
  const prevOdds = prevProps.market.odds
  const nextOdds = nextProps.market.odds
  
  if (prevOdds.length !== nextOdds.length) return false
  
  // Check if odds values changed
  const oddsChanged = prevOdds.some((prevOdd, idx) => {
    const nextOdd = nextOdds[idx]
    return prevOdd.back !== nextOdd.back || prevOdd.lay !== nextOdd.lay
  })
  
  return (
    !oddsChanged &&
    prevProps.market.status === nextProps.market.status &&
    prevProps.betSlip?.buttonId === nextProps.betSlip?.buttonId &&
    prevProps.myBets?.length === nextProps.myBets?.length
  )
})

export default StandardMarketLayout
