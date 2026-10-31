import { useState, memo } from 'react'
import { TrendingUp } from 'lucide-react'
import { formatAmount } from '@/lib/currency'

interface CashOutButtonProps {
  betId: string | number
  currentValue: number
  /** @deprecated Cashout = hedge bet only; use onOpenBetSlip */
  onCashOut?: (betId: string | number, amount: number) => Promise<void>
  /** Open bet slip with hedge bet pre-filled (cashout = place one normal bet) */
  onOpenBetSlip?: () => void
  showLabel?: boolean
}

const CashOutButton = memo(function CashOutButton({ 
  betId, 
  currentValue, 
  onCashOut,
  onOpenBetSlip,
  showLabel = true
}: CashOutButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  
  const handleClick = () => {
    if (onOpenBetSlip) {
      onOpenBetSlip()
    } else if (onCashOut) {
      handleCashOut()
    }
  }
  
  const handleCashOut = async () => {
    if (!onCashOut) return
    setIsLoading(true)
    try {
      await onCashOut(betId, currentValue)
    } catch (_error) {
      // Cash out failed
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className="px-2.5 py-1 rounded-md text-[9px] sm:text-[10px] font-bold transition-all bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-emerald-600 dark:text-emerald-400 hover:from-emerald-500/30 hover:to-emerald-600/20 border border-emerald-500/40 hover:border-emerald-500/60 hover:shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 group"
    >
      <TrendingUp className="h-3 w-3 group-hover:scale-110 transition-transform flex-shrink-0" />
      {showLabel && <span className="whitespace-nowrap">Cashout</span>}
      <span className="tabular-nums font-semibold">{formatAmount(currentValue)}</span>
    </button>
  )
}, (prevProps, nextProps) => {
  // Only re-render if currentValue changes
  return (
    prevProps.betId === nextProps.betId &&
    prevProps.currentValue === nextProps.currentValue &&
    prevProps.showLabel === nextProps.showLabel
  )
})

export default CashOutButton

