import type { Operation, FetchResult } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'

function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map(item => complete(selection, item))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter(node => node.kind === 'Field').map(field => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'BonusFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export const bonusCampaignFixture = {
  id: '42', name: 'Weekend reload rewards', domain: 'global', type: 'deposit', status: 'active', currency: 'INR',
  budgetNumeric: 250000, codeMode: 'auto_code', validFrom: '2026-09-22T09:00:00Z', validTo: '2026-12-22T18:29:59Z',
  depositConditionType: 'greater_than', depositConditionAmount: 1000, distributionType: 'roll_over', amountType: 'percentage',
  amount: null, percentage: 25, numberOfPlayers: 500, usagePerPlayer: 2, startDate: '2026-09-22T09:00:00Z', endDate: '2026-12-22T18:29:59Z',
  wagering: 3, expiryBonusDays: 7, depositRequired: true, releaseType: 'total_bonus_wallet',
  casinoGameIds: ['101'], matkaGameIds: ['m1'], casinoGameWeights: { 101: 2 }, matkaBidTypeWeights: { m1: { SINGLE: 2 } },
  rulesJson: { excludedPlayerIds: ['p2'], excludedAgentIds: ['a2'], preservedRule: 'keep' }, limitsJson: { preservedLimit: 5 },
  createdAt: '2026-09-22T09:00:00Z', updatedAt: '2026-10-09T09:00:00Z',
}
export interface BonusFixtureState { campaign: Record<string, unknown> | null; refused?: boolean; queryError?: boolean }
export function bonusDetailResponse(operation: Operation, state: BonusFixtureState): FetchResult {
  let result: Record<string, unknown>
  switch (operation.operationName) {
    case 'GetBonusCampaign': result = { bonusCampaign: state.campaign }; break
    case 'CasinoGames': {
      const input = operation.variables.input as { category?: string; search?: string }
      const items = [
        { id: '101', name: 'Golden Roulette', vendorName: 'Evolution', vendorId: 'v1', mainCategory: 'CASINO', slug: 'golden-roulette' },
        { id: '102', name: 'Dragon Slots', vendorName: 'Evolution', vendorId: 'v1', mainCategory: 'SLOTS', slug: 'dragon-slots' },
      ].filter(item => item.mainCategory === input.category && (!input.search || item.name.toLowerCase().includes(input.search.toLowerCase())))
      result = { casinoGames: { items, total: items.length, page: 1, pageSize: 1000 } }; break
    }
    case 'CasinoSelectionGames': {
      const input = operation.variables.input as { includeGameIds?: string[]; excludeGameIds?: string[]; search?: string; page?: number; pageSize?: number }
      const rows = [
        { id: '101', name: 'Golden Roulette', vendorName: 'Evolution', vendorId: 'v1', mainCategory: 'CASINO', slug: 'golden-roulette' },
        { id: '102', name: 'Dragon Slots', vendorName: 'Evolution', vendorId: 'v1', mainCategory: 'SLOTS', slug: 'dragon-slots' },
      ].filter(item => (input.includeGameIds === undefined || input.includeGameIds.includes(item.id)) && !input.excludeGameIds?.includes(item.id) && (!input.search || [item.name, item.slug, item.vendorName].some(value => value.toLowerCase().includes(input.search!.toLowerCase()))))
      const page = input.page ?? 1, pageSize = input.pageSize ?? 20
      result = { casinoSelectionGames: { total: rows.length, page, pageSize, items: rows.slice((page - 1) * pageSize, page * pageSize) } }; break
    }
    case 'CasinoSelectionGameIds': result = { casinoSelectionGameIds: (operation.variables.gameIds as string[]).filter(id => ['101', '102'].includes(id)) }; break
    case 'CasinoApiProviders': result = { casinoApiProviders: [{ id: 'provider1', name: 'Primary Provider' }] }; break
    case 'GamesByIds': result = { gamesByIds: [{ id: '101', name: 'Golden Roulette', vendorName: 'Evolution', mainCategory: 'CASINO' }, { id: '102', name: 'Dragon Slots', vendorName: 'Evolution', mainCategory: 'SLOTS' }] }; break
    case 'MatkasByIds': result = { matkasByIds: [{ id: 'm1', name: 'Mumbai Day', code: 'MUMDAY' }, { id: 'm2', name: 'Mumbai Night', code: 'MUMNIGHT' }] }; break
    case 'CasinoVendors': result = { casinoVendors: [{ id: 'v1', name: 'Evolution' }] }; break
    case 'CasinoGameBundles': result = { casinoGameBundles: [{ id: `bundle-${operation.variables.domain}`, name: 'Weekend favourites', domain: operation.variables.domain, description: 'Selected games for the weekend.', gameIds: operation.variables.domain === 'matka' ? ['m1', 'm2'] : ['101', '102'], gameWeights: { 101: 0.3, 102: 0.4 }, gameCount: 2, createdAt: '2026-09-22', updatedAt: '2026-10-09' }] }; break
    case 'MatkaCatalog':
    case 'Matkas': result = { matkas: { items: [{ id: 'm1', name: 'Mumbai Day', code: 'MUMDAY', status: 'ACTIVE', timezone: 'Asia/Kolkata' }, { id: 'm2', name: 'Mumbai Night', code: 'MUMNIGHT', status: 'ACTIVE', timezone: 'Asia/Kolkata' }], total: 2 } }; break
    case 'SaveBonusCampaignGames': {
      if (!state.refused && state.campaign) { state.campaign.casinoGameIds = operation.variables.gameIds; state.campaign.casinoGameWeights = operation.variables.gameWeights }
      result = { saveBonusCampaignGames: { success: !state.refused, message: state.refused ? 'Campaign update refused' : 'Campaign games updated', campaign: state.campaign } }; break
    }
    case 'SaveBonusCampaignMatkas': {
      if (!state.refused && state.campaign) { state.campaign.matkaGameIds = operation.variables.matkaIds; state.campaign.matkaBidTypeWeights = operation.variables.matkaBidTypeWeights }
      result = { saveBonusCampaignMatkas: { success: !state.refused, message: state.refused ? 'Campaign update refused' : 'Campaign markets updated', campaign: state.campaign } }; break
    }
    case 'Users': result = { users: [{ id: 'p1', username: 'alice', name: 'Alice', phone: '9100000001' }, { id: 'p2', username: 'bob', name: 'Bob', phone: '9100000002' }].filter(row => !operation.variables.query || row.username.includes(String(operation.variables.query))) }; break
    case 'UsersByIds': result = { usersByIds: (operation.variables.ids as string[]).filter(id => id !== 'unresolved').map(id => ({ id, username: id === 'p1' ? 'alice' : 'bob', name: id === 'p1' ? 'Alice' : 'Bob', phone: id === 'p1' ? '9100000001' : '9100000002' })) }; break
    case 'AgentsHierarchy': result = { agentsHierarchy: [{ id: 'a1', name: 'Root partner', level: 1, phone: '9200000001' }, { id: 'a2', name: 'Child partner', level: 2, phone: '9200000002' }] }; break
    case 'AgentsByIds': result = { agentsByIds: (operation.variables.ids as string[]).filter(id => id !== 'unresolved').map(id => ({ id, name: id === 'a1' ? 'Root partner' : 'Child partner', code: id, phone: '9200000002' })) }; break
    case 'AgentExclusionImpact': result = { agentExclusionImpact: { descendantAgentIds: ['a1', 'a2'], playerIds: ['p1', 'p2'] } }; break
    case 'UserIdsByPhones': result = { userIdsByPhones: ['p1'] }; break
    case 'AgentIdsByUsernames': result = { agentIdsByUsernames: ['a1'] }; break
    case 'UpdateBonusCampaign': {
      if (!state.refused && state.campaign) state.campaign.rulesJson = operation.variables.input.rulesJson
      result = { updateBonusCampaign: { success: !state.refused, message: state.refused ? 'Campaign update refused' : 'Exclusions updated', campaign: { id: '42' } } }; break
    }
    case 'CurrentWhitelabel': result = { whitelabelCurrent: null }; break
    case 'Currencies': result = { currencies: [{ code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 1 }] }; break
    default: throw new Error(`Unexpected bonus operation: ${operation.operationName}`)
  }
  const definition = operation.query.definitions.find(node => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return { data: complete(definition.selectionSet, result) as Record<string, unknown> }
}
