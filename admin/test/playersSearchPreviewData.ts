import type { Operation, FetchResult } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
import type { SearchPlayer } from '../src/routes/players/playersSearchModel'
const playerRows: SearchPlayer[] = [
  { id: 'regular-1', name: 'Preview regular', username: 'regular', phone: '9000000001', email: 'regular@example.test', status: 'ACTIVE', bonusAllowed: true, playerType: 'REGULAR' },
  { id: 'wl-credit-1', name: 'Preview whitelabel credit', username: 'wlcredit', phone: '9000000002', status: 'ACTIVE', bonusAllowed: false, playerType: 'WHITELABEL_CREDIT' },
  { id: 'agent-credit-1', name: 'Preview agent credit', username: 'agentcredit', phone: '9000000003', status: 'ACTIVE', bonusAllowed: false, playerType: 'AGENT_CREDIT', agentId: 'agent-1' },
  { id: 'commission-1', name: 'Preview commission', username: 'commission', phone: '9000000004', status: 'ACTIVE', bonusAllowed: true, playerType: 'COMMISSION_AGENT_PLAYER', agentId: 'agent-commission' },
  { id: 'sharing-1', name: 'Preview sharing', username: 'sharing', phone: '9000000005', status: 'SUSPENDED', bonusAllowed: true, playerType: 'SHARING_AGENT_PLAYER', agentId: 'agent-sharing' },
]
export const searchPlayers = playerRows.map(p => ({ ...p, __typename: 'User', createdAt: '2026-10-09T12:00:00Z', sportsBetAllowed: true, casinoBetAllowed: true, matkaBetAllowed: false, sportsVisible: true, casinoVisible: true, matkaVisible: false, withdrawalLock: false, riskType: 'LOW' as const, requirePasswordReset: false, creditLimit: 1000, creditUsed: 200, creditAvailable: 800, settlementBalance: -50, settlementBalanceSports: -30, settlementBalanceCasino: -20, settlementBalanceMatka: 0, vipTierId: 'vip-1', vipTierName: 'Gold', parentAgent: p.agentId ? { id: p.agentId, username: 'Preview partner', schemeType: p.playerType === 'AGENT_CREDIT' ? 'CREDIT' : p.playerType === 'SHARING_AGENT_PLAYER' ? 'SHARING' : 'COMMISSION', commissionRates: [{ domain: 'sports', rate: 0.05 }], sharingRates: [{ domain: 'sports', rate: 10 }] } : undefined, wallet: { __typename: 'Wallet', userId: p.id, currency: 'INR', balance: 500, bonus: 20, exposure: 10, updatedAt: '2026-10-09T12:00:00Z' }, stats: { totalDeposits: 1000, totalWithdrawals: 100, depositCount: 5, withdrawalCount: 1, manualDepositCount: 2, manualWithdrawalCount: 3, ggr: 50, profitLoss: -50, plTrend: 'down' as const, betCount: 20, lastActivityAt: '2026-10-09T12:00:00Z', lastBetAt: '2026-10-08T12:00:00Z', daysSinceLastBet: 1, turnover: 1000, commissionEarned: 50, commissionTrend: 'up' as const } }))
export interface SearchFixtureOptions { refuseMutation?: string; failUsers?: boolean }
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map(entry => complete(selection, entry))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter(node => node.kind === 'Field').map(field => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'SearchFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export function playersSearchResponse(operation: Operation, options: SearchFixtureOptions = {}): FetchResult {
  const definition = operation.query.definitions.find(node => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing search fixture operation')
  const v = operation.variables
  const player = searchPlayers.find(p => p.id === (v.id || v.userId || v.playerId || v.input?.playerId || v.input?.userId)) || searchPlayers[0]
  let result: Record<string, unknown>
  if (options.refuseMutation === operation.operationName && definition.operation === 'mutation') throw new Error('Preview mutation refused')
  switch (operation.operationName) {
    case 'UsersPage':
      if (options.failUsers) throw new Error('Preview list unavailable')
      result = { usersPage: { items: searchPlayers.map(p => ({ ...p, id: Number(v.offset || 0) ? p.id + '-page2' : p.id })), total: 80 } }; break
    case 'PlayersStatsByIds': result = { playersStatsByIds: v.ids.map((id: string) => ({ playerId: id, stats: searchPlayers.find(p => p.id === id)?.stats || searchPlayers[0].stats })) }; break
    case 'AgentsForPlayerFilter': result = { agents: { agentsPage: { items: [{ id: 'agent-1', username: 'Preview partner', schemeType: v.schemeType || 'CREDIT' }] } } }; break
    case 'PlayerListStats': result = { playersListStats: { totalPlayers: 80, activePlayers: 70, suspendedPlayers: 5, inactivePlayers: 5, totalBalance: 5000, totalBonus: 200, totalExposure: 100, totalCreditLimit: 10000, totalCreditUsed: 2000, highUtilizationCount: 2 } }; break
    case 'RecentRegistrations': result = { usersPage: { items: searchPlayers } }; break
    case 'HighValuePlayers': result = { usersPage: { items: [{ ...searchPlayers[0], id: 'high-value-1', name: 'Preview high-value player', wallet: { ...searchPlayers[0].wallet, userId: 'high-value-1', balance: 2000 } }] } }; break
    case 'DrawerUser': result = { user: player, wallet: player.wallet }; break
    case 'PlayerLimits': result = { playerLimits: { userId: player.id, dailyStakeLimit: 10000, weeklyStakeLimit: 20000, exposureCapOverride: 5000, cooldownSeconds: 5, maxBetSports: 1000, maxBetCasino: 500, maxBetMatka: 100 } }; break
    case 'AgentProfileForDrawer': result = { agents: { agentProfile: { id: v.agentId, username: 'Preview partner', schemeType: 'COMMISSION', commissionRates: [{ domain: 'sports', rate: 0.05 }], sharingRates: [{ domain: 'sports', rate: 10 }] } } }; break
    case 'SetUserStatus': result = { setUserStatus: { success: true, message: 'Status updated', user: { id: player.id, status: v.status } } }; break
    case 'SetRequirePasswordReset': result = { setRequirePasswordReset: { success: true, message: 'Reset updated', user: { id: player.id, requirePasswordReset: v.require } } }; break
    case 'ForceLogout': result = { forceLogoutUser: { success: true, message: 'Logged out' } }; break
    case 'SetUserDomainBets': result = { setUserDomainBets: { success: true, message: 'Permissions updated', user: { id: player.id, sportsBetAllowed: v.sports ?? player.sportsBetAllowed, casinoBetAllowed: v.casino ?? player.casinoBetAllowed, matkaBetAllowed: v.matka ?? player.matkaBetAllowed } } }; break
    case 'UpsertPlayerLimits': result = { upsertPlayerLimits: { success: true, message: 'Limits updated', limits: v.input } }; break
    case 'SetUserBonusAllowed': result = { setUserBonusAllowed: { success: true, message: 'Bonus updated', user: { id: player.id, bonusAllowed: v.allow } } }; break
    case 'SetWithdrawalLock': result = { setWithdrawalLock: { success: true, message: 'Withdrawal updated', user: { id: player.id, withdrawalLock: v.lock } } }; break
    case 'VIPTiers': result = { vipTiers: [{ id: 'vip-1', name: 'Gold', level: 1, status: 'active' }, { id: 'vip-2', name: 'Platinum', level: 2, status: 'active' }] }; break
    case 'SetUserVipTier': result = { setUserVipTier: { id: player.id, vipTierId: v.vipTierId, vipTierName: 'Platinum' } }; break
    case 'AdjustPlayerVipTier': result = { adjustPlayerVipTier: { success: true, message: 'Removed', vipInfo: null } }; break
    case 'AdjustWallet': result = { adjustWallet: { ...player.wallet, balance: 500 + Number(v.amount) } }; break
    case 'AdjustPlayerCredit': result = { adjustPlayerCredit: { success: true, message: 'Credit updated', adjustment: { id: 'adjustment-1', ...v.input } } }; break
    case 'UpdatePlayerRemark': result = { updatePlayerRemark: { success: true, message: 'Remark updated', user: { id: player.id, remark: v.remark } } }; break
    case 'ActiveSpecialBonusCampaigns': result = { activeSpecialBonusCampaigns: [{ id: 'campaign-1', name: 'Preview reward', currency: 'INR', domain: 'casino' }] }; break
    case 'GrantSpecialBonus': result = { grantSpecialBonus: { success: true, message: 'Bonus granted', bonus: { id: 'bonus-1', amount: v.input.amount, currency: 'INR', status: 'active' } } }; break
    case 'PlayerStatsForDrawer': result = { usersPage: { itemsWithStats: [{ stats: player.stats }] } }; break
    case 'CommissionAgentsForMove': result = { agents: { agentsPage: { items: [{ id: 'agent-target', username: 'Target partner', status: 'ACTIVE', schemeType: 'COMMISSION', levelIndex: 1 }, { id: 'agent-commission', username: 'Current partner', status: 'ACTIVE', schemeType: 'COMMISSION' }, { id: 'agent-inactive', username: 'Inactive partner', status: 'INACTIVE', schemeType: 'COMMISSION' }] } } }; break
    case 'MovePlayerPreCheck': result = { movePlayerToAgentPreCheck: { canMove: true, blockers: [], warnings: ['Future commission attribution changes'], player, sourceAgent: { id: 'agent-commission', username: 'Current partner', allowedDomains: ['sports'], commissionRates: [{ domain: 'sports', rate: 0.05 }] }, targetAgent: { id: v.targetAgentId, username: 'Target partner', allowedDomains: ['sports'], commissionRates: [{ domain: 'sports', rate: 0.07 }] }, openBetsCounts: { sports: 0, casino: 0, matka: 0, total: 0 }, activeBonusCount: 0, walletBalance: 500, exposure: 0, commissionCycleStatus: 'SETTLED' } }; break
    case 'MovePlayerToAgent': result = { movePlayerToAgent: { success: true, message: 'Player moved' } }; break
    case 'CurrentWhitelabel': result = { currentWhitelabel: null }; break
    case 'Currencies': result = { currencies: [{ code: 'INR', symbol: '₹', exchangeRateToBase: 1, isBase: true, isActive: true }] }; break
    default: throw new Error('Unexpected Players Search fixture: ' + operation.operationName)
  }
  return { data: complete(definition.selectionSet, result) as Record<string, unknown> }
}
