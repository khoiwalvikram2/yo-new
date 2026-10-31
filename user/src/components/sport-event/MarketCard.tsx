import type { Market, EventDetails, BetSlipData } from './types'
import { useMemo, memo } from 'react'
import MarketHeader from './MarketHeader'
import MatchOddsLayout from './MatchOddsLayout'
import StandardMarketLayout from './StandardMarketLayout'

import type { Bet } from './types'

interface MarketCardProps {
  market: Market
  event: EventDetails
  isExpanded: boolean
  betSlip: BetSlipData | null
  myBets?: Bet[]
  onToggle: () => void
  onOddsClick: (team: string, odds: number, type: 'back' | 'lay', market: string, teamIndex: number, event: React.MouseEvent) => void
  liveMap?: Record<string, any>
}

const MarketCard = memo(function MarketCard({ 
  market, 
  event, 
  isExpanded, 
  betSlip, 
  myBets = [],
  onToggle, 
  onOddsClick,
  liveMap,
}: MarketCardProps) {
  
  const isMatchOdds = market.type === 'match-odds' && market.odds.length >= 2

  const marketLiveMap = liveMap || {}
  const marketLiveEntry = market.marketCode ? (marketLiveMap as any)[market.marketCode] : undefined
  const marketLive = marketLiveEntry?.payload ?? marketLiveEntry
  // marketLiveTs calculated but not used

  const computedMarket: Market = useMemo(() => {
    const normalize = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
    const altKeys = (name: string) => {
      const n = normalize(name)
      const variants = new Set<string>([n])
      variants.add(n.replace(/ w$/, ''))
      variants.add(n.replace(/women|womens|women's/g, '').trim())
      variants.add(n.replace(/\./g, ''))
      return Array.from(variants)
    }
    const extractPrices = (runner: Record<string, unknown>) => {
      const ex: any = (runner as any)?.ex
      if (ex) {
        const atb = Array.isArray(ex.availableToBack) ? ex.availableToBack : []
        const atl = Array.isArray(ex.availableToLay) ? ex.availableToLay : []
        const back = atb.length ? atb[atb.length - 1]?.price : undefined
        const lay = atl.length ? atl[0]?.price : undefined
        return { back, lay, ex }
      }
      const back = (runner as any)?.back ?? (runner as any)?.backPrice ?? (runner as any)?.oddsBack ?? (runner as any)?.b
      const lay = (runner as any)?.lay ?? (runner as any)?.layPrice ?? (runner as any)?.oddsLay ?? (runner as any)?.l
      return { back, lay, ex: undefined }
    }
    const deriveStatus = (live: unknown): Market['status'] => {
      const l: any = live as any
      const raw = normalize(l?.status ?? l?.marketStatus)
      if (!raw) return 'active'
      if (raw.includes('suspend')) return 'suspended'
      if (raw.includes('close')) return 'closed'
      return 'active'
    }

    let nextOdds = market.odds
    let status: Market['status'] | undefined

    if (marketLive) {
      try {
        const byName: Record<string, any> = {}
        const byId: Record<string | number, any> = {}
        const collect = (r: any) => {
          const nm = normalize(r?.selectionName ?? r?.runnerName ?? r?.name)
          if (nm) byName[nm] = r
          if (r?.selectionId !== undefined) byId[String(r.selectionId)] = r
        }
        const lv: any = marketLive as any
        if (Array.isArray(lv?.runners)) {
          (lv.runners as any[]).forEach(collect)
        } else if (lv?.runners && typeof lv.runners === 'object') {
          Object.values(lv.runners as any).forEach(collect)
        } else if (Array.isArray(lv?.selections)) {
          (lv.selections as any[]).forEach(collect)
        } else if (typeof lv === 'object') {
          Object.values(lv as any).forEach(collect)
        }

        nextOdds = market.odds.map(o => {
          const keys = altKeys(o.selection)
          const r = (o.selectionId && byId[String(o.selectionId)]) || keys.map(k => byName[k]).find(Boolean)
          if (!r) return o
          const { back, lay, ex } = extractPrices(r)
          const back3 = Array.isArray((r as any)?.ex?.availableToBack)
            ? ((r as any).ex.availableToBack as any[]).slice(-3).map((x: any) => Number(x?.price))
            : undefined
          const lay3 = Array.isArray((r as any)?.ex?.availableToLay)
            ? ((r as any).ex.availableToLay as any[]).slice(0, 3).map((x: any) => Number(x?.price))
            : undefined
          const backVolume = Array.isArray((r as any)?.ex?.availableToBack) && (r as any).ex.availableToBack.length > 0
            ? Number((r as any).ex.availableToBack[0]?.size) || 0
            : undefined
          const layVolume = Array.isArray((r as any)?.ex?.availableToLay) && (r as any).ex.availableToLay.length > 0
            ? Number((r as any).ex.availableToLay[0]?.size) || 0
            : undefined
          return {
            ...o,
            back: back !== undefined ? Number(back) : o.back,
            lay: lay !== undefined ? Number(lay) : o.lay,
            volume: backVolume || layVolume || o.volume,
            ex,
            ...(back3 && back3.length === 3 ? { back3 } as any : {}),
            ...(lay3 && lay3.length === 3 ? { lay3 } as any : {}),
          }
        })
        status = deriveStatus(marketLive)
      } catch { /* ignore */ }
    }

    // Fancy merge from event-level if available
    // Use eventCode (external ID) first, fallback to id (database UUID) - must match socket key
    const fancyEventKey = event?.eventCode || event?.id
    if ((market.marketType === 'fancy' || market.type === 'fancy') && fancyEventKey) {
      const fancyBlob = (marketLiveMap as any)[`fancy-${fancyEventKey}`]
      const fancyPayload = (fancyBlob as any)?.payload ?? fancyBlob
      if (fancyPayload) {
        try {
          const fancyArray = Array.isArray(fancyPayload) ? fancyPayload : Object.values(fancyPayload)
          const fancyRunners = Array.isArray(fancyArray) ? fancyArray : []
          if (nextOdds.length > 0) {
            // Update existing odds by matching names
            nextOdds = nextOdds.map(o => {
              const fr = fancyRunners.find((x: any) => normalize(x?.name) === normalize(o.selection))
              if (!fr) return o
              return {
                ...o,
                back: Number(fr.b1 || 0),
                lay: Number(fr.l1 || 0),
                fancyData: {
                  bs1: fr.bs1,
                  ls1: fr.ls1,
                  status1: fr.status1,
                  odd_type: fr.odd_type,
                  id: fr.id,
                }
              }
            })
          } else if (fancyRunners.length > 0) {
            // Build odds purely from fancy feed when no local odds are present
            nextOdds = fancyRunners.map((fr: any) => ({
              selection: String(fr?.name || ''),
              back: Number(fr?.b1 || 0),
              lay: Number(fr?.l1 || 0),
              selectionId: fr?.id,
              fancyData: {
                bs1: fr?.bs1,
                ls1: fr?.ls1,
                status1: fr?.status1,
                odd_type: fr?.odd_type,
                id: fr?.id,
              }
            }) as any)
          }
        } catch { /* ignore */ }
      }
    }

    return { ...market, odds: nextOdds, status: status || market.status }
  }, [market, marketLive, marketLiveMap, event?.eventCode, event?.id])

  return (
    <div className="nova-ev-market">
      <MarketHeader 
        market={computedMarket}
        isExpanded={isExpanded}
        onToggle={onToggle}
        myBets={myBets}
        event={event}
        liveMap={marketLiveMap}
      />

      {isExpanded && (
        <div className="nova-ev-market-body">
          {isMatchOdds ? (
            <MatchOddsLayout 
              market={computedMarket}
              event={event}
              betSlip={betSlip}
              myBets={myBets}
              onOddsClick={onOddsClick}
            />
          ) : (
            <StandardMarketLayout market={computedMarket} betSlip={betSlip} event={event} myBets={myBets} onOddsClick={onOddsClick} />
          )}
        </div>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  // Only re-render if:
  // 1. Market structure changes (id, type, odds length)
  // 2. Expanded state changes
  // 3. BetSlip state changes (for highlighting active odds)
  // 4. MyBets changes (for book display)
  // 5. Live odds timestamp changes for THIS market only (fancy uses fancy-${eventCode} key, not marketCode)
  // 6. BetSlip stake/odds changes when slip is for this market (book before→after)

  const isFancy = (m: Market) => m.type === 'fancy' || (m as any).marketType === 'fancy'
  const getLiveKey = (m: Market, ev: EventDetails) =>
    isFancy(m) ? `fancy-${ev?.eventCode ?? ev?.id ?? ''}` : (m.marketCode as string)
  const prevLiveKey = getLiveKey(prevProps.market, prevProps.event)
  const nextLiveKey = getLiveKey(nextProps.market, nextProps.event)
  const prevLive = prevProps.liveMap?.[prevLiveKey]
  const nextLive = nextProps.liveMap?.[nextLiveKey]
  const prevLiveTs = prevLive?._ts
  const nextLiveTs = nextLive?._ts

  const mName = nextProps.market.name
  const prevSlip = prevProps.betSlip?.market === mName ? prevProps.betSlip : null
  const nextSlip = nextProps.betSlip?.market === mName ? nextProps.betSlip : null
  const slipStakeOddsEqual =
    !prevSlip && !nextSlip ||
    (!!prevSlip && !!nextSlip &&
      Number(prevSlip.stake) === Number(nextSlip.stake) &&
      Number(prevSlip.odds) === Number(nextSlip.odds))

  return (
    prevProps.market.id === nextProps.market.id &&
    prevProps.market.type === nextProps.market.type &&
    prevProps.market.odds.length === nextProps.market.odds.length &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.betSlip?.buttonId === nextProps.betSlip?.buttonId &&
    slipStakeOddsEqual &&
    prevProps.myBets?.length === nextProps.myBets?.length &&
    prevLiveTs === nextLiveTs &&
    prevProps.event.id === nextProps.event.id
  )
})

export default MarketCard
