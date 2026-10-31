import { ChevronDown, Coins } from 'lucide-react'
import { useMemo, useCallback, memo } from 'react'
import type { Market, Bet, EventDetails, BetSlipData, MatchOdds } from './types'
import { useCashoutConfig } from '@/hooks/useCashoutConfig'
import { useSportsSettings } from '@/hooks/useSportsSettings'
import { useRiskConfig } from '@/hooks/useAppSettings'
import CashOutButton from './CashOutButton'
import { notify } from '@/lib/notify'
import { useBetSlip } from '@/components/sports/BetSlipProvider'

interface MarketHeaderProps {
  market: Market
  isExpanded: boolean
  onToggle: () => void
  myBets?: Bet[]
  event?: EventDetails
  liveMap?: Record<string, any>
}

const MarketHeader = memo(function MarketHeader({ 
  market, 
  isExpanded, 
  onToggle, 
  myBets = [], 
  event,
  liveMap,
}: MarketHeaderProps) {
  // Helper function to get valid market ID (not odds)
  // Priority: marketCode > marketId > id (with validation)
  // Also try to get from myBets if market object doesn't have valid ID
  const getValidMarketId = useCallback((): string | null => {
    // Helper to check if value is likely odds (between 1.01 and 1000)
    // More strict: must be a simple number, not a UUID or long string
    const isLikelyOdds = (val: string | number): boolean => {
      if (typeof val === 'number') {
        return val > 1.01 && val < 1000
      }
      const str = String(val).trim()
      // If it's a long string (UUID-like) or contains non-numeric chars (except decimal), it's not odds
      if (str.length > 10 || /[^0-9.]/.test(str)) {
        return false
      }
      const num = parseFloat(str)
      return !isNaN(num) && num > 1.01 && num < 1000
    }
    
    // First try marketCode (most reliable)
    if (market.marketCode) {
      const codeStr = String(market.marketCode).trim()
      if (codeStr.length > 0) {
        // marketCode can be numeric (like "1.251441372") or UUID - accept both
        // Only reject if it's clearly odds (1.01-1000 range)
        if (!isLikelyOdds(codeStr)) {
          return codeStr
        }
      }
    }
    
    // Try market.marketId (from API response)
    if ((market as any).marketId) {
      const mktId = String((market as any).marketId).trim()
      if (mktId.length > 0 && !isLikelyOdds(mktId)) {
        return mktId
      }
    }
    
    // Try market.id (but validate it's not odds)
    // market.id is usually a UUID or long string, so it's likely valid
    if (market.id) {
      const idStr = String(market.id).trim()
      if (idStr.length > 0) {
        // If it's a UUID or long string, it's definitely not odds
        if (idStr.length > 10 || /[^0-9.]/.test(idStr)) {
          return idStr
        }
        // If it's a short numeric string, check if it's odds
        if (!isLikelyOdds(idStr)) {
          return idStr
        }
      }
    }
    
    // Fallback: Try to get marketId from myBets for this market
    if (myBets && myBets.length > 0) {
      // Find a bet that matches this market by name
      const marketName = (market.name || '').toLowerCase().trim()
      const matchingBet = myBets.find(bet => {
        const betMarket = (bet.market || (bet as any).marketName || '').toLowerCase().trim()
        return betMarket === marketName && bet.marketId
      })
      
      if (matchingBet?.marketId) {
        const betMarketId = String(matchingBet.marketId).trim()
        if (betMarketId.length > 0 && !isLikelyOdds(betMarketId)) {
          return betMarketId
        }
      }
    }
    
    // No valid market ID found
    return null
  }, [market, myBets])
  
  // Get cashout config - try both id formats
  const eventIdForCashout = event?.id || event?.eventId || (event as any)?.eventId
  const { isEnabled: isCashoutEnabled, isLoading: isCashoutConfigLoading } = useCashoutConfig(eventIdForCashout)
  const { cashoutEnabled: globalCashoutEnabled } = useRiskConfig()
  
  // Cashout is only enabled if both global and event-specific configs allow it
  const canCashout = globalCashoutEnabled && isCashoutEnabled
  
  // Get sports settings for min/max stake display
  const { settings: sportsSettings } = useSportsSettings(
    event?.sportId && event?.leagueId && eventIdForCashout
      ? {
          sportId: event.sportId,
          leagueId: event.leagueId,
          eventId: eventIdForCashout,
        }
      : undefined
  )

  const { openQuickBet, updateQuickBet, quickBet } = useBetSlip()

  // Calculate cashout value using favorite runner logic (reference approach)
  const cashoutData = useMemo(() => {
    const marketBets = myBets.filter((bet) => {
      const betMarketId = bet.marketId || ''
      const betMarketName = (bet.market || (bet as any).marketName || '').toLowerCase().trim()
      const currentMarketName = (market.name || '').toLowerCase().trim()
      const currentMarketId = market.id || market.marketCode || ''
      
      // Match by marketId or market name (case-insensitive)
      return (currentMarketId && betMarketId === currentMarketId) || (currentMarketName && betMarketName === currentMarketName)
    })
    
    // Cashout calculation
    if (marketBets.length === 0) {
      return { 
        totalCashout: 0, 
        totalStake: 0, 
        betCount: 0, 
        favoriteRunner: null,
        cashoutOdds: 0,
        cashoutStake: 0,
        cashoutType: 'back' as 'back' | 'lay'
      }
    }

    // Get current odds from liveMap if available
    const marketLive = market.marketCode && liveMap ? liveMap[market.marketCode] : null
    const marketLiveData = marketLive?.payload || marketLive

    // Step 1: Calculate P/L for each runner in the market
    // P/L = Profit if THIS runner wins - Loss if OTHER runners win
    const runnerPnlMap = new Map<string, number>()
    const marketOdds = market.odds || []
    
    // Validate market odds exist
    if (!marketOdds || marketOdds.length === 0) {
      return { 
        totalCashout: 0, 
        totalStake: 0, 
        betCount: marketBets.length, 
        favoriteRunner: null,
        cashoutOdds: 0,
        cashoutStake: 0,
        cashoutType: 'back' as 'back' | 'lay'
      }
    }
    
    // Initialize all runners with 0 P/L
    marketOdds.forEach((runner) => {
      if (runner && runner.selection) {
        runnerPnlMap.set(runner.selection, 0)
      }
    })

    // Calculate P/L for each bet - consider all bets in market
    let totalStake = 0
    for (const bet of marketBets) {
      const stake = bet.stake || 0
      const betOdds = bet.odds || 0
      const side = (bet.type || 'back').toLowerCase()
      const betSelection = bet.selection || ''
      
      totalStake += stake

      if (stake > 0 && Number.isFinite(betOdds) && betOdds > 1 && betSelection) {
        // Process bet for all runners
        marketOdds.forEach((runner) => {
          if (!runner || !runner.selection) return
          const isBetSelection = runner.selection === betSelection
          const currentPnl = runnerPnlMap.get(runner.selection) || 0
          
          if (isBetSelection) {
            // Bet is on THIS runner
            if (side === 'back') {
              // If THIS runner wins: profit = stake * (odds - 1)
              runnerPnlMap.set(runner.selection, currentPnl + stake * (betOdds - 1))
            } else {
              // If THIS runner wins: loss = -stake * (odds - 1)
              runnerPnlMap.set(runner.selection, currentPnl - stake * (betOdds - 1))
            }
          } else {
            // Bet is on OTHER runner
            if (side === 'back') {
              // If OTHER runner wins: we lose the stake
              runnerPnlMap.set(runner.selection, currentPnl - stake)
            } else {
              // LAY bet on OTHER runner:
              // If THIS runner wins (OTHER loses): we WIN the stake (keep the stake)
              // So P/L should increase by stake
              runnerPnlMap.set(runner.selection, currentPnl + stake)
            }
          }
        })
      }
    }

    // Step 2: Find favorite runner
    let favoriteRunner: MatchOdds | null = null
    const marketType = (market.marketType || market.type || 'exchange') as string
    
    if (marketType === 'exchange' || marketType === 'EXCHANGE') {
      // Exchange markets: lowest odds ≤ 1.99 wala favorite
      const sortedRunners = [...marketOdds].sort((a, b) => {
        const aOdds = Math.min(a.back || Infinity, a.lay || Infinity)
        const bOdds = Math.min(b.back || Infinity, b.lay || Infinity)
        return aOdds - bOdds
      })
      
      favoriteRunner = sortedRunners.find(r => {
        const odds = Math.min(r.back || Infinity, r.lay || Infinity)
        return odds <= 1.99 && odds > 0
      }) || sortedRunners[0] || null
    } else {
      // Bookmaker markets: status "ACTIVE" wala favorite
      // Since we don't have status in MatchOdds, use first runner or lowest odds
      favoriteRunner = marketOdds[0] || null
    }

    if (!favoriteRunner) {
      return { 
        totalCashout: 0, 
        totalStake, 
        betCount: marketBets.length, 
        favoriteRunner: null,
        cashoutOdds: 0,
        cashoutStake: 0,
        cashoutType: 'back' as 'back' | 'lay'
      }
    }

    // Step 3: Calculate stake to make ALL runners have same book after bet
    // Strategy: Calculate average of OTHER runners' books (excluding favorite), then place bet on favorite to match that average
    // This ensures that when favorite wins, all books are approximately equal
    const favoritePnl = runnerPnlMap.get(favoriteRunner.selection) || 0
    
    // Get OTHER runners' P/L values (excluding favorite)
    const otherRunnersPnl: number[] = []
    runnerPnlMap.forEach((pnl, selection) => {
      if (selection !== favoriteRunner.selection && Number.isFinite(pnl)) {
        otherRunnersPnl.push(pnl)
      }
    })
    
    // If no other runners, no cashout needed
    if (otherRunnersPnl.length === 0) {
      return { 
        totalCashout: 0, 
        totalStake, 
        betCount: marketBets.length, 
        favoriteRunner: null,
        cashoutOdds: 0,
        cashoutStake: 0,
        cashoutType: 'back' as 'back' | 'lay'
      }
    }
    
    // Calculate average of OTHER runners' books (this is the target for favorite)
    const averageOtherPnl = otherRunnersPnl.reduce((sum, val) => sum + val, 0) / otherRunnersPnl.length
    
    // Calculate difference: what favorite needs to match the average of OTHER runners
    const favoritePnlDifference = favoritePnl - averageOtherPnl

    // Step 5: Get current odds for favorite runner only
    // For BACK cashout: use MAXIMUM back odds from favorite runner (e.g., from [1.65, 1.66, 1.67] take 1.67)
    // For LAY cashout: use MINIMUM lay odds from favorite runner (e.g., from [1.68, 1.69, 1.70] take 1.68)
    let currentBackOdds = favoriteRunner.back || 0
    let currentLayOdds = favoriteRunner.lay || 0

    // Check if favorite runner has exchange data with availableToBack/availableToLay arrays
    const favoriteRunnerEx = (favoriteRunner as any)?.ex
    if (favoriteRunnerEx) {
      const availableToBack = Array.isArray(favoriteRunnerEx.availableToBack) ? favoriteRunnerEx.availableToBack : []
      const availableToLay = Array.isArray(favoriteRunnerEx.availableToLay) ? favoriteRunnerEx.availableToLay : []
      
      // For BACK: take MAXIMUM (highest) from availableToBack array
      if (availableToBack.length > 0) {
        const backPrices = availableToBack
          .map((item: any) => Number(item?.price || 0))
          .filter((price: number) => Number.isFinite(price) && price > 1)
        if (backPrices.length > 0) {
          currentBackOdds = Math.max(...backPrices)
        }
      }
      
      // For LAY: take MINIMUM (lowest) from availableToLay array
      if (availableToLay.length > 0) {
        const layPrices = availableToLay
          .map((item: any) => Number(item?.price || 0))
          .filter((price: number) => Number.isFinite(price) && price > 1)
        if (layPrices.length > 0) {
          currentLayOdds = Math.min(...layPrices)
        }
      }
    }

    // Update with live data if available
    if (marketLiveData && market.odds) {
      const liveSelection = market.odds.find((o) => o && o.selection === favoriteRunner.selection)
      if (liveSelection) {
        // Check if live selection has exchange data
        const liveEx = (liveSelection as any)?.ex
        if (liveEx) {
          const availableToBack = Array.isArray(liveEx.availableToBack) ? liveEx.availableToBack : []
          const availableToLay = Array.isArray(liveEx.availableToLay) ? liveEx.availableToLay : []
          
          // For BACK: take MAXIMUM from availableToBack
          if (availableToBack.length > 0) {
            const backPrices = availableToBack
              .map((item: any) => Number(item?.price || 0))
              .filter((price: number) => Number.isFinite(price) && price > 1)
            if (backPrices.length > 0) {
              currentBackOdds = Math.max(...backPrices)
            }
          }
          
          // For LAY: take MINIMUM from availableToLay
          if (availableToLay.length > 0) {
            const layPrices = availableToLay
              .map((item: any) => Number(item?.price || 0))
              .filter((price: number) => Number.isFinite(price) && price > 1)
            if (layPrices.length > 0) {
              currentLayOdds = Math.min(...layPrices)
            }
          }
        } else {
          // Fallback to single back/lay values
          if (liveSelection.back && Number.isFinite(liveSelection.back) && liveSelection.back > 1) {
            currentBackOdds = liveSelection.back
          }
          if (liveSelection.lay && Number.isFinite(liveSelection.lay) && liveSelection.lay > 1) {
            currentLayOdds = liveSelection.lay
          }
        }
      }
    }

    // Step 6: Calculate stake to make ALL runners have same book
    // Strategy: Make books equal when EITHER runner wins
    // Formula: If BACK bet on favorite with stake S at odds O:
    //   When favorite wins: favorite's book = favoritePnl + S*(O-1)
    //   When other wins: other's book = averageOtherPnl - S
    //   For equality: favoritePnl + S*(O-1) = averageOtherPnl - S
    //   S*(O-1) + S = averageOtherPnl - favoritePnl
    //   S*O = averageOtherPnl - favoritePnl
    //   S = (averageOtherPnl - favoritePnl) / O
    
    // If LAY bet on favorite with stake S at odds O:
    //   When favorite wins: favorite's book = favoritePnl - S*(O-1)
    //   When other wins: other's book = averageOtherPnl + S
    //   For equality: favoritePnl - S*(O-1) = averageOtherPnl + S
    //   favoritePnl - averageOtherPnl = S + S*(O-1)
    //   favoritePnl - averageOtherPnl = S*O
    //   S = (favoritePnl - averageOtherPnl) / O
    
    let cashoutType: 'back' | 'lay' = 'back'
    let cashoutOdds = currentBackOdds
    let cashoutStake = 0
    let totalCashout = 0

    const MIN_ODDS = 1.01

    // If all runners already have same book (difference is very small), no cashout needed
    if (Math.abs(favoritePnlDifference) < 0.01) {
      return { 
        totalCashout: 0, 
        totalStake, 
        betCount: marketBets.length, 
        favoriteRunner: null,
        cashoutOdds: 0,
        cashoutStake: 0,
        cashoutType: 'back' as 'back' | 'lay'
      }
    }

    // Determine cashout bet type and calculate stake
    if (favoritePnlDifference > 0) {
      // Favorite's book > average of others → LAY bet to reduce it
      // Formula: S = (favoritePnl - averageOtherPnl) / layOdds
      cashoutType = 'lay'
      cashoutOdds = currentLayOdds
      
      if (Number.isFinite(cashoutOdds) && cashoutOdds >= MIN_ODDS && cashoutOdds > 1) {
        cashoutStake = favoritePnlDifference / cashoutOdds
        totalCashout = cashoutStake
      } else {
        return { 
          totalCashout: 0, 
          totalStake, 
          betCount: marketBets.length, 
          favoriteRunner: null,
          cashoutOdds: 0,
          cashoutStake: 0,
          cashoutType: 'back' as 'back' | 'lay'
        }
      }
    } else {
      // Favorite's book < average of others → BACK bet to increase it
      // Formula: S = (averageOtherPnl - favoritePnl) / backOdds
      cashoutType = 'back'
      cashoutOdds = currentBackOdds
      
      if (Number.isFinite(cashoutOdds) && cashoutOdds >= MIN_ODDS && cashoutOdds > 1) {
        cashoutStake = Math.abs(favoritePnlDifference) / cashoutOdds
        totalCashout = cashoutStake
      } else {
        return { 
          totalCashout: 0, 
          totalStake, 
          betCount: marketBets.length, 
          favoriteRunner: null,
          cashoutOdds: 0,
          cashoutStake: 0,
          cashoutType: 'back' as 'back' | 'lay'
        }
      }
    }

    // Ensure values are reasonable and finite
    // Cap at a very high value (1 crore) to prevent unreasonably large stakes, but allow calculated value
    const MAX_REASONABLE_STAKE = 10000000 // 1 crore
    
    // Validate and cap values
    if (!Number.isFinite(cashoutStake) || cashoutStake < 0) {
      cashoutStake = 0
    }
    if (!Number.isFinite(totalCashout) || totalCashout < 0) {
      totalCashout = 0
    }
    
    // Only cap if stake is unreasonably large (safety check)
    cashoutStake = Math.min(cashoutStake, MAX_REASONABLE_STAKE)
    // totalCashout should equal cashoutStake (the stake amount user gets)
    totalCashout = cashoutStake
    
    // Round values to avoid floating point issues
    cashoutStake = Math.floor(cashoutStake * 100) / 100
    totalCashout = Math.floor(totalCashout * 100) / 100
    
    // Final validation
    if (!Number.isFinite(cashoutStake) || cashoutStake < 0) {
      cashoutStake = 0
    }
    if (!Number.isFinite(totalCashout) || totalCashout < 0) {
      totalCashout = 0
    }

    // Debug logging (only in development)
    if (import.meta.env.DEV && marketBets.length > 0 && favoriteRunner && cashoutStake > 0) {
      // Note: This block contains debug calculations that are not currently used
      // const favoriteBets = marketBets.filter(bet => {
      //   const betSelection = bet.selection || ''
      //   return betSelection === favoriteRunner.selection
      // })
      // const hasBackBets = favoriteBets.some(bet => {
      //   const betType = (bet.type || 'back').toLowerCase()
      //   return betType === 'back'
      // })
      // const hasLayBets = favoriteBets.some(bet => {
      //   const betType = (bet.type || 'back').toLowerCase()
      //   return betType === 'lay'
      // })
      
      // Calculate what books will be AFTER placing cashout bet (when favorite wins)
      // const booksAfterCashout = new Map<string, number>()
      // runnerPnlMap.forEach((pnl, selection) => {
      //   if (selection === favoriteRunner.selection) {
      //     // Favorite's book after cashout bet
      //     if (cashoutType === 'back') {
      //       // BACK bet: if favorite wins, profit = stake * (odds - 1)
      //       booksAfterCashout.set(selection, pnl + cashoutStake * (cashoutOdds - 1))
      //     } else {
      //       // LAY bet: if favorite wins, loss = -stake * (odds - 1)
      //       booksAfterCashout.set(selection, pnl - cashoutStake * (cashoutOdds - 1))
      //     }
      //   } else {
      //     // Other runners' books unchanged
      //     booksAfterCashout.set(selection, pnl)
      //   }
      // })
      
      // Calculate average of books after cashout
      // const booksAfterArray = Array.from(booksAfterCashout.values())
      // const avgAfterCashout = booksAfterArray.reduce((sum, val) => sum + val, 0) / booksAfterArray.length
      
      // Calculate max difference after cashout
      // const maxBookAfter = Math.max(...booksAfterArray)
      // const minBookAfter = Math.min(...booksAfterArray)
      // const maxDifferenceAfter = maxBookAfter - minBookAfter
    }

    return {
      totalCashout: Math.max(0, totalCashout),
      totalStake,
      betCount: marketBets.length,
      favoriteRunner,
      cashoutOdds,
      cashoutStake,
      cashoutType,
    }
  }, [myBets, market, liveMap])

  // Handle opening bet slip with cashout data (favorite runner approach)
  // This function recalculates cashout using latest live odds when called
  const handleOpenCashoutBetSlip = useCallback(() => {
    // Recalculate cashout data with latest live odds
    const marketBets = myBets.filter((bet) => {
      const betMarketId = bet.marketId || ''
      const betMarketName = (bet.market || (bet as any).marketName || '').toLowerCase().trim()
      const currentMarketName = (market.name || '').toLowerCase().trim()
      const currentMarketId = market.id || market.marketCode || ''
      
      return (currentMarketId && betMarketId === currentMarketId) || (currentMarketName && betMarketName === currentMarketName)
    })
    
    if (marketBets.length === 0) {
      return
    }

    // Get latest live data
    const marketLive = market.marketCode && liveMap ? liveMap[market.marketCode] : null
    const marketLiveData = marketLive?.payload || marketLive
    const marketOdds = market.odds || []
    
    if (marketOdds.length === 0) {
      return
    }

    // Find favorite runner (same logic as cashoutData)
    let favoriteRunner: MatchOdds | null = null
    const marketType = (market.marketType || market.type || 'exchange') as string
    
    if (marketType === 'exchange' || marketType === 'EXCHANGE') {
      const sortedRunners = [...marketOdds].sort((a, b) => {
        const aOdds = Math.min(a.back || Infinity, a.lay || Infinity)
        const bOdds = Math.min(b.back || Infinity, b.lay || Infinity)
        return aOdds - bOdds
      })
      
      favoriteRunner = sortedRunners.find(r => {
        const odds = Math.min(r.back || Infinity, r.lay || Infinity)
        return odds <= 1.99 && odds > 0
      }) || sortedRunners[0] || null
    } else {
      favoriteRunner = marketOdds[0] || null
    }

    if (!favoriteRunner) {
      return
    }

    // Calculate P/L for favorite runner (same logic as cashoutData useMemo)
    // This ensures consistency between button value and bet slip stake
    const runnerPnlMap = new Map<string, number>()
    marketOdds.forEach((runner) => {
      if (runner && runner.selection) {
        runnerPnlMap.set(runner.selection, 0)
      }
    })

    // Calculate P/L for each bet - same logic as cashoutData
    for (const bet of marketBets) {
      const stake = bet.stake || 0
      const betOdds = bet.odds || 0
      const side = (bet.type || 'back').toLowerCase()
      const betSelection = bet.selection || ''
      
      if (stake > 0 && Number.isFinite(betOdds) && betOdds > 1 && betSelection) {
        marketOdds.forEach((runner) => {
          if (!runner || !runner.selection) return
          const isBetSelection = runner.selection === betSelection
          const currentPnl = runnerPnlMap.get(runner.selection) || 0
          
          if (isBetSelection) {
            if (side === 'back') {
              runnerPnlMap.set(runner.selection, currentPnl + stake * (betOdds - 1))
            } else {
              runnerPnlMap.set(runner.selection, currentPnl - stake * (betOdds - 1))
            }
          } else {
            if (side === 'back') {
              runnerPnlMap.set(runner.selection, currentPnl - stake)
            } else {
              // LAY bet on OTHER runner: If THIS runner wins, we WIN the stake
              runnerPnlMap.set(runner.selection, currentPnl + stake)
            }
          }
        })
      }
    }
    
    // Calculate average book of OTHER runners (excluding favorite)
    // Calculate stake to make favorite's book equal to average of other runners
    const favoritePnl = runnerPnlMap.get(favoriteRunner.selection) || 0
    
    // Get OTHER runners' P/L values (excluding favorite)
    const otherRunnersPnl: number[] = []
    runnerPnlMap.forEach((pnl, selection) => {
      if (selection !== favoriteRunner.selection && Number.isFinite(pnl)) {
        otherRunnersPnl.push(pnl)
      }
    })
    
    if (otherRunnersPnl.length === 0) {
      return
    }
    
    // Calculate average of OTHER runners' books (this is the target for favorite)
    const averageOtherPnl = otherRunnersPnl.reduce((sum, val) => sum + val, 0) / otherRunnersPnl.length
    const favoritePnlDifference = favoritePnl - averageOtherPnl

    if (Math.abs(favoritePnlDifference) < 0.01) {
      return
    }
    if (!favoriteRunner || !favoriteRunner.selection) {
      return
    }

    // Get current odds for favorite runner only
    // For BACK cashout: use MAXIMUM back odds from favorite runner (e.g., from [1.65, 1.66, 1.67] take 1.67)
    // For LAY cashout: use MINIMUM lay odds from favorite runner (e.g., from [1.68, 1.69, 1.70] take 1.68)
    let currentBackOdds = favoriteRunner.back || 0
    let currentLayOdds = favoriteRunner.lay || 0

    // Check if favorite runner has exchange data with availableToBack/availableToLay arrays
    const favoriteRunnerEx = (favoriteRunner as any)?.ex
    if (favoriteRunnerEx) {
      const availableToBack = Array.isArray(favoriteRunnerEx.availableToBack) ? favoriteRunnerEx.availableToBack : []
      const availableToLay = Array.isArray(favoriteRunnerEx.availableToLay) ? favoriteRunnerEx.availableToLay : []
      
      // For BACK: take MAXIMUM (highest) from availableToBack array
      if (availableToBack.length > 0) {
        const backPrices = availableToBack
          .map((item: any) => Number(item?.price || 0))
          .filter((price: number) => Number.isFinite(price) && price > 1)
        if (backPrices.length > 0) {
          currentBackOdds = Math.max(...backPrices)
        }
      }
      
      // For LAY: take MINIMUM (lowest) from availableToLay array
      if (availableToLay.length > 0) {
        const layPrices = availableToLay
          .map((item: any) => Number(item?.price || 0))
          .filter((price: number) => Number.isFinite(price) && price > 1)
        if (layPrices.length > 0) {
          currentLayOdds = Math.min(...layPrices)
        }
      }
    }

    // Update with live data if available
    if (marketLiveData && market.odds && Array.isArray(market.odds)) {
      const liveSelection = market.odds.find((o) => o && o.selection === favoriteRunner.selection)
      if (liveSelection) {
        // Check if live selection has exchange data
        const liveEx = (liveSelection as any)?.ex
        if (liveEx) {
          const availableToBack = Array.isArray(liveEx.availableToBack) ? liveEx.availableToBack : []
          const availableToLay = Array.isArray(liveEx.availableToLay) ? liveEx.availableToLay : []
          
          // For BACK: take MAXIMUM from availableToBack
          if (availableToBack.length > 0) {
            const backPrices = availableToBack
              .map((item: any) => Number(item?.price || 0))
              .filter((price: number) => Number.isFinite(price) && price > 1)
            if (backPrices.length > 0) {
              currentBackOdds = Math.max(...backPrices)
            }
          }
          
          // For LAY: take MINIMUM from availableToLay
          if (availableToLay.length > 0) {
            const layPrices = availableToLay
              .map((item: any) => Number(item?.price || 0))
              .filter((price: number) => Number.isFinite(price) && price > 1)
            if (layPrices.length > 0) {
              currentLayOdds = Math.min(...layPrices)
            }
          }
        } else {
          // Fallback to single back/lay values
          if (liveSelection.back && Number.isFinite(liveSelection.back) && liveSelection.back > 1) {
            currentBackOdds = liveSelection.back
          }
          if (liveSelection.lay && Number.isFinite(liveSelection.lay) && liveSelection.lay > 1) {
            currentLayOdds = liveSelection.lay
          }
        }
      }
    }

    // Find team index in market odds
    const marketOddsForIndex = market.odds || []
    const teamIndex = marketOddsForIndex.findIndex((o) => o && o.selection === favoriteRunner.selection)
    const finalTeamIndex = teamIndex >= 0 ? teamIndex : 0

    // Determine cashout type and calculate stake to make ALL runners approximately equal
    // Strategy: Place opposite bet on favorite to neutralize the difference
    // If favoritePnl > averageOtherPnl → LAY bet to reduce favorite's book
    // If favoritePnl < averageOtherPnl → BACK bet to increase favorite's book
    const cashoutType = favoritePnlDifference > 0 ? 'lay' : 'back'
    
    // Use latest odds based on cashout type
    // For BACK: use MAXIMUM back odds (best for user)
    // For LAY: use MINIMUM lay odds (best for user)
    const cashoutOdds = cashoutType === 'back' ? currentBackOdds : currentLayOdds
    
    // Validate odds
    if (!cashoutOdds || cashoutOdds <= 1 || !Number.isFinite(cashoutOdds)) {
      notify.error('Invalid odds for cashout. Please try again.')
      return
    }

    // Calculate stake to make all runners' books approximately equal
    // Formula: S = |favoritePnl - averageOtherPnl| / (odds - 1) for BACK
    // Formula: S = |favoritePnl - averageOtherPnl| / (odds - 1) for LAY
    // This ensures that when the bet is placed, the favorite's book moves towards the average
    const MIN_ODDS = 1.01
    let cashoutStake = 0
    
    if (Number.isFinite(cashoutOdds) && cashoutOdds >= MIN_ODDS) {
      // For BACK bet: When favorite wins +S*(O-1), when other wins -S → Total spread = S*O
      // For LAY bet: When favorite wins -S*(O-1), when other wins +S → Total spread = S*O
      // So stake needed = difference / O
      cashoutStake = Math.abs(favoritePnlDifference) / cashoutOdds
    }
    
    // Validate stake (only cap if unreasonably large)
    const MAX_REASONABLE_STAKE = 10000000 // 1 crore - safety cap
    cashoutStake = Math.max(0, Math.min(cashoutStake, MAX_REASONABLE_STAKE))
    cashoutStake = Math.floor(cashoutStake * 100) / 100
    
    if (!cashoutStake || cashoutStake <= 0 || !Number.isFinite(cashoutStake)) {
      notify.error('Invalid cashout stake. Please try again.')
      return
    }

    // Get valid market ID using helper function
    const marketId = getValidMarketId()
    
    if (!marketId) {
      const errorMsg = 'Market ID not found. Please try again.'
      notify.error(errorMsg)
      return
    }
    
    // Market ID resolved

    // Always update/refresh bet slip with latest calculated values
    // This ensures stake and odds match what's shown in the cashout button
    const finalStake = Number.isFinite(cashoutStake) ? Math.floor(cashoutStake) : 0
    
    // Check if bet slip is open for this market (either cashout or regular bet)
    const isBetSlipOpenForThisMarket = quickBet && (
      (quickBet.marketId === marketId) || 
      (quickBet.market && quickBet.market.toLowerCase().trim() === (market.name || '').toLowerCase().trim())
    )
    
    if (isBetSlipOpenForThisMarket) {
      // Update existing bet slip (cashout or regular) with cashout values
      updateQuickBet({
        team: favoriteRunner.selection || '',
        odds: cashoutOdds,
        stake: finalStake,
        backOdds: currentBackOdds,
        layOdds: currentLayOdds,
        type: cashoutType,
        isCashout: true,
        cashoutMarketId: marketId,
      })
    } else {
      // Open new cashout bet slip with latest values
      const betSlipData: BetSlipData = {
        team: favoriteRunner.selection || '',
        odds: cashoutOdds,
        type: cashoutType,
        market: market.name || '',
        teamIndex: finalTeamIndex,
        stake: finalStake,
        marketId: marketId,
        marketType: (market.marketType || market.type) as 'exchange' | 'bookmaker' | 'fancy',
        marketCode: market.marketCode,
        selectionId: favoriteRunner.selectionId,
        backOdds: currentBackOdds,
        layOdds: currentLayOdds,
        isCashout: true,
        cashoutMarketId: marketId,
      }
      openQuickBet(betSlipData)
    }
    
    // Bet slip updated
  }, [myBets, market, liveMap, openQuickBet, updateQuickBet, quickBet, cashoutData])

  // Show cashout button only when value is more than 10 (in base currency)
  const showCashoutButton = 
    !isCashoutConfigLoading && 
    canCashout && 
    cashoutData.betCount > 0 && 
    cashoutData.totalCashout > 10

  // Volume from odds (back/lay sizes) for display
  const volumeDisplay = useMemo(() => {
    const odds = market.odds || []
    let total = 0
    odds.forEach((o: any) => {
      const ex = o?.ex
      if (ex) {
        const atb = Array.isArray(ex.availableToBack) ? ex.availableToBack : []
        const atl = Array.isArray(ex.availableToLay) ? ex.availableToLay : []
        atb.forEach((x: any) => { total += Number(x?.size || 0) })
        atl.forEach((x: any) => { total += Number(x?.size || 0) })
      } else if (Number.isFinite(o?.volume)) total += Number(o.volume)
    })
    if (total >= 1000000) return `${(total / 1000000).toFixed(3)}M`
    if (total >= 1000) return `${(total / 1000).toFixed(0)}K`
    return String(Math.round(total))
  }, [market.odds])

  return (
    <div 
      className="nova-ev-market-head"
      onClick={onToggle}
    >
      <div className="flex flex-1 min-w-0 items-center justify-between gap-2">
        {/* Left: Market Name + Volume */}
        <div className="nova-ev-market-title">
          <h3>{market.name}</h3>
          {volumeDisplay !== '0' && <p>{volumeDisplay}</p>}
        </div>
        
        {/* Right: Cashout, Limits & Toggle */}
        <div className="nova-ev-market-tools">
          {showCashoutButton && (
            <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
              <CashOutButton
                betId={getValidMarketId() || ''}
                currentValue={cashoutData.totalCashout || 0}
                onOpenBetSlip={handleOpenCashoutBetSlip}
                showLabel={true}
              />
            </div>
          )}
          {(() => {
            // Get min/max stake based on market type
            const marketType = (market.marketType || market.type || 'exchange').toLowerCase()
            const marketSettings = marketType === 'fancy' 
              ? sportsSettings?.fancy 
              : marketType === 'bookmaker' 
              ? sportsSettings?.bookmaker 
              : sportsSettings?.exchange
            
            // Only show if valid config values exist (not null/undefined)
            const minStake = marketSettings?.minStake
            const maxStake = marketSettings?.maxStake
            
            // Don't show if no config is set
            if (minStake == null || maxStake == null || !Number.isFinite(minStake) || !Number.isFinite(maxStake)) {
              return null
            }
            
            // Format numbers for display
            const formatNumber = (num: number): string => {
              if (num >= 1000000) {
                return `${(num / 1000000).toFixed(1)}M`
              } else if (num >= 1000) {
                return `${(num / 1000).toFixed(0)}K`
              }
              return String(num)
            }
            
            const minFormatted = formatNumber(minStake)
            const maxFormatted = formatNumber(maxStake)
            
            return (
          <span className="nova-ev-limits" title="Min - max stake">
            <Coins aria-hidden="true" />
            {minFormatted} - {maxFormatted}
          </span>
            )
          })()}
          {/* The whole bar toggles; this button gives keyboard and screen reader users the same control. */}
          <button type="button" className="nova-ev-market-toggle" aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${market.name}`}>
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Only re-render if:
  // 1. Market ID or name changes
  // 2. Expanded state changes
  // 3. MyBets count changes (for cashout button)
  // 4. LiveMap timestamp for THIS market changes
  
  const prevLive = prevProps.liveMap?.[prevProps.market.marketCode as string]
  const nextLive = nextProps.liveMap?.[nextProps.market.marketCode as string]
  const prevLiveTs = prevLive?._ts
  const nextLiveTs = nextLive?._ts
  
  return (
    prevProps.market.id === nextProps.market.id &&
    prevProps.market.name === nextProps.market.name &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.myBets?.length === nextProps.myBets?.length &&
    prevLiveTs === nextLiveTs
  )
})

export default MarketHeader
