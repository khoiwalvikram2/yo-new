import type { AiContext } from './types.js'

/**
 * The resolver map is loaded on first use rather than imported at module load.
 *
 * domains/index.ts imports this module's consumers to assemble the resolver map,
 * so a static import here closes a cycle: importing anything under aiAssistant
 * before domains/index.ts leaves `domainResolvers` in its temporal dead zone and
 * the spread in domains/index.ts throws. The running server happens to import in
 * a safe order; a test or script does not have to.
 */
type ResolverMap = { Query: Record<string, unknown>; Mutation: Record<string, unknown> }
let resolverMap: ResolverMap | null = null

async function getResolvers(): Promise<ResolverMap> {
  if (!resolverMap) {
    const mod = await import('@src/domains/index.js')
    resolverMap = mod.domainResolvers as unknown as ResolverMap
  }
  return resolverMap
}

/**
 * Calls a named GraphQL resolver directly, with the caller's own context.
 *
 * This is the whole security model. The assistant reaches data only through the
 * same functions the UI reaches it through, carrying the same context, so every
 * check those resolvers already perform — RBAC, tenant scoping, agent hierarchy
 * visibility — applies unchanged, and mutations keep writing their audit rows.
 * Nothing here adds a privilege; giving the assistant its own database client
 * would have removed all of it.
 */

/** Resolvers the assistant may read from. Anything absent is unreachable. */
export const ALLOWED_QUERIES = new Set<string>([
  // Players
  'playersListStats', 'playerProfile', 'playerOverview', 'playerBets',
  'playerTransactions', 'playerLimits', 'playerBonuses', 'playerVip',
  'playerSessions', 'playerDevices',
  // 'playerNotes' is deliberately absent. Notes are what operators write about
  // a player in their own words — suspicion, complaints, what was said on a
  // call — and they are the most sensitive free text in the system. The
  // assistant reaching them would put that text into a provider prompt.
  // Betting
  'betsPage', 'betsPageTotals', 'casinoBets', 'matkaBets',
  'eventsWithOpenBets', 'exposure', 'exposures',
  // Agents
  'agentsHierarchy', 'agentKPIs', 'agentPerformance', 'agentDeepDive',
  'agentPlayerBreakdown', 'agentTrends', 'agentsByIds',
  // Money in / out
  'adminDepositRequests', 'adminWithdrawalRequests', 'adminWithdrawalHistory',
  // Reporting
  'pnl', 'dashboardTrends', 'casinoPlayerBreakdown', 'casinoAgentBreakdown',
  'matkaPlayerBreakdown', 'matkaAgentBreakdown',
  // Configuration (read side of what the assistant can change)
  'whitelabel', 'whitelabels', 'whitelabelCurrent', 'whitelabelPaymentMethods',
  'whitelabelCasinoProviderSettings', 'appConfig', 'limits', 'riskLimits',
  'casinoGameBetSettings', 'casinoVendorsWithSettings',
])

/** Mutations the assistant may propose. Money movement is deliberately absent. */
export const ALLOWED_MUTATIONS = new Set<string>([
  'updateWhitelabel',
  'updateAppConfig',
  'upsertLimit',
  'upsertRiskLimit',
  'setPlayerLimits',
  'upsertPlayerLimits',
  'upsertEventRiskConfig',
  'upsertEventSettings',
  'upsertLeagueSettings',
  'upsertSportSettings',
  'updateMatkaSettings',
  'upsertWhitelabelPaymentMethods',
  'toggleCasinoVendorEnabled',
  'toggleCasinoGameEnabled',
  'toggleWhitelabelCasinoProvider',
  'updateCasinoGameSettings',
  'upsertCasinoGameBetSettings',
  'bulkUpdateVendorSettings',
  'bulkUpdateCasinoGameSettings',
])

export class ResolverNotAllowedError extends Error {
  constructor(kind: 'query' | 'mutation', name: string) {
    super(`The assistant is not permitted to run the ${kind} "${name}".`)
    this.name = 'ResolverNotAllowedError'
  }
}

export async function callQuery(name: string, args: Record<string, unknown>, ctx: AiContext): Promise<unknown> {
  if (!ALLOWED_QUERIES.has(name)) throw new ResolverNotAllowedError('query', name)
  const resolver = ((await getResolvers()).Query as Record<string, any>)[name]
  if (typeof resolver !== 'function') throw new Error(`Query "${name}" does not exist`)
  return resolver(null, args, ctx, null)
}

export async function callMutation(name: string, args: Record<string, unknown>, ctx: AiContext): Promise<unknown> {
  if (!ALLOWED_MUTATIONS.has(name)) throw new ResolverNotAllowedError('mutation', name)
  const resolver = ((await getResolvers()).Mutation as Record<string, any>)[name]
  if (typeof resolver !== 'function') throw new Error(`Mutation "${name}" does not exist`)
  return resolver(null, args, ctx, null)
}

/**
 * Caps how much of a result is handed to the model. Large result sets cost
 * tokens without improving the answer, and the model only ever needs a sample
 * plus the totals the resolver already computed.
 */
export function truncateForModel(value: unknown, maxRows = 40): { data: unknown; note?: string } {
  if (Array.isArray(value) && value.length > maxRows) {
    return {
      data: value.slice(0, maxRows),
      note: `Showing the first ${maxRows} of ${value.length} rows.`,
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['items', 'rows', 'data', 'edges', 'players', 'bets']) {
      const inner = record[key]
      if (Array.isArray(inner) && inner.length > maxRows) {
        return {
          data: { ...record, [key]: inner.slice(0, maxRows) },
          note: `Showing the first ${maxRows} of ${inner.length} ${key}.`,
        }
      }
    }
  }
  return { data: value }
}
