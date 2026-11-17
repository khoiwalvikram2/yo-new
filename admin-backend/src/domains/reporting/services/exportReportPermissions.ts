import { hasPermission } from '@src/domains/common/auth.js'
import { isAgentExportAllowed } from './agentExportPolicy.js'

/**
 * What each export report type costs the caller.
 *
 * `createExportJob` was gated on exactly one permission — `reporting.exports:create` —
 * while the caller names the report type in the request. `ExportJobProcessor`
 * then switches on that string across twenty report types, among them
 * AUDIT_LOGS, PLAYERS, TRANSACTIONS, DEPOSITS and WITHDRAWALS, consulting no
 * further permission at any point. So one grant exported the whole tenant's
 * audit trail, player roster and payment history to a file the same caller
 * could then download.
 *
 * The catalogue has carried a separate export permission for each of those
 * screens all along — `audit.events:export`, `players.list:export`,
 * `reporting.pnl:export` and eleven more. Before this table, the only one any
 * resolver read was `audit.events:export`, in `checkAuditExportPermission`,
 * which guards the audit domain's *own* export route. The audit trail was
 * protected on one road and open on the other.
 *
 * The seeded "Reports Viewer" template shows the intent being defeated: it is
 * granted five `reporting.*:export` permissions and deliberately denied
 * players-profitability, players-activity, agents-commission and every `audit.*`
 * permission. Every one of those withheld distinctions was inert.
 *
 * `reporting.exports:create` is still required — it is the right to run an
 * export at all. This is the additional question of *what* may be exported.
 */
export const EXPORT_REPORT_PERMISSIONS: Record<string, readonly (readonly [string, string])[]> = {
  // The audit trail. The same permission its own export route demands.
  AUDIT_LOGS: [['audit.events', 'export']],
  AUDITLOGS: [['audit.events', 'export']],

  // Player identity and money.
  PLAYERS: [['players.list', 'export']],
  TRANSACTIONS: [['players.ledger', 'export']],
  DEPOSITS: [['payments.deposits', 'view']],
  WITHDRAWALS: [['payments.withdrawals', 'view']],

  // Agents.
  AGENTS: [['agents.list', 'export']],
  SUBAGENTS: [['agents.list', 'export']],
  COMMISSION: [['reporting.agents-commission', 'export']],
  SETTLEMENT: [['settlements.center', 'view']],
  SETTLEMENTS: [['settlements.center', 'view']],

  // Betting, by product.
  SPORTS_BETS: [['reporting.sports', 'export']],
  SPORTSBETS: [['reporting.sports', 'export']],
  CASINO_BETS: [['reporting.casino', 'export']],
  CASINOBETS: [['reporting.casino', 'export']],
  MATKA_BETS: [['reporting.matka', 'export']],
  MATKABETS: [['reporting.matka', 'export']],

  // Marketing and aggregate revenue.
  BONUS_CAMPAIGNS: [['reporting.bonus-overview', 'export']],
  BONUSCAMPAIGNS: [['reporting.bonus-overview', 'export']],
  GGR: [['reporting.pnl', 'export']],
}

/** The processor's own normalisation, so the table is keyed the way it dispatches. */
export function normaliseExportReportType(reportType: unknown): string {
  return String(reportType ?? '')
    .toUpperCase()
    .replace(/-/g, '_')
}

/**
 * Refuses a report type the caller may not export, and refuses one nobody has
 * decided about.
 *
 * An unknown type is rejected rather than allowed: `ExportJobProcessor` would
 * fail it later anyway, and refusing here means a report type added to the
 * processor without a permission fails loudly instead of inheriting this one.
 */
export function requireExportReportPermission(ctx: any, reportType: unknown): void {
  const key = normaliseExportReportType(reportType)
  const required = EXPORT_REPORT_PERMISSIONS[key]
  if (!required) {
    throw new Error(
      `Forbidden: unknown export report type "${key}". Add it to EXPORT_REPORT_PERMISSIONS.`
    )
  }
  // An agent is decided by agentExportPolicy (its scheme and its domains), not by this table:
  // DEPOSITS, WITHDRAWALS and SETTLEMENTS are priced here in view permissions that open whole admin
  // screens, which no agent may hold, and GGR's price (reporting.pnl:export) is already met by an
  // agent's flat reporting:read. Agent features spec §4, owner decision 4, 2026-10-22.
  if (ctx?.user?.type === 'agent') {
    if (!isAgentExportAllowed(key, ctx.user.agentSchemeType, ctx.user.agentAllowedDomains)) {
      throw new Error(`Forbidden: agents may not export ${key}`)
    }
    return
  }
  const perms = ctx?.permissions ?? []
  if (!required.some(([domain, action]) => hasPermission(perms, domain, action))) {
    const names = required.map(([d, a]) => `${d}:${a}`).join(' or ')
    throw new Error(`Forbidden: insufficient permissions to export ${key} (${names})`)
  }
}
