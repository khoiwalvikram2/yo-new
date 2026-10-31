import type { Operation, FetchResult } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
export const AGENT_PARENT = { id: 'parent-1', username: 'Parent partner', levelIndex: 2, schemeType: 'COMMISSION', allowedDomains: ['sports'],
  commissionRates: [{ domain: 'sports', rate: 20 }], sharingRates: [{ domain: 'sports', rate: 50 }] }
export const AGENT_RECORD = { id: 'edit-1', username: 'existing_agent', phone: '+919999999999', schemeType: 'COMMISSION', allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: AGENT_PARENT.id,
  levelIndex: 3, tallyEnabled: false, tallyDomains: [], commissionRates: [{ domain: 'sports', rate: 10 }], sharingRates: [] }
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map((item) => complete(selection, item))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter((node) => node.kind === 'Field').map((field) => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'AgentFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export interface AgentFixtureOptions { unavailable?: boolean; failSave?: boolean; scheme?: string; emptyParent?: boolean }
export function agentResponse(operation: Operation, options: AgentFixtureOptions = {}): FetchResult {
  const scheme = String(operation.variables.schemeType || options.scheme || 'COMMISSION')
  const parent = { ...AGENT_PARENT, schemeType: options.scheme || scheme }
  let result: Record<string, unknown>
  switch (operation.operationName) {
    case 'CheckAgentUsernameAvailable': result = { agents: { checkAgentUsernameAvailable: { available: !options.unavailable, message: 'Username unavailable' } } }; break
    case 'GetSharingAgentsForBasicInfo': case 'GetSharingAgents': result = { agents: { agentsPage: { items: [parent] } } }; break
    case 'GetSubAgentsForBasicInfo': case 'GetSubAgents': result = { agents: { agentsPage: { items: [] } } }; break
    case 'GetLoggedInAgentForBasicInfo': case 'GetLoggedInAgent': case 'GetParentAgent': result = { agents: { agentProfile: options.emptyParent ? null : parent } }; break
    case 'AgentProfile': result = { agents: { agentProfile: { ...AGENT_RECORD, schemeType: options.scheme || AGENT_RECORD.schemeType } } }; break
    case 'AppConfig': result = { appConfig: { baseCurrency: 'USD' } }; break
    case 'GetWhitelabel': result = { whitelabel: { id: 'wl-1', sharingRates: [{ domain: 'sports', rate: 50 }, { domain: 'casino', rate: 50 }, { domain: 'matka', rate: 50 }] } }; break
    case 'CreateAgent':
      if (options.failSave) return { errors: [{ message: 'Create refused' }] }
      result = { agents: { createAgent: { id: 'created-1', username: operation.variables.input.username, schemeType: operation.variables.input.schemeType } } }; break
    case 'UpdateAgent':
      if (options.failSave) return { errors: [{ message: 'Update refused' }] }
      result = { agents: { updateAgent: { ...AGENT_RECORD } } }; break
    case 'SetCommissionConfig': result = { agents: { setCommissionConfig: { id: 'rate-1', domain: operation.variables.input.domain, commissionRate: operation.variables.input.commissionRate } } }; break
    case 'SetSharingConfig': result = { agents: { setSharingConfig: { id: 'rate-1', domain: operation.variables.input.domain, shareRate: operation.variables.input.shareRate } } }; break
    default: throw new Error(`Unexpected agent operation: ${operation.operationName}`)
  }
  const definition = operation.query.definitions.find((node) => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return { data: complete(definition.selectionSet, result) as Record<string, unknown> }
}
