/**
 * Which export report types an agent may run (agent features spec §4, owner decision 4, 2026-10-22).
 *
 * Every agent scheme gets the Export Center, always scoped to its own subtree. What it may export:
 *   - PLAYERS, DEPOSITS, WITHDRAWALS, SUBAGENTS: every scheme;
 *   - SPORTS / CASINO / MATKA bets: only the domains in the agent's allowedDomains;
 *   - COMMISSION: COMMISSION agents (per-cycle rows from the commission engine);
 *   - SETTLEMENT(S): SHARING and CREDIT agents (its own and its direct children's settlements).
 * Never the whitelabel-level reports (AUDIT_LOGS, BONUS_CAMPAIGNS, GGR), nor TRANSACTIONS or the
 * whole AGENTS list, which are not agent-scoped.
 *
 * This is the per-type rule for agent callers. `requireExportReportPermission` asks it instead of
 * EXPORT_REPORT_PERMISSIONS: three of the types an agent may export (DEPOSITS, WITHDRAWALS,
 * SETTLEMENTS) are priced there in view permissions that also open whole admin screens, which no
 * agent may hold; and GGR's price (reporting.pnl:export) is already met by an agent's flat
 * reporting:read. ExportJobProcessor asks this again before it reads a row.
 *
 * No runtime imports on purpose: AgentPermissionsService imports this module and common/auth.ts
 * imports AgentPermissionsService, so importing exportReportPermissions here would close a cycle.
 */

export type AgentExportScheme = 'COMMISSION' | 'SHARING' | 'CREDIT'

/** Whitelabel-level data no agent exports, whatever it holds (normalised keys, aliases included). */
export const AGENT_FORBIDDEN_EXPORT_TYPES: ReadonlySet<string> = new Set([
  'AUDIT_LOGS',
  'AUDITLOGS',
  'BONUS_CAMPAIGNS',
  'BONUSCAMPAIGNS',
  'GGR',
])

const EVERY_SCHEME: readonly string[] = ['PLAYERS', 'DEPOSITS', 'WITHDRAWALS', 'SUBAGENTS']

const BY_SCHEME: Readonly<Record<AgentExportScheme, readonly string[]>> = {
  COMMISSION: ['COMMISSION'],
  SHARING: ['SETTLEMENT', 'SETTLEMENTS'],
  CREDIT: ['SETTLEMENT', 'SETTLEMENTS'],
}

const BY_DOMAIN: Readonly<Record<'sports' | 'casino' | 'matka', readonly string[]>> = {
  sports: ['SPORTS_BETS', 'SPORTSBETS'],
  casino: ['CASINO_BETS', 'CASINOBETS'],
  matka: ['MATKA_BETS', 'MATKABETS'],
}

/** The processor's own normalisation (ExportJobProcessor.normalizeReportType, normaliseExportReportType). */
export function normaliseAgentExportType(reportType: unknown): string {
  return String(reportType ?? '')
    .toUpperCase()
    .replace(/-/g, '_')
}

function schemeOf(schemeType: unknown): AgentExportScheme | null {
  const scheme = String(schemeType ?? '').toUpperCase()
  return scheme === 'COMMISSION' || scheme === 'SHARING' || scheme === 'CREDIT' ? scheme : null
}

/** Every report type (normalised keys, aliases included) an agent of this scheme and these domains may export. */
export function agentExportReportTypes(schemeType: unknown, allowedDomains: unknown): string[] {
  const scheme = schemeOf(schemeType)
  if (!scheme) return []
  const domains = Array.isArray(allowedDomains) ? allowedDomains.map((d) => String(d).toLowerCase()) : []
  const types = [...EVERY_SCHEME, ...BY_SCHEME[scheme]]
  for (const domain of ['sports', 'casino', 'matka'] as const) {
    if (domains.includes(domain)) types.push(...BY_DOMAIN[domain])
  }
  return types
}

export function isAgentExportAllowed(reportType: unknown, schemeType: unknown, allowedDomains: unknown): boolean {
  const key = normaliseAgentExportType(reportType)
  if (AGENT_FORBIDDEN_EXPORT_TYPES.has(key)) return false
  return agentExportReportTypes(schemeType, allowedDomains).includes(key)
}

/** The refusal createExportJob, ExportJobProcessor and agentExportRowCount all give. */
export function assertAgentMayExport(reportType: unknown, schemeType: unknown, allowedDomains: unknown): void {
  if (!isAgentExportAllowed(reportType, schemeType, allowedDomains)) {
    throw new Error(`Forbidden: agents may not export ${normaliseAgentExportType(reportType)}`)
  }
}

/**
 * The nested permissions behind an agent's allowed exports, for deriveAgentPermissions:
 * `reporting.exports:create` (the right to run an export at all) and the `<screen>:export`
 * permission of each allowed type that is priced in an export action. Export and create actions
 * only: DEPOSITS, WITHDRAWALS and SETTLEMENTS are priced in view permissions that open whole admin
 * screens, so they are not derived here; the policy above decides them for agents.
 */
export function agentExportPermissions(
  schemeType: unknown,
  allowedDomains: unknown,
): Array<{ domain: string; actions: string[] }> {
  const types = agentExportReportTypes(schemeType, allowedDomains)
  if (types.length === 0) return []
  const perms: Array<{ domain: string; actions: string[] }> = [{ domain: 'reporting.exports', actions: ['create'] }]
  const exportOf = (domain: string) => perms.push({ domain, actions: ['export'] })
  if (types.includes('PLAYERS')) exportOf('players.list')
  if (types.includes('SUBAGENTS')) exportOf('agents.list')
  if (types.includes('SPORTS_BETS')) exportOf('reporting.sports')
  if (types.includes('CASINO_BETS')) exportOf('reporting.casino')
  if (types.includes('MATKA_BETS')) exportOf('reporting.matka')
  if (types.includes('COMMISSION')) exportOf('reporting.agents-commission')
  return perms
}
