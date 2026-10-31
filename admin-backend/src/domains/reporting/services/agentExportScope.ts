import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import type { ExportWindow } from '@src/repos/reporting/agentExportQueries.js'
import { assertAgentMayExport, normaliseAgentExportType, type AgentExportScheme } from './agentExportPolicy.js'
import { countCommissionCycleRows, settlementAgentIds } from './agentExportRows.js'

/**
 * Whose rows an agent's export holds, resolved once per export (agent features spec §4).
 *
 * - The scope agent is the caller, or a sub-agent the caller names in filters.agentId when that
 *   agent is inside the caller's subtree (agent_hierarchy_closure). Any other agentId is ignored.
 * - Players: the scope agent's subtree's players plus their confirmed referrals
 *   (agentExportQueries, in SQL before the cap).
 * - Sub-agents: the scope agent's subtree below it.
 * - Commission: the subtree's COMMISSION agents, week by week.
 * - Settlements: the scope agent and its direct children.
 *
 * ExportJobProcessor and the Export Center's row count share this module, so the estimate counts
 * exactly the rows the file holds.
 */

/** The agent an export runs for, as createExportJob hands it to the processor. */
export interface ExportAgentContext {
  agentId: string
  schemeType: AgentExportScheme
  allowedDomains: string[]
}

export interface AgentExportScope {
  callerAgentId: string
  /** The caller, or a sub-agent of it named in filters.agentId. */
  scopeAgentId: string
  schemeType: AgentExportScheme
  allowedDomains: string[]
  tenant: string
  whitelabelId: string
  /** scopeAgentId's subtree from agent_hierarchy_closure, scopeAgentId first. */
  subtreeIds: string[]
}

export type AgentExportFilters = Record<string, unknown>

export const AGENT_SCOPE_MISSING = 'Agent export scope was not resolved; refusing to export unscoped data'

/** filtersJson as the job or the query carries it: an object, or JSON text of one. */
export function parseExportFilters(raw: unknown): AgentExportFilters {
  if (typeof raw === 'string') {
    try {
      return parseExportFilters(JSON.parse(raw))
    } catch {
      return {}
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as AgentExportFilters) : {}
}

/** filters.agentId narrows the scope only to an agent inside the caller's subtree. */
export function resolveAgentScopeRoot(callerAgentId: string, requested: unknown, callerSubtreeIds: readonly string[]): string {
  const id = typeof requested === 'string' ? requested.trim() : ''
  if (!id || id === callerAgentId) return callerAgentId
  return callerSubtreeIds.includes(id) ? id : callerAgentId
}

function validDate(date: Date | undefined): Date | undefined {
  return date && !Number.isNaN(date.getTime()) ? date : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Bets: the whitelabel-zone day bounds, exactly as getSportsBets / getCasinoBets / getMatkaBets read them. */
export function betExportWindow(filters: AgentExportFilters, timeZone: string): ExportWindow {
  const from = text(filters.dateFrom)
  const to = text(filters.dateTo)
  return {
    from: from ? validDate(parseDateFrom(from, timeZone)) : undefined,
    to: to ? validDate(parseDateTo(to, timeZone)) : undefined,
  }
}

/** Payment requests, settlements and commission weeks: the instants sent, as the processor always read them. */
export function instantExportWindow(filters: AgentExportFilters): ExportWindow {
  const from = text(filters.dateFrom)
  const to = text(filters.dateTo)
  return {
    from: from ? validDate(new Date(from)) : undefined,
    to: to ? validDate(new Date(to)) : undefined,
  }
}

/**
 * The agent createExportJob hands to the processor. It refuses when the agent cannot be loaded in
 * this tenant: without an agent context the processor reads as an admin, i.e. the whole whitelabel.
 */
export async function loadExportAgentContext(agentId: unknown, tenant: string): Promise<ExportAgentContext> {
  const id = typeof agentId === 'string' ? agentId.trim() : ''
  if (!id) throw new Error('Forbidden: agent session without an agent id')
  const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
  const agent = await new AgentsRepo().findByIdScoped(id, tenant)
  if (!agent || !agent.schemeType) throw new Error('Forbidden: agent not found for this whitelabel')
  return {
    agentId: String(agent.id),
    schemeType: agent.schemeType,
    allowedDomains: Array.isArray(agent.allowedDomains) ? agent.allowedDomains.map(String) : [],
  }
}

export async function loadAgentExportScope(input: {
  callerAgentId: string
  schemeType: AgentExportScheme
  allowedDomains: readonly string[]
  tenant: string
  whitelabelId: string
  requestedAgentId?: unknown
}): Promise<AgentExportScope> {
  const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
  const repo = new AgentsRepo()
  const callerSubtree = await repo.getDescendantIds(input.callerAgentId)
  const scopeAgentId = resolveAgentScopeRoot(input.callerAgentId, input.requestedAgentId, callerSubtree)
  const subtree = scopeAgentId === input.callerAgentId ? callerSubtree : await repo.getDescendantIds(scopeAgentId)
  return {
    callerAgentId: input.callerAgentId,
    scopeAgentId,
    schemeType: input.schemeType,
    allowedDomains: [...input.allowedDomains],
    tenant: input.tenant,
    whitelabelId: input.whitelabelId,
    subtreeIds: [scopeAgentId, ...subtree.filter((id) => id !== scopeAgentId)],
  }
}

/** The scope agent and its direct children: whose settlements a SHARING/CREDIT agent's export holds. */
export async function loadSettlementAgentIds(scopeAgentId: string): Promise<string[]> {
  const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
  const children = await new AgentsRepo().listChildren(scopeAgentId)
  return settlementAgentIds(scopeAgentId, children.map((child) => String(child.id)))
}

async function whitelabelTimeZone(tenant: string): Promise<string> {
  const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
  return getWhitelabelTimezone(tenant)
}

/** How many rows an agent's export of this type holds: the same SQL as the file, counted, capped like it. */
export async function countAgentExportRows(reportType: unknown, filters: AgentExportFilters, scope: AgentExportScope): Promise<number> {
  const key = normaliseAgentExportType(reportType)
  assertAgentMayExport(key, scope.schemeType, scope.allowedDomains)
  const queries = await import('@src/repos/reporting/agentExportQueries.js')
  const q = { agentId: scope.scopeAgentId, tenant: scope.tenant, whitelabelId: scope.whitelabelId }
  switch (key) {
    case 'PLAYERS':
      return queries.agentPlayersCount(q, filters.status)
    case 'SPORTS_BETS':
    case 'SPORTSBETS':
      return queries.agentSportsBetsCount(q, betExportWindow(filters, await whitelabelTimeZone(scope.tenant)), filters.status)
    case 'CASINO_BETS':
    case 'CASINOBETS':
      return queries.agentCasinoBetsCount(q, betExportWindow(filters, await whitelabelTimeZone(scope.tenant)), filters.status)
    case 'MATKA_BETS':
    case 'MATKABETS':
      return queries.agentMatkaBetsCount(
        q,
        betExportWindow(filters, await whitelabelTimeZone(scope.tenant)),
        filters.status,
        filters.matkaType,
      )
    case 'DEPOSITS':
      return queries.agentDepositsCount(q, instantExportWindow(filters), filters.status)
    case 'WITHDRAWALS':
      return queries.agentWithdrawalsCount(q, instantExportWindow(filters), filters.status)
    case 'SUBAGENTS':
      return Math.min(Math.max(0, scope.subtreeIds.length - 1), queries.AGENT_EXPORT_ROW_CAP)
    case 'COMMISSION': {
      const inScope = await queries.agentsInScopeQuery(scope.tenant, scope.subtreeIds)
      const created = inScope.filter((agent) => agent.schemeType === 'COMMISSION').map((agent) => agent.createdAt)
      return countCommissionCycleRows(created, instantExportWindow(filters), new Date())
    }
    case 'SETTLEMENT':
    case 'SETTLEMENTS':
      return queries.agentSettlementsCount(scope.tenant, await loadSettlementAgentIds(scope.scopeAgentId), instantExportWindow(filters))
    default:
      throw new Error(`Forbidden: agents may not export ${key}`)
  }
}

/**
 * The agentExportRowCount query. It returns null for a non-agent caller: an admin's estimates keep
 * their own documents. For an agent it returns the count of exactly the rows its export would hold.
 */
export async function countAgentExportRowsForCaller(ctx: any, reportType: unknown, filtersJson: unknown): Promise<number | null> {
  if (ctx?.user?.type !== 'agent') return null
  const callerAgentId = typeof ctx?.user?.agentId === 'string' ? ctx.user.agentId.trim() : ''
  if (!callerAgentId) throw new Error('Forbidden: agent session without an agent id')
  const key = normaliseAgentExportType(reportType)
  assertAgentMayExport(key, ctx.user.agentSchemeType, ctx.user.agentAllowedDomains)
  const filters = parseExportFilters(filtersJson)
  const scope = await loadAgentExportScope({
    callerAgentId,
    schemeType: ctx.user.agentSchemeType,
    allowedDomains: Array.isArray(ctx.user.agentAllowedDomains) ? ctx.user.agentAllowedDomains.map(String) : [],
    tenant: ctx?.tenant || 'default',
    whitelabelId: ctx?.whitelabelId || ctx?.whitelabel?.id || 'default',
    requestedAgentId: filters.agentId,
  })
  return countAgentExportRows(key, filters, scope)
}
