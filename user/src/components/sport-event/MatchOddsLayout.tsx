import type { Market, EventDetails, BetSlipData, Bet } from "./types";
import OddsButton from "./OddsButton";
import { Lock, AlertCircle } from "lucide-react";
import { memo, useState, useEffect, useRef } from "react";
import { formatAmount } from "@/lib/currency";

interface MatchOddsLayoutProps {
  market: Market;
  event: EventDetails;
  betSlip: BetSlipData | null;
  myBets?: Bet[];
  onOddsClick: (
    team: string,
    odds: number,
    type: "back" | "lay",
    market: string,
    teamIndex: number,
    event: React.MouseEvent,
    extras?: { marketId?: string; marketType?: 'exchange' | 'bookmaker' | 'fancy'; marketCode?: string; selectionId?: string | number; backOdds?: number; layOdds?: number }
  ) => void;
}

function MatchOddsLayout({
  market,
  betSlip,
  myBets = [],
  onOddsClick,
}: MatchOddsLayoutProps) {
  // Use runner names from market data to ensure correct mapping to selectionId and live odds
  const baseRunners = (() => {
    const arr = Array.isArray(market.odds) ? market.odds : []
    if (arr.length >= 3) return [arr[0], arr[1], arr[2]]
    if (arr.length === 2) return [arr[0], arr[1]]
    return arr
  })()

  const maxRows = Math.min(3, baseRunners.length)
  const teamData = baseRunners.slice(0, maxRows).map((runner) => ({
    team: runner.selection,
    odds: [runner],
  }));

  // Track loading start time for each runner to detect 10+ second loading
  const loadingStartTimeRef = useRef<Map<string, number>>(new Map());
  const [showNoOdds, setShowNoOdds] = useState<Map<string, boolean>>(new Map());

  // Check loading duration for each runner
  useEffect(() => {
    const isExchangeMarket = market.marketType === 'exchange' || market.type === 'match-odds';
    if (!isExchangeMarket) return;

    const checkLoading = () => {
      const now = Date.now();
      const newShowNoOdds = new Map(showNoOdds);
      let hasChanges = false;

      teamData.forEach((teamData, teamIndex) => {
        const base = teamData.odds[0];
        const apiData = (base as any)?.ex;
        const availableToBack = apiData?.availableToBack || [];
        const availableToLay = apiData?.availableToLay || [];
        const hasNoExchangeOdds = availableToBack.length === 0 && availableToLay.length === 0;
        const runnerKey = `${market.id}-${teamIndex}`;

        if (hasNoExchangeOdds) {
          // Still loading - track start time or check if 10 seconds passed
          if (!loadingStartTimeRef.current.has(runnerKey)) {
            loadingStartTimeRef.current.set(runnerKey, now);
          } else {
            const startTime = loadingStartTimeRef.current.get(runnerKey)!;
            const elapsed = now - startTime;
            if (elapsed >= 10000 && !newShowNoOdds.get(runnerKey)) {
              newShowNoOdds.set(runnerKey, true);
              hasChanges = true;
            }
          }
        } else {
          // Data arrived - reset loading state
          if (loadingStartTimeRef.current.has(runnerKey)) {
            loadingStartTimeRef.current.delete(runnerKey);
          }
          if (newShowNoOdds.get(runnerKey)) {
            newShowNoOdds.delete(runnerKey);
            hasChanges = true;
          }
        }
      });

      if (hasChanges) {
        setShowNoOdds(newShowNoOdds);
      }
    };

    const interval = setInterval(checkLoading, 500); // Check every 500ms
    checkLoading(); // Initial check

    return () => clearInterval(interval);
  }, [market.id, market.marketType, market.type, teamData, showNoOdds]);

  return (
    <div className="bg-transparent" data-market-group>
      {/* Column Headers */}
      <div className="nova-ev-cols flex items-center px-1">
        <div className="flex-1 px-2 sm:px-3">
          <span className="nova-ev-cols-label">Selection</span>
        </div>
        <div className="min-w-[105px] sm:min-w-[340px] ml-auto">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-1">
            {/* Back Headers - hidden on mobile except main position */}
            <div className="hidden sm:flex w-[52px] sm:w-16 items-center justify-center" />
            <div className="hidden sm:flex w-[52px] sm:w-16 items-center justify-center" />
            <div className="flex w-[52px] sm:w-16 items-center justify-center">
              <span className="nova-ev-cols-label is-back">Back</span>
            </div>
            {/* Lay Headers - hidden on mobile except main position */}
            <div className="flex w-[52px] sm:w-16 items-center justify-center">
              <span className="nova-ev-cols-label is-lay">Lay</span>
            </div>
            <div className="hidden sm:flex w-[52px] sm:w-16 items-center justify-center" />
            <div className="hidden sm:flex w-[52px] sm:w-16 items-center justify-center" />
          </div>
        </div>
      </div>

      {/* Odds Rows */}
      {teamData.map((teamData, teamIndex) => {
        const base = teamData.odds[0];
        const apiData = (base as any)?.ex;
        const availableToBack = apiData?.availableToBack || [];
        const availableToLay = apiData?.availableToLay || [];
        
        // Check if this is an exchange market and data is loading
        // For exchange markets, if we don't have availableToBack/availableToLay data, show loading skeleton
        // instead of default/fallback odds
        const isExchangeMarket = market.marketType === 'exchange' || market.type === 'match-odds';
        const hasNoExchangeOdds = availableToBack.length === 0 && availableToLay.length === 0;
        const runnerKey = `${market.id}-${teamIndex}`;
        const shouldShowNoOdds = showNoOdds.get(runnerKey) || false;
        // Show loading skeleton for exchange markets when exchange odds data is not available
        // But if loading > 10 seconds, show "No odds" message instead
        const isLoadingExchange = isExchangeMarket && hasNoExchangeOdds && !shouldShowNoOdds;

        // Create back odds from API data
        let backOdds = [];
        if (availableToBack.length >= 3) {
          const sortedBack = [...availableToBack].sort(
            (a, b) => Number(a.price) - Number(b.price)
          );
          backOdds = [
            { value: Number(sortedBack[0]?.price || 0), volume: Math.round(Number(sortedBack[0]?.size || 0)), isMain: false },
            { value: Number(sortedBack[1]?.price || 0), volume: Math.round(Number(sortedBack[1]?.size || 0)), isMain: false },
            { value: Number(sortedBack[2]?.price || 0), volume: Math.round(Number(sortedBack[2]?.size || 0)), isMain: true },
          ];
        } else if (availableToBack.length > 0) {
          backOdds = availableToBack.map((item: any, index: number) => ({
            value: Number(item.price || 0),
            volume: Math.round(Number(item.size || 0)),
            isMain: index === availableToBack.length - 1,
          }));
        } else if (isLoadingExchange) {
          // Show loading skeleton for exchange markets
          backOdds = [
            { value: 0, volume: 0, isMain: false, isLoading: true },
            { value: 0, volume: 0, isMain: false, isLoading: true },
            { value: 0, volume: 0, isMain: true, isLoading: true },
          ];
        } else {
          // Fallback to default odds only for non-exchange markets
          backOdds = [
            { value: Math.max(1.01, (base.back ?? 0) - 0.02), volume: Math.round((base.volume || 1000) * 0.7), isMain: false },
            { value: Math.max(1.01, (base.back ?? 0) - 0.01), volume: Math.round((base.volume || 1000) * 0.85), isMain: false },
            { value: base.back ?? 0, volume: Math.round(base.volume || 1000), isMain: true },
          ];
        }

        // Create lay odds from API data
        let layOdds = [];
        if (availableToLay.length >= 3) {
          const sortedLay = [...availableToLay].sort(
            (a, b) => Number(a.price) - Number(b.price)
          );
          layOdds = [
            { value: Number(sortedLay[0]?.price || 0), volume: Math.round(Number(sortedLay[0]?.size || 0)), isMain: true },
            { value: Number(sortedLay[1]?.price || 0), volume: Math.round(Number(sortedLay[1]?.size || 0)), isMain: false },
            { value: Number(sortedLay[2]?.price || 0), volume: Math.round(Number(sortedLay[2]?.size || 0)), isMain: false },
          ];
        } else if (availableToLay.length > 0) {
          layOdds = availableToLay.map((item: any, index: number) => ({
            value: Number(item.price || 0),
            volume: Math.round(Number(item.size || 0)),
            isMain: index === 0,
          }));
        } else if (isLoadingExchange) {
          // Show loading skeleton for exchange markets
          layOdds = [
            { value: 0, volume: 0, isMain: true, isLoading: true },
            { value: 0, volume: 0, isMain: false, isLoading: true },
            { value: 0, volume: 0, isMain: false, isLoading: true },
          ];
        } else {
          // Fallback to default odds only for non-exchange markets
          layOdds = [
            { value: base.lay ?? 0, volume: Math.round(base.volume || 1000), isMain: true },
            { value: (base.lay ?? 0) + 0.01, volume: Math.round((base.volume || 1000) * 0.7), isMain: false },
            { value: (base.lay ?? 0) + 0.02, volume: Math.round((base.volume || 1000) * 0.85), isMain: false },
          ];
        }

        return (
          <div
            key={teamIndex}
            className="nova-ev-runner"
          >
            {/* Row content */}
            <div className="flex items-center py-1.5" data-market-row>
              {/* Team Name & P&L */}
              <div className="flex-1 px-2 sm:px-3 min-w-0">
                <div className="nova-ev-runner-name truncate">
                  {teamData.team}
                </div>
                {/* P&L Display */}
                <div className="flex items-center gap-1 mt-0.5">
                  {(() => {
                    // Get ALL bets for this market (not just this selection)
                    const allMarketBets = (myBets || []).filter((bet: any) => {
                      const betMarket = bet.market || (bet as any).marketName || '';
                      return betMarket === market.name;
                    });

                    // Get bets for this specific selection (calculated but not used)
                    // const selectionBets = allMarketBets.filter((bet: any) => {
                    //   const betTeam = bet.selection || bet.team || '';
                    //   return betTeam === teamData.team;
                    // });

                    // Calculate current book for this selection
                    // Book = Profit if THIS selection wins - Liability if OTHER selections win
                    let currentBook = 0;
                    
                    // If there are any bets in the market, calculate book for all selections
                    if (allMarketBets.length > 0) {
                      // Process ALL bets in the market to calculate net book position
                      allMarketBets.forEach((bet: any) => {
                        const stake = Number(bet.stake || 0);
                        const odds = Number(bet.odds || bet.price || 0);
                        const side = (bet.type || bet.side || 'back').toLowerCase();
                        const betTeam = bet.selection || bet.team || '';
                        const isThisSelection = betTeam === teamData.team;
                        
                        if (stake > 0 && Number.isFinite(odds) && odds > 1) {
                          if (isThisSelection) {
                            // Bet is on THIS selection
                            if (side === 'back') {
                              // If THIS selection wins: profit = stake * (odds - 1)
                              currentBook += stake * (odds - 1);
                            } else {
                              // If THIS selection wins: profit = stake, but we risked stake * (odds - 1)
                              // Net profit = stake - stake * (odds - 1) = stake * (2 - odds)
                              // Actually, for lay: if selection wins, we lose stake * (odds - 1)
                              // So book should decrease by liability
                              currentBook -= stake * (odds - 1);
                            }
                          } else {
                            // Bet is on OTHER selection
                            if (side === 'back') {
                              // If OTHER selection wins: we lose the stake we bet on it
                              currentBook -= stake;
                            } else {
                              // LAY bet on OTHER selection:
                              // If THIS selection wins (OTHER loses): we WIN the stake (keep the stake)
                              // So book should increase by stake
                              currentBook += stake;
                            }
                          }
                        }
                      });
                    }

                    // Check if bet slip is open with stakes for this market
                    const hasActiveBetSlip = betSlip && betSlip.market === market.name && betSlip.stake && betSlip.stake > 0;
                    const isBetSlipForThisSelection = hasActiveBetSlip && betSlip.team === teamData.team;

                    // Calculate potential book (current + bet slip)
                    let potentialBook = currentBook;
                    if (hasActiveBetSlip) {
                      const stake = betSlip.stake || 0;
                      const odds = betSlip.odds || 0;
                      if (stake > 0 && Number.isFinite(odds) && odds > 1) {
                        if (betSlip.type === "back") {
                          // BACK bet: If THIS selection wins: profit = stake * (odds - 1)
                          //           If OTHER selection wins: lose stake
                          potentialBook += isBetSlipForThisSelection ? stake * (odds - 1) : -stake;
                        } else {
                          // LAY bet: If THIS selection wins: lose liability = stake * (odds - 1)
                          //          If OTHER selection wins: win stake
                          potentialBook += isBetSlipForThisSelection ? -stake * (odds - 1) : stake;
                        }
                      }
                    }

                    // Show P&L if there are any bets in the market or active bet slip
                    if (allMarketBets.length === 0 && !hasActiveBetSlip) {
                      return null;
                    }

                    const formatPnl = (pnl: number) => formatAmount(Math.abs(pnl));

                    // Show "from → to" format when bet slip is open with stakes
                    if (hasActiveBetSlip && (currentBook !== potentialBook || allMarketBets.length > 0)) {
                      return (
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] sm:text-xs font-medium tabular-nums ${currentBook >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {formatPnl(currentBook)}
                          </span>
                          <span className="text-[9px] sm:text-[10px] text-[color:var(--subtle)]">→</span>
                          <span className={`text-[10px] sm:text-xs font-bold tabular-nums ${potentialBook >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {formatPnl(potentialBook)}
                        </span>
                        </div>
                      );
                    }

                    // Show just current book when no active bet slip or no change
                    const formatted = formatPnl(currentBook);
                    return (
                      <span className={`text-[10px] sm:text-xs font-medium tabular-nums ${currentBook >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {formatted}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Odds Grid */}
              <div className="relative ml-auto min-w-[105px] sm:min-w-[340px]">
                {/* Show "No odds" message if loading > 10 seconds */}
                {shouldShowNoOdds && hasNoExchangeOdds ? (
                  <div className="flex items-center justify-center py-3 px-4 rounded-lg bg-[color:var(--brand-primary)]/10 border border-[color:var(--brand-primary)]/20">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-[color:var(--brand-primary)]" />
                      <span className="text-[11px] font-medium text-[color:var(--brand-primary)]">
                        No odds available
                      </span>
                    </div>
                  </div>
                ) : (
                <div
                  className={`grid grid-cols-2 sm:grid-cols-6 gap-1 ${
                    market.status === "suspended" ? "opacity-30 pointer-events-none" : ""
                  }`}
                >
                  {/* Back odds */}
                  {backOdds.map((odds: any, idx: number) => {
                    // Get main back and lay odds for the bet slip
                    const mainBackOdds = backOdds.find((o: any) => o.isMain)?.value || backOdds[backOdds.length - 1]?.value || 0;
                    const mainLayOdds = layOdds.find((o: any) => o.isMain)?.value || layOdds[0]?.value || 0;
                    
                    // Show loading skeleton for exchange markets when data is loading
                    if (odds.isLoading) {
                      return (
                        <div
                          key={`back-loading-${idx}`}
                          className={`
                            relative overflow-hidden
                            w-[52px] sm:w-16 h-11 sm:h-12 
                            flex flex-col items-center justify-center 
                            rounded-[5px] border
                            ${idx !== 2 ? 'hidden sm:flex' : 'flex'}
                            ${odds.isMain 
                              ? 'bg-[rgb(0,178,255)]/20 border-[rgba(0,178,255,0.3)]' 
                              : 'bg-[rgb(0,178,255)]/15 border-[rgba(0,178,255,0.3)]'
                            }
                          `}
                        >
                          <div className="w-10 h-4 bg-[rgb(0,178,255)]/30 rounded animate-pulse" />
                          <div className="w-8 h-2.5 bg-[rgb(0,178,255)]/20 rounded mt-1 animate-pulse" style={{ animationDelay: '0.2s' }} />
                        </div>
                      );
                    }
                    
                    return (
                    <OddsButton
                      key={`back-${idx}`}
                      value={odds.value}
                      volume={odds.volume}
                      isMain={odds.isMain}
                      type="back"
                      onClick={(e) =>
                        onOddsClick(
                          teamData.team,
                          odds.value,
                          "back",
                          market.name,
                          teamIndex,
                          e,
                          {
                            marketId: market.id,
                            marketType: market.marketType as any,
                            marketCode: (market as any).marketCode,
                            selectionId: market.odds?.[teamIndex]?.selectionId,
                              backOdds: mainBackOdds,
                              layOdds: mainLayOdds,
                          }
                        )
                      }
                      isVisible={idx === 2}
                    />
                    );
                  })}

                  {/* Lay odds */}
                  {layOdds.map((odds: any, idx: number) => {
                    // Get main back and lay odds for the bet slip
                    const mainBackOdds = backOdds.find((o: any) => o.isMain)?.value || backOdds[backOdds.length - 1]?.value || 0;
                    const mainLayOdds = layOdds.find((o: any) => o.isMain)?.value || layOdds[0]?.value || 0;
                    
                    // Show loading skeleton for exchange markets when data is loading
                    if (odds.isLoading) {
                      return (
                        <div
                          key={`lay-loading-${idx}`}
                          className={`
                            relative overflow-hidden
                            w-[52px] sm:w-16 h-11 sm:h-12 
                            flex flex-col items-center justify-center 
                            rounded-[5px] border
                            ${idx !== 0 ? 'hidden sm:flex' : 'flex'}
                            ${odds.isMain 
                              ? 'bg-[rgb(255,122,127)]/20 border-[rgba(255,122,127,0.3)]' 
                              : 'bg-[rgb(255,122,127)]/15 border-[rgba(255,122,127,0.3)]'
                            }
                          `}
                        >
                          <div className="w-10 h-4 bg-[rgb(255,122,127)]/30 rounded animate-pulse" />
                          <div className="w-8 h-2.5 bg-[rgb(255,122,127)]/20 rounded mt-1 animate-pulse" style={{ animationDelay: '0.2s' }} />
                        </div>
                      );
                    }
                    
                    return (
                    <OddsButton
                      key={`lay-${idx}`}
                      value={odds.value}
                      volume={odds.volume}
                      isMain={odds.isMain}
                      type="lay"
                      onClick={(e) =>
                        onOddsClick(
                          teamData.team,
                          odds.value,
                          "lay",
                          market.name,
                          teamIndex,
                          e,
                          {
                            marketId: market.id,
                            marketType: market.marketType as any,
                            marketCode: (market as any).marketCode,
                            selectionId: market.odds?.[teamIndex]?.selectionId,
                              backOdds: mainBackOdds,
                              layOdds: mainLayOdds,
                          }
                        )
                      }
                      isVisible={idx === 0}
                    />
                    );
                  })}
                </div>
                )}

                {/* Suspended Overlay - prominent centered button like reference */}
                {market.status === "suspended" && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg" aria-label="Market suspended">
                    <div className="absolute inset-0 bg-[color:var(--ds-color-slate-900)]/90 rounded-lg" />
                    <button
                      type="button"
                      disabled
                      className="relative z-10 inline-flex items-center gap-2 px-6 py-3 rounded-[5px] text-sm font-bold uppercase tracking-wide text-[color:var(--mb-on-red)] bg-[color:var(--brand-primary)]/80 border-2 border-[color:var(--brand-primary)]/60 shadow-lg cursor-not-allowed"
                    >
                      <Lock className="h-5 w-5" />
                      <span>Suspended</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>
        );
      })}
    </div>
  );
}

// Helper to extract a minimal signature for comparing odds without deep-cloning
function getRunnerSignature(r: any) {
  const ex = r?.ex
  const atb = Array.isArray(ex?.availableToBack) ? ex.availableToBack : []
  const atl = Array.isArray(ex?.availableToLay) ? ex.availableToLay : []
  const back = atb.length ? Number(atb[atb.length - 1]?.price) : (r?.back !== undefined ? Number(r.back) : undefined)
  const lay = atl.length ? Number(atl[0]?.price) : (r?.lay !== undefined ? Number(r.lay) : undefined)
  const backSize = atb.length ? Number(atb[atb.length - 1]?.size) : (r?.volume !== undefined ? Number(r.volume) : undefined)
  const laySize = atl.length ? Number(atl[0]?.size) : (r?.volume !== undefined ? Number(r.volume) : undefined)
  const selId = r?.selectionId !== undefined ? String(r.selectionId) : undefined
  const selName = (r?.selection || r?.selectionName || r?.runnerName || r?.name || '').toString().toLowerCase().trim()
  return `${selId || ''}|${selName}|${back || ''}|${lay || ''}|${backSize || ''}|${laySize || ''}`
}

function arePropsEqual(prev: MatchOddsLayoutProps, next: MatchOddsLayoutProps) {
  if (prev.market.id !== next.market.id) return false
  if (prev.market.name !== next.market.name) return false
  if (prev.market.status !== next.market.status) return false

  const prevOdds = Array.isArray(prev.market.odds) ? prev.market.odds : []
  const nextOdds = Array.isArray(next.market.odds) ? next.market.odds : []
  const len = Math.max(prevOdds.length, nextOdds.length, 3)
  for (let i = 0; i < Math.min(3, len); i++) {
    const a = prevOdds[i] || {}
    const b = nextOdds[i] || {}
    if (getRunnerSignature(a) !== getRunnerSignature(b)) return false
  }

  const mName = next.market.name
  const a = prev.betSlip && prev.betSlip.market === mName ? prev.betSlip : null
  const b = next.betSlip && next.betSlip.market === mName ? next.betSlip : null
  if (!a && !b) {
    // Check myBets if no active bet slip
    const prevBets = prev.myBets || []
    const nextBets = next.myBets || []
    if (prevBets.length !== nextBets.length) return false
    // Simple comparison - if bets changed, re-render
    const prevBetIds = prevBets.map(b => b.id).sort().join(',')
    const nextBetIds = nextBets.map(b => b.id).sort().join(',')
    return prevBetIds === nextBetIds
  }
  if (!a || !b) return false
  if (a.type !== b.type) return false
  if (a.team !== b.team) return false
  if (Number(a.odds) !== Number(b.odds)) return false
  if (Number(a.stake) !== Number(b.stake)) return false

  return true
}

export default memo(MatchOddsLayout, arePropsEqual)
