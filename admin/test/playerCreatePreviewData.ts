import type { Operation, FetchResult } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map((item) => complete(selection, item))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter((node) => node.kind === 'Field').map((field) => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'PlayerFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export interface PlayerFixtureOptions { unavailable?: boolean; refused?: boolean }
export function playerCreateResponse(operation: Operation, options: PlayerFixtureOptions = {}): FetchResult {
  let result: Record<string, unknown>
  switch (operation.operationName || '') {
    case 'CreditAgentsForPlayerCreate': case 'SharingAgentsForPlayerCreate': case 'CommissionAgentsForPlayerCreate':
      result = { agents: { agentsPage: { items: [
        { id: 'root-1', username: 'Root partner', parentAgentId: null }, { id: 'child-1', username: 'Child partner', parentAgentId: 'root-1' },
      ] } } }; break
    case 'CheckPhoneAvailable': result = { checkPhoneAvailable: { available: !options.unavailable, message: 'Phone already registered' } }; break
    case 'CreatePlayer': result = { createPlayer: { success: !options.refused, message: options.refused ? 'Create refused' : 'Player created successfully',
      user: options.refused ? null : { id: 'player-1', name: operation.variables.input.name, username: 'new_player', email: null, phone: operation.variables.input.phone } } }; break
    case 'CreatePlayerForAgent': result = { createPlayerForAgent: { success: !options.refused, message: options.refused ? 'Create refused' : 'Player created successfully', playerId: options.refused ? null : 'player-1' } }; break
    case '': result = { vipTiers: [{ id: 'silver', name: 'Silver Rewards', status: 'active' }, { id: 'draft', name: 'Draft Rewards', status: 'inactive' }] }; break
    case 'CurrentWhitelabel': result = { whitelabelCurrent: null }; break
    case 'Currencies': result = { currencies: [{ code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 1 }] }; break
    default: throw new Error(`Unexpected player operation: ${operation.operationName}`)
  }
  const definition = operation.query.definitions.find((node) => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return { data: complete(definition.selectionSet, result) as Record<string, unknown> }
}
