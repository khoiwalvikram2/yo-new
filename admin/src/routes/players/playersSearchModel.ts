import type { Player, PlayerListStats } from '@/shared/types/player'
export interface SearchPlayerStats extends PlayerListStats { manualDepositCount?: number | null; manualWithdrawalCount?: number | null }
export interface SearchPlayer extends Omit<Player, 'stats'> { stats?: SearchPlayerStats }
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
  // Get all possible column headers
  export const getAllHeaders = () => {
    return [
      'Player',
      'Status',
      'Balance',
      'Credit',
      'Settlement',
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
          // CREDIT Agent: Credit, Settlement, Performance, Exposure
          return ['Player', 'Status', 'Credit', 'Settlement', 'Performance', 'Exposure', 'Last Activity', 'Actions'].includes(column)
        
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
        // Show both Balance and Credit (for WHITELABEL_CREDIT), Settlement (for WHITELABEL_CREDIT), Deposits/Withdrawals (for REGULAR), Performance, Exposure, Last Activity
        return ['Player', 'Status', 'Balance', 'Credit', 'Settlement', 'Deposits/Withdrawals', 'Performance', 'Exposure', 'Last Activity', 'Actions'].includes(column)
      
      case 'SHARING':
        // SHARING_AGENT_PLAYER: Balance, Deposits/Withdrawals, Performance, Exposure, Last Activity
        return ['Player', 'Status', 'Balance', 'Deposits/Withdrawals', 'Performance', 'Exposure', 'Last Activity', 'Actions'].includes(column)
      
      case 'CREDIT':
        // AGENT_CREDIT: Credit, Settlement, Performance, Exposure, Last Activity (NO Balance, NO Deposits/Withdrawals)
        return ['Player', 'Status', 'Credit', 'Settlement', 'Performance', 'Exposure', 'Last Activity', 'Actions'].includes(column)
      
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
        // Show for REGULAR, SHARING_AGENT_PLAYER, COMMISSION_AGENT_PLAYER
        // Hide for AGENT_CREDIT, WHITELABEL_CREDIT
        return playerType !== 'AGENT_CREDIT' && playerType !== 'WHITELABEL_CREDIT'
      
      case 'Credit':
        // Show only for AGENT_CREDIT, WHITELABEL_CREDIT
        return playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
      
      case 'Settlement':
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
