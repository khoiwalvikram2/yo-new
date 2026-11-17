import type { Player, PlayerListStats } from '@/shared/types/player'
import type { ChipAccount } from '@/lib/graphql/chips'
export interface SearchPlayerStats extends PlayerListStats { manualDepositCount?: number | null; manualWithdrawalCount?: number | null }
/** A list row; a credit player also carries its chips account (spec 2026-11-02 §7: Player.chips, batch-resolved). */
export interface SearchPlayer extends Omit<Player, 'stats'> { stats?: SearchPlayerStats; chips?: ChipAccount | null }
export interface StatsRow { playerId: string; stats?: SearchPlayerStats }
export const EMPTY_PLAYERS: SearchPlayer[] = []
export function playerQueryScope(parentType: string, isAgent: boolean) {
  return { parentType: isAgent || parentType === 'ALL' ? undefined : parentType, onlyDirect: isAgent ? parentType === 'DIRECT' ? true : parentType === 'SUB_AGENTS' ? false : undefined : undefined }
}
export const isCreditPlayer = (type?: string | null) => type?.toUpperCase().trim() === 'AGENT_CREDIT' || type?.toUpperCase().trim() === 'WHITELABEL_CREDIT'
export function playerTabOptions(scheme?: string) {
  return scheme === 'COMMISSION' ? [] : scheme ? [{ label: 'All Players', value: 'ALL' }, { label: 'Direct Players', value: 'DIRECT' }, { label: 'Sub-Agent Players', value: 'SUB_AGENTS' }] : [
    { label: 'All Players', value: 'ALL' }, { label: 'Direct Players', value: 'DIRECT' }, { label: 'Sharing Agent Players', value: 'SHARING' }, { label: 'Credit Agent Players', value: 'CREDIT' }, { label: 'Commission Agent Players', value: 'COMMISSION' },
  ]
}
  // Get all possible column headers. A credit player is on chips (spec 2026-11-02 §2): its Balance is its chips,
  // with its Credit Ref and Ref P/L beside it (the old Credit limit/used and Settlement columns are gone).
  export const getAllHeaders = () => {
    return [
      'Player',
      'Status',
      'Balance',
      'Credit Ref',
      'Ref P/L',
      'Deposits/Withdrawals',
      'Performance',
      'Commission',
      'Turnover',
      'Exposure',
      'Last Activity',
      'Actions'
    ]
  }

  // Determine which columns to show based on logged-in agent's scheme type or parentType (selected tab)
  export const shouldShowColumnForParentType = (column: string, parentType: string, loggedInAgentSchemeType?: string) => {
    // Priority 1: If logged-in agent has a scheme type, use it to determine columns
    if (loggedInAgentSchemeType) {
      switch (loggedInAgentSchemeType) {
        case 'SHARING':
          // SHARING Agent: Balance, Deposits/Withdrawals, Performance, Exposure
          return ['Player', 'Status', 'Balance', 'Deposits/Withdrawals', 'Performance', 'Exposure', 'Last Activity', 'Actions'].includes(column)
        
        case 'CREDIT':
          // CREDIT Agent: its players' chips (Balance, Credit Ref, Ref P/L), Performance, Exposure
          return ['Player', 'Status', 'Balance', 'Credit Ref', 'Ref P/L', 'Performance', 'Exposure', 'Last Activity', 'Actions'].includes(column)
        
        case 'COMMISSION':
          // COMMISSION Agent: Balance, Deposits/Withdrawals, Performance, Commission, Turnover, Exposure
          return ['Player', 'Status', 'Balance', 'Deposits/Withdrawals', 'Performance', 'Commission', 'Turnover', 'Exposure', 'Last Activity', 'Actions'].includes(column)
        
        default:
          // Unknown scheme type, fall through to parentType logic
          break
      }
    }

    // Priority 2: For 'ALL' tab, show all columns (mixed player types)
    if (parentType === 'ALL') {
      return true
    }

    // Priority 3: For specific tabs, show only relevant columns
    switch (parentType) {
      case 'DIRECT':
        // DIRECT players: REGULAR or WHITELABEL_CREDIT
        // Balance for both (a whitelabel credit player's is its chips), Credit Ref and Ref P/L (WHITELABEL_CREDIT), Deposits/Withdrawals (REGULAR), Performance, Exposure, Last Activity
        return ['Player', 'Status', 'Balance', 'Credit Ref', 'Ref P/L', 'Deposits/Withdrawals', 'Performance', 'Exposure', 'Last Activity', 'Actions'].includes(column)
      
      case 'SHARING':
        // SHARING_AGENT_PLAYER: Balance, Deposits/Withdrawals, Performance, Exposure, Last Activity
        return ['Player', 'Status', 'Balance', 'Deposits/Withdrawals', 'Performance', 'Exposure', 'Last Activity', 'Actions'].includes(column)
      
      case 'CREDIT':
        // AGENT_CREDIT: chips (Balance, Credit Ref, Ref P/L), Performance, Exposure, Last Activity (NO Deposits/Withdrawals)
        return ['Player', 'Status', 'Balance', 'Credit Ref', 'Ref P/L', 'Performance', 'Exposure', 'Last Activity', 'Actions'].includes(column)
      
      case 'COMMISSION':
        // COMMISSION_AGENT_PLAYER: Balance, Deposits/Withdrawals, Performance, Commission, Turnover, Last Activity
        return ['Player', 'Status', 'Balance', 'Deposits/Withdrawals', 'Performance', 'Commission', 'Turnover', 'Exposure', 'Last Activity', 'Actions'].includes(column)
      
      case 'SUB_AGENTS':
        // Sub-agents' players: depends on agent scheme type, but show all for flexibility
        return true
      
      default:
        return true
    }
  }

  // Determine which columns to show for a specific player (for conditional rendering within rows)
  export const shouldShowColumnForPlayer = (column: string, playerType: string | undefined) => {
    if (!playerType) return true // Show all for unknown types
    
    switch (column) {
      case 'Balance':
        // Every player: the cash wallet, or a credit player's chips
        return true

      case 'Credit Ref':
        // Show only for AGENT_CREDIT, WHITELABEL_CREDIT
        return playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'

      case 'Ref P/L':
        // Show only for AGENT_CREDIT, WHITELABEL_CREDIT
        return playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
      
      case 'Deposits/Withdrawals':
        // Show for REGULAR, SHARING_AGENT_PLAYER, COMMISSION_AGENT_PLAYER
        // Hide for AGENT_CREDIT, WHITELABEL_CREDIT
        return playerType === 'REGULAR' || playerType === 'SHARING_AGENT_PLAYER' || playerType === 'COMMISSION_AGENT_PLAYER'
      
      case 'Performance':
        // Show for all player types (REGULAR, SHARING_AGENT_PLAYER, AGENT_CREDIT, WHITELABEL_CREDIT, COMMISSION_AGENT_PLAYER)
        return true
      
      case 'Commission':
        // Show only for COMMISSION_AGENT_PLAYER
        return playerType === 'COMMISSION_AGENT_PLAYER'
      
      case 'Turnover':
        // Show only for COMMISSION_AGENT_PLAYER
        return playerType === 'COMMISSION_AGENT_PLAYER'
      
      default:
        return true // Show all other columns for all types
    }
  }
