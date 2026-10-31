import type { EventMarket, EventMarketBet, MarketPriceSize, MarketRunner } from './eventMarketTypes'
import { calculatePLWithCut } from '../utils/plCalculator'
import type { BookEntry, BookViewContext } from '../utils/bookCalculator'
export interface DepthOdd { value: number; volume: number; isMain: boolean; isLoading?: boolean }
export function formatOddsVolume(vol: number | string | null | undefined) {
    if (!vol) return "0";
    const num = typeof vol === "string" ? parseFloat(vol) : vol;
    if (isNaN(num)) return "0";
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
    return num.toFixed(0);
  }

export function standardOddsData(runner: MarketRunner) {
    const ex = runner.ex || runner.ex;
    
    if (ex && Array.isArray(ex.availableToBack) && ex.availableToBack.length > 0) {
      const atb = ex.availableToBack;
      const atl = Array.isArray(ex.availableToLay) ? ex.availableToLay : [];
      
      const bestBack = atb.length > 0 
        ? atb.reduce((max: MarketPriceSize, item: MarketPriceSize) => Number(item.price) > Number(max.price) ? item : max, atb[0])
        : null;
      
      const bestLay = atl.length > 0
        ? atl.reduce((min: MarketPriceSize, item: MarketPriceSize) => Number(item.price) < Number(min.price) ? item : min, atl[0])
        : null;

      return {
        back: bestBack ? Number(bestBack.price) : 0,
        backSize: bestBack ? Number(bestBack.size) : 0,
        lay: bestLay ? Number(bestLay.price) : 0,
        laySize: bestLay ? Number(bestLay.size) : 0,
      };
    }
    
    // Use direct back/lay values if available (no mock data)
    return {
      back: Number(runner.back || runner.backPrice || 0),
      backSize: Number(runner.backSize || runner.volume || 0),
      lay: Number(runner.lay || runner.layPrice || 0),
      laySize: Number(runner.laySize || runner.volume || 0),
    };
  }

export function matchOddsData(runner: MarketRunner, isExchangeMarket: boolean, shouldShowNoOddsMsg: boolean): { backOdds: DepthOdd[]; layOdds: DepthOdd[] } {
    const ex = runner.ex || runner.ex;
    
    // First check for direct back/lay values (most reliable)
    const directBack = Number(runner.back || runner.backPrice || 0);
    const directLay = Number(runner.lay || runner.layPrice || 0);

    // Try exchange odds first
    if (ex) {
      const atb = Array.isArray(ex.availableToBack) ? ex.availableToBack : [];
      const atl = Array.isArray(ex.availableToLay) ? ex.availableToLay : [];
      
      // Filter out invalid odds
      const validBack = atb.filter((item: MarketPriceSize) => Number(item?.price || 0) > 0);
      const validLay = atl.filter((item: MarketPriceSize) => Number(item?.price || 0) > 0);
      
      // If we have valid exchange odds, use them
      if (validBack.length > 0 || validLay.length > 0) {
        const sortedBack = [...validBack].sort((a, b) => Number(a.price) - Number(b.price));
        const backOdds = sortedBack.length >= 3
          ? [
              { value: Number(sortedBack[0]?.price || 0), volume: Math.round(Number(sortedBack[0]?.size || 0)), isMain: false },
              { value: Number(sortedBack[1]?.price || 0), volume: Math.round(Number(sortedBack[1]?.size || 0)), isMain: false },
              { value: Number(sortedBack[2]?.price || 0), volume: Math.round(Number(sortedBack[2]?.size || 0)), isMain: true },
            ]
          : sortedBack.length > 0
          ? sortedBack.map((item: MarketPriceSize, index: number) => ({
              value: Number(item.price || 0),
              volume: Math.round(Number(item.size || 0)),
              isMain: index === sortedBack.length - 1,
            }))
          : (directBack > 0 ? [{ value: directBack, volume: 0, isMain: true }] : [{ value: 0, volume: 0, isMain: true }]);

        const sortedLay = [...validLay].sort((a, b) => Number(a.price) - Number(b.price));
        const layOdds = sortedLay.length >= 3
          ? [
              { value: Number(sortedLay[0]?.price || 0), volume: Math.round(Number(sortedLay[0]?.size || 0)), isMain: true },
              { value: Number(sortedLay[1]?.price || 0), volume: Math.round(Number(sortedLay[1]?.size || 0)), isMain: false },
              { value: Number(sortedLay[2]?.price || 0), volume: Math.round(Number(sortedLay[2]?.size || 0)), isMain: false },
            ]
          : sortedLay.length > 0
          ? sortedLay.map((item: MarketPriceSize, index: number) => ({
              value: Number(item.price || 0),
              volume: Math.round(Number(item.size || 0)),
              isMain: index === 0,
            }))
          : (directLay > 0 ? [{ value: directLay, volume: 0, isMain: true }] : [{ value: 0, volume: 0, isMain: true }]);

        return { backOdds, layOdds };
      }
    }
    
    // Fallback to direct back/lay values if no exchange odds
    if (directBack > 0 || directLay > 0) {
      return {
        backOdds: [
          { value: 0, volume: 0, isMain: false },
          { value: 0, volume: 0, isMain: false },
          { value: directBack, volume: 0, isMain: true }
        ],
        layOdds: [
          { value: directLay, volume: 0, isMain: true },
          { value: 0, volume: 0, isMain: false },
          { value: 0, volume: 0, isMain: false }
        ],
      };
    }
    
    // For exchange markets, if no ex data, show loading/no odds
    if (isExchangeMarket) {
      return {
        backOdds: [
          { value: 0, volume: 0, isMain: false, isLoading: !shouldShowNoOddsMsg },
          { value: 0, volume: 0, isMain: false, isLoading: !shouldShowNoOddsMsg },
          { value: 0, volume: 0, isMain: true, isLoading: !shouldShowNoOddsMsg },
        ],
        layOdds: [
          { value: 0, volume: 0, isMain: true, isLoading: !shouldShowNoOddsMsg },
          { value: 0, volume: 0, isMain: false, isLoading: !shouldShowNoOddsMsg },
          { value: 0, volume: 0, isMain: false, isLoading: !shouldShowNoOddsMsg },
        ],
      };
    }
    
    // For non-exchange markets, use direct back/lay values if available
    const back = Number(runner.back || runner.backPrice || 0);
    const lay = Number(runner.lay || runner.layPrice || 0);
    
    if (back > 0 || lay > 0) {
      return {
        backOdds: [{ value: back, volume: 0, isMain: true }],
        layOdds: [{ value: lay, volume: 0, isMain: true }],
      };
    }
    
    // No odds available
    return {
      backOdds: [{ value: 0, volume: 0, isMain: true }],
      layOdds: [{ value: 0, volume: 0, isMain: true }],
    };
  }

export function fancyRunnerHasBets(runner: MarketRunner, market: EventMarket, bets: EventMarketBet[]): boolean {
    const isFancyMarket = market.kind === 'fancy' || market.type === 'fancy';
    if (!isFancyMarket || !bets || bets.length === 0) return false;
    
    const runnerId = String(runner.id || runner.selectionId || '');
    const runnerSelectionCode = String(runner.selectionCode || '').trim();
    const runnerName = String(runner.name || runner.selection || '').trim();
    const fancyLineId = runner._fancyLine?.id ? String(runner._fancyLine.id) : '';
    const allRunnerIds = [runnerId, runnerSelectionCode, fancyLineId].filter(Boolean);
    
    return bets.some((bet: EventMarketBet) => {
      if (String(bet.status || '').toLowerCase() !== 'matched') return false;
      const marketIds = market._dbMarketIds || [String(market.id)];
      const betMarketId = String(bet.marketId);
      const isMarketMatch = marketIds.some((mid) => String(mid) === betMarketId);
      if (!isMarketMatch) return false;
      
      const betSelectionId = String(bet.selectionId || '').trim();
      const betSelectionName = String(bet.selection || bet.selectionName || '').trim();
      
      const matchesId = allRunnerIds.some((rid) => rid && betSelectionId && String(rid) === String(betSelectionId));
      const normalizedRunnerName = runnerName.trim().toLowerCase().replace(/\s+/g, ' ');
      const normalizedBetName = betSelectionName.trim().toLowerCase().replace(/\s+/g, ' ');
      const matchesName = normalizedRunnerName && normalizedBetName && normalizedRunnerName === normalizedBetName;
      const matchesNamePartial = normalizedRunnerName && normalizedBetName && 
        normalizedRunnerName.length > 5 && normalizedBetName.length > 5 &&
        (normalizedRunnerName.includes(normalizedBetName) || normalizedBetName.includes(normalizedRunnerName));
      
      return matchesId || matchesName || matchesNamePartial;
    });
  }

export interface CutViewer {
  isAgent: boolean; agentId?: string | null; isWhitelabelAdmin: boolean; isSuperAdmin: boolean;
  isSuperAdminInWhitelabelMode: boolean; sharingRate: number | null; viewContext?: BookViewContext | null;
}
export function totalWithCutForEntries(entries: BookEntry[], viewer: CutViewer) {
  const { isAgent, agentId, isWhitelabelAdmin, isSuperAdmin, isSuperAdminInWhitelabelMode, sharingRate, viewContext } = viewer
  const getDirectChildAgentId = (id: string): string | null => {
    if (!viewContext?.directChildAgentIds?.length) return id
    if (viewContext.directChildAgentIds.includes(id)) return id
    for (const directChildId of viewContext.directChildAgentIds) {
      if (viewContext.getDescendantsOf(directChildId).includes(id)) return directChildId
    }
    return null
  }
  let totalWithCutSum = 0
  entries.forEach(entry => {
    let playerRate: number | null = null
    const effectiveAgentId = entry.agentId ? getDirectChildAgentId(entry.agentId) : null
    const rolledAgentInfo = effectiveAgentId ? viewContext?.getAgentInfo?.(effectiveAgentId) : null
    const effectiveAgentRate = rolledAgentInfo?.rate ?? entry.agentRate
    if (isSuperAdmin && !isSuperAdminInWhitelabelMode) {
      playerRate = null
    } else if (effectiveAgentId && effectiveAgentRate) {
      if ((isWhitelabelAdmin || isSuperAdminInWhitelabelMode) && sharingRate !== null) {
        playerRate = Math.max(0, sharingRate - effectiveAgentRate)
      } else if (isAgent && agentId && String(effectiveAgentId) === String(agentId)) {
        playerRate = effectiveAgentRate
      } else {
        playerRate = effectiveAgentRate
      }
    } else {
      playerRate = sharingRate
    }
    totalWithCutSum += calculatePLWithCut(entry.netPL, playerRate).withCut
  })
  return totalWithCutSum
}

