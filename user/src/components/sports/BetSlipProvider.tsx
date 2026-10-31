import { createContext, useContext, useMemo, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { BetSlipData } from '../sport-event/types'

export interface AddedBetItem {
  team: string
  odds: number
  type: 'back' | 'lay'
  market: string
  teamIndex: number
  stake?: number
  marketId?: string
  selectionId?: string | number
  marketType?: 'exchange' | 'bookmaker' | 'fancy'
  marketCode?: string
}

interface BetSlipContextValue {
  // Quick bet popover
  quickBet: BetSlipData | null
  openQuickBet: (payload: BetSlipData) => void
  closeQuickBet: () => void
  updateQuickBet: (changes: Partial<BetSlipData>) => void

  // Drawer with multiple bets
  items: AddedBetItem[]
  addBet: (item: AddedBetItem) => void
  removeBet: (index: number) => void
  clearBets: () => void
  isDrawerOpen: boolean
  openDrawer: () => void
  closeDrawer: () => void
  
  // Platform detection
  isMobile: boolean
  
  // Bet history
  betCount: number
}

const BetSlipContext = createContext<BetSlipContextValue | undefined>(undefined)

// Detect mobile device - use xl breakpoint (1280px) to match Tailwind's xl: prefix
const getIsMobile = () => {
  if (typeof window === 'undefined') return true // Default to mobile for SSR
  return window.innerWidth < 1280 // xl breakpoint - matches the sidebar's xl:block
}

/* eslint-disable react-refresh/only-export-components */
export function BetSlipProvider({ children }: { children: ReactNode }) {
  const [quickBet, setQuickBet] = useState<BetSlipData | null>(null)
  const [items, setItems] = useState<AddedBetItem[]>([])
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(true) // Default to true, will update on mount
  const [betCount, setBetCount] = useState(0)

  // Initialize and handle window resize for responsive detection
  useEffect(() => {
    // Set correct value immediately on mount
    setIsMobile(getIsMobile())
    
    const handleResize = () => {
      setIsMobile(getIsMobile())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Track bet count from bet-placed events
  useEffect(() => {
    const handleBetPlaced = () => {
      setBetCount(prev => prev + 1)
    }
    window.addEventListener('stakex:bet-placed', handleBetPlaced)
    return () => window.removeEventListener('stakex:bet-placed', handleBetPlaced)
  }, [])

  const openQuickBet = useCallback((payload: BetSlipData) => {
    setQuickBet(payload)
  }, [])
  
  const closeQuickBet = useCallback(() => setQuickBet(null), [])
  
  const updateQuickBet = useCallback((changes: Partial<BetSlipData>) => {
    setQuickBet(prev => (prev ? { ...prev, ...changes } : prev))
  }, [])

  const addBet = useCallback((item: AddedBetItem) => {
    // Check for duplicate
    const exists = items.some(
      i => i.team === item.team && i.market === item.market && i.type === item.type
    )
    if (!exists) {
    setItems(prev => [...prev, item])
    setIsDrawerOpen(true)
  }
  }, [items])

  const removeBet = useCallback((index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }, [])

  const clearBets = useCallback(() => {
    setItems([])
    setQuickBet(null)
  }, [])

  const openDrawer = useCallback(() => setIsDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  const value = useMemo<BetSlipContextValue>(() => ({
    quickBet,
    openQuickBet,
    closeQuickBet,
    updateQuickBet,
    items,
    addBet,
    removeBet,
    clearBets,
    isDrawerOpen,
    openDrawer,
    closeDrawer,
    isMobile,
    betCount,
  }), [quickBet, openQuickBet, closeQuickBet, updateQuickBet, items, addBet, removeBet, clearBets, isDrawerOpen, openDrawer, closeDrawer, isMobile, betCount])

  return (
    <BetSlipContext.Provider value={value}>
      {children}
    </BetSlipContext.Provider>
  )
}

export function useBetSlip() {
  const ctx = useContext(BetSlipContext)
  if (!ctx) throw new Error('useBetSlip must be used within BetSlipProvider')
  return ctx
}

/* eslint-enable react-refresh/only-export-components */


