import { useMemo } from 'react'
import { TrendingUp, TrendingDown, BarChart3, Target, ArrowRight } from 'lucide-react'
import { formatAmount } from '@/lib/currency'
import ModalSurface from '../modals/ModalSurface'

interface FancyBookDisplayProps {
  bets: Array<{
    selection: string
    odds: number
    stake: number
    type: 'back' | 'lay'
    odds_size?: number
  }>
  isOpen: boolean
  onClose: () => void
  marketName?: string
}

export default function FancyBookDisplay({ bets, isOpen, onClose, marketName }: FancyBookDisplayProps) {
  
  // Calculate statistics
  const statistics = useMemo(() => {
    const totalBackStake = bets.filter(b => b.type === 'back').reduce((sum, b) => sum + b.stake, 0)
    const totalLayStake = bets.filter(b => b.type === 'lay').reduce((sum, b) => sum + b.stake, 0)
    const totalBets = bets.length
    const backBets = bets.filter(b => b.type === 'back').length
    const layBets = bets.filter(b => b.type === 'lay').length
    
    return {
      totalBackStake,
      totalLayStake,
      totalBets,
      backBets,
      layBets,
      totalStake: totalBackStake + totalLayStake,
    }
  }, [bets])
  
  // Calculate book for all positions
  const bookData = useMemo(() => {
    if (!bets || bets.length === 0) return []

    // Step 1: Find min and max odds from all bets
    const allOdds = bets.map(b => b.odds).filter(o => o > 0)
    if (allOdds.length === 0) return []

    const minOdd = Math.min(...allOdds)
    const maxOdd = Math.max(...allOdds)

    // Step 2: Create range (min - 5 to max + 5)
    const rangeStart = Math.max(1, Math.floor(minOdd) - 5)
    const rangeEnd = Math.floor(maxOdd) + 5
    const positions: number[] = []
    for (let i = rangeStart; i <= rangeEnd; i++) {
      positions.push(i)
    }

    // Step 3: Calculate P/L for each position
    const bookEntries = positions.map(position => {
      let netPnl = 0

      bets.forEach(bet => {
        const oddsSize = bet.odds_size || 100
        const oddsSizePercent = oddsSize / 100
        const stake = bet.stake || 0

        if (bet.type === 'back') {
          // BACK bet
          if (position >= bet.odds) {
            // Result >= Odds → WIN → Profit = Stake × (OddsSize/100)
            netPnl += stake * oddsSizePercent
          } else {
            // Result < Odds → LOSS → Loss = Stake
            netPnl -= stake
          }
        } else {
          // LAY bet
          if (position < bet.odds) {
            // Result < Odds → WIN → Profit = Stake
            netPnl += stake
          } else {
            // Result >= Odds → LOSS → Loss = Stake × (OddsSize/100)
            netPnl -= stake * oddsSizePercent
          }
        }
      })

      return {
        position,
        pnl: netPnl,
      }
    })

    return bookEntries
  }, [bets])

  // Show all book data (no filtering)
  const filteredBookData = useMemo(() => {
    return bookData
  }, [bookData])
  
  // Find best position
  const bestPosition = useMemo(() => {
    if (bookData.length === 0) return null
    return bookData.reduce((best, curr) => curr.pnl > best.pnl ? curr : best, bookData[0])
  }, [bookData])
  
  // Find worst position
  const worstPosition = useMemo(() => {
    if (bookData.length === 0) return null
    return bookData.reduce((worst, curr) => curr.pnl < worst.pnl ? curr : worst, bookData[0])
  }, [bookData])

  // Placed after every hook: `isOpen` toggles, so returning above the useMemo
  // calls would change hook count between renders and crash the component.
  if (!isOpen) return null

  return (
    <ModalSurface open={isOpen} onClose={onClose} title="Fancy Book Analysis" description={marketName} size="lg" className="nova-analysis-modal">
      <div className="nova-modal-body flex flex-col min-h-0">
        
        {/* Statistics Cards - Total Bets, Best Position, and Worst Position */}
        <div className="p-2 sm:p-4 bg-[color:var(--surface-2)]/50 border-b border-[color:var(--border)]/30">
          <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
            {/* Total Bets Card */}
            <div className="bg-[color:var(--surface)] rounded-lg p-1.5 sm:p-3 border border-[color:var(--border)]/30">
              <div className="flex items-center justify-center sm:justify-start gap-1 sm:gap-2 mb-0.5 sm:mb-1">
                <Target className="w-2.5 h-2.5 sm:w-4 sm:h-4 text-purple-500" />
                <span className="text-[8px] sm:text-[10px] text-[color:var(--subtle)] font-medium">Total<span className="hidden sm:inline"> Bets</span></span>
              </div>
              <div className="flex flex-col items-center gap-0.5 sm:flex-row sm:items-center sm:gap-4 mt-1 sm:mt-2">
                <div className="flex items-center gap-0.5 sm:gap-2">
                  <TrendingUp className="w-2.5 h-2.5 sm:w-4 sm:h-4 text-sky-500" />
                  <span className="hidden sm:inline text-xs text-[color:var(--subtle)]">Back:</span>
                  <p className="text-[9px] sm:text-sm font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                    {statistics.backBets}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 sm:gap-2">
                  <TrendingDown className="w-2.5 h-2.5 sm:w-4 sm:h-4 text-rose-500" />
                  <span className="hidden sm:inline text-xs text-[color:var(--subtle)]">Lay:</span>
                  <p className="text-[9px] sm:text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                    {statistics.layBets}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Best Position Card */}
            {bestPosition && (
              <div className="bg-emerald-500/10 rounded-lg p-1.5 sm:p-3 border border-emerald-500/20">
                <div className="flex items-center justify-center sm:justify-start gap-1 sm:gap-2 mb-0.5 sm:mb-1">
                  <TrendingUp className="w-2.5 h-2.5 sm:w-4 sm:h-4 text-emerald-500" />
                  <span className="text-[8px] sm:text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Best<span className="hidden sm:inline"> Position</span></span>
                </div>
                <div className="flex flex-col items-center gap-0.5 sm:flex-row sm:items-center sm:gap-1 mt-1 sm:mt-2">
                  <p className="text-[9px] sm:text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums text-center sm:text-left">
                    {bestPosition.position}
                  </p>
                  <span className="hidden sm:inline text-emerald-600 dark:text-emerald-400">→</span>
                  <p className="text-[9px] sm:text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums text-center sm:text-left">
                    +{formatAmount(Math.abs(bestPosition.pnl))}
                  </p>
                </div>
              </div>
            )}
            
            {/* Worst Position Card */}
            {worstPosition && (
              <div className="bg-rose-500/10 rounded-lg p-1.5 sm:p-3 border border-rose-500/20">
                <div className="flex items-center justify-center sm:justify-start gap-1 sm:gap-2 mb-0.5 sm:mb-1">
                  <TrendingDown className="w-2.5 h-2.5 sm:w-4 sm:h-4 text-rose-500" />
                  <span className="text-[8px] sm:text-[10px] text-rose-600 dark:text-rose-400 font-medium">Worst<span className="hidden sm:inline"> Position</span></span>
                </div>
                <div className="flex flex-col items-center gap-0.5 sm:flex-row sm:items-center sm:gap-1 mt-1 sm:mt-2">
                  <p className="text-[9px] sm:text-xs font-bold text-rose-600 dark:text-rose-400 tabular-nums text-center sm:text-left">
                    {worstPosition.position}
                  </p>
                  <span className="hidden sm:inline text-rose-600 dark:text-rose-400">→</span>
                  <p className="text-[9px] sm:text-xs font-bold text-rose-600 dark:text-rose-400 tabular-nums text-center sm:text-left">
                    -{formatAmount(Math.abs(worstPosition.pnl))}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Book Table */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          {filteredBookData.length === 0 ? (
            <div className="text-center py-8 sm:py-12">
              <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-[5px] bg-[color:var(--surface-2)] mb-2 sm:mb-3">
                <BarChart3 className="w-6 h-6 sm:w-8 sm:h-8 text-[color:var(--subtle)]" />
              </div>
              <p className="text-xs sm:text-sm text-[color:var(--subtle)] font-medium">
                No bets found for this market
              </p>
            </div>
          ) : (
            <div className="space-y-1 sm:space-y-1.5">
              {filteredBookData.map((entry, index) => {
                const isPositive = entry.pnl >= 0
                const prevEntry = index > 0 ? filteredBookData[index - 1] : null
                const showDivider = prevEntry && ((prevEntry.pnl < 0 && entry.pnl >= 0) || (prevEntry.pnl >= 0 && entry.pnl < 0))

                return (
                  <div key={entry.position}>
                    {showDivider && (
                      <div className="relative my-2 sm:my-3">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-dashed border-[color:var(--border)]" />
                        </div>
                        <div className="relative flex justify-center">
                          <span className="px-1.5 sm:px-2 text-[9px] sm:text-[10px] bg-[color:var(--surface)] text-[color:var(--subtle)] font-medium">
                            Break Even
                          </span>
                        </div>
                      </div>
                    )}
                    <div
                      className={`group relative flex items-center justify-between p-2 sm:p-3 rounded-lg transition-all duration-200 border ${
                        isPositive
                          ? 'bg-gradient-to-r from-emerald-500/5 to-emerald-500/10 hover:from-emerald-500/10 hover:to-emerald-500/15 border-emerald-500/20 hover:border-emerald-500/30 hover:shadow-sm hover:shadow-emerald-500/10'
                          : 'bg-gradient-to-r from-rose-500/5 to-rose-500/10 hover:from-rose-500/10 hover:to-rose-500/15 border-rose-500/20 hover:border-rose-500/30 hover:shadow-sm hover:shadow-rose-500/10'
                      }`}
                    >
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className={`flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-lg font-bold text-[10px] sm:text-xs ${
                          isPositive 
                            ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                            : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                        }`}>
                          {entry.position}
                        </div>
                        <ArrowRight className={`w-3 h-3 sm:w-4 sm:h-4 transition-transform group-hover:translate-x-1 ${
                          isPositive ? 'text-emerald-500/60' : 'text-rose-500/60'
                        }`} />
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        {isPositive ? (
                          <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-500" strokeWidth={2} />
                        ) : (
                          <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4 text-rose-500" strokeWidth={2} />
                        )}
                        <span
                          className={`text-xs sm:text-sm font-bold tabular-nums ${
                            isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {isPositive ? '+' : '-'}{formatAmount(Math.abs(entry.pnl))}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2 sm:p-4 border-t border-[color:var(--border)]/40 bg-gradient-to-r from-[color:var(--surface-2)]/50 to-[color:var(--surface)]/50">
          <div className="flex items-center justify-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-[color:var(--subtle)]">
            <BarChart3 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Showing potential P/L for each result position</span>
            <span className="sm:hidden">P/L for each position</span>
          </div>
        </div>
      </div>
    </ModalSurface>
  )
}

