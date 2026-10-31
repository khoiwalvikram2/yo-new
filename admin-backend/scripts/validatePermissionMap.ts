/**
 * Checks a proposed operation-to-permission mapping against the roles that
 * actually exist, before any of it is enforced.
 *
 * Gating an operation is not free. Choose the wrong permission and a role that
 * legitimately uses the screen is refused — a working feature disappears for a
 * real operator, and the only symptom is a message they cannot act on. That is
 * a worse outcome than the hole, because the hole at least fails safe for the
 * business.
 *
 * So: for every proposed pair, this reports which of the live roles would still
 * pass. It is a decision aid, not a gate — read the table and judge whether the
 * roles that pass are the ones that should.
 *
 * Reads only. Touches no resolver and writes nothing.
 *
 *   npm run validate:permission-map
 */
import 'dotenv/config'
import { pool } from '@src/db/client.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'

/**
 * The proposal. Each entry is an operation the authorization probe showed a
 * permission-less admin reaching, paired with the catalogue permission that
 * matches what the screen it serves is gated on in the front end.
 */
export const PROPOSED: Record<string, [string, string]> = {
  // ---- batch 2: the data reads still open after batch 1 -------------------
  // Player detail tabs. Each is a separate screen with its own permission in
  // the front end; the backend enforced none of them.
  playerProfile: ['players.profile', 'view'],
  playerOverview: ['players.profile', 'view'],
  playerBets: ['players.bets', 'view'],
  playerTransactions: ['players.transactions', 'view'],
  playerCreditTransactions: ['players.credit', 'view'],
  playerBonuses: ['players.bonuses', 'view'],
  playerVip: ['players.vip', 'view'],
  playerDevices: ['players.devices', 'view'],
  playerSessions: ['players.sessions', 'view'],

  // The audit trail. Reading who did what is itself privileged.
  audit: ['audit.events', 'view'],
  auditEvents: ['audit.events', 'view'],
  auditStats: ['audit.events', 'view'],
  // Reading the list of export jobs is a read. `audit.events:export` gates
  // *creating* one; requiring it here would take the screen away from every
  // role holding plain audit read, Whitelabel Admin included.
  auditExportJobs: ['audit.events', 'view'],
  auditAnnotations: ['audit.annotations', 'view'],

  // Aggregate financial reporting.
  liquidity: ['reporting.exposure', 'view'],
  exposure: ['reporting.exposure', 'view'],
  pnl: ['reporting.pnl', 'view'],
  casinoKPIs: ['reporting.casino', 'view'],
  casinoTrends: ['reporting.casino', 'view'],
  matkaKPIs: ['reporting.matka', 'view'],
  matkaTrends: ['reporting.matka', 'view'],
  agentKPIs: ['reporting.agent-overview', 'view'],
  agentTrends: ['reporting.agent-overview', 'view'],
  agentPerformance: ['reporting.agents-performance', 'view'],
  bonusKPIs: ['reporting.bonus-overview', 'view'],
  savedReports: ['reporting.exports', 'view'],
  exportJobs: ['reporting.exports', 'view'],
  exportJobDownloadUrl: ['reporting.exports', 'view'],

  // Matka operational data.
  draws: ['matka.management', 'view'],
  rates: ['matka.rates', 'view'],
  results: ['matka.results', 'view'],
  resultApprovals: ['matka.results', 'view'],
  matkaBidRules: ['matka.management', 'view'],
  matkaBets: ['matka.bets', 'view'],

  // Agents.
  agentsByIds: ['agents.list', 'view'],
  agentIdsByUsernames: ['agents.list', 'view'],
  agentsHierarchy: ['agents.hierarchy', 'view'],
  agentExclusionImpact: ['agents.hierarchy', 'view'],

  // Referrals.
  referralRules: ['referrals.program', 'view'],
  referralClicks: ['referrals.overview', 'view'],
  referralAttribution: ['referrals.overview', 'view'],
  referralReferees: ['referrals.overview', 'view'],
  batchReferralAttributions: ['referrals.overview', 'view'],
  referralTree: ['referrals.overview', 'view'],
  referralEarnings: ['referrals.earnings', 'view'],
  referralSettlements: ['referrals.settlements', 'view'],
  referralStats: ['referrals.overview', 'view'],
  topReferrers: ['referrals.overview', 'view'],
  referrerStats: ['referrals.overview', 'view'],

  // Configuration and cross-domain search.
  appConfig: ['config.app', 'view'],
  globalSearch: ['players.list', 'view'],
  betsPageTotals: ['players.bets', 'view'],
  partnerSettlements: ['settlements.center', 'view'],

  // ---- batch 1: already applied, kept so the table stays complete --------
  // Security — the operations that change who can do anything at all.
  deleteRBACRole: ['security.roles', 'delete'],
  deleteSupportAdmin: ['security.support-admins', 'delete'],
  removeIpFromAllowlist: ['security.ip-allowlist', 'delete'],

  // Account control.
  forceLogoutUser: ['players.sessions', 'delete'],
  suspendPlayer: ['players.profile', 'update'],
  blockPlayer: ['players.profile', 'update'],
  unblockPlayer: ['players.profile', 'update'],
  lockPlayerAccount: ['players.profile', 'update'],
  updatePlayerRemark: ['players.profile', 'update'],
  setUserDomainBets: ['players.profile', 'update'],
  setUserVipTier: ['players.vip', 'update'],
  revokePlayerBonus: ['players.bonuses', 'delete'],

  // The audit trail. A record its subject can edit is not a record.
  deleteAuditAnnotation: ['audit.annotations', 'delete'],

  // Money. The export is a read; marking one settled is a write, and is gated
  // on a write permission rather than on the view that renders the screen.
  markSettlementSettled: ['settlements.agent', 'create'],
  exportSettlementsCSV: ['settlements.center', 'view'],

  // Matka rates and results decide what a bet pays.
  createRateDraft: ['matka.rates', 'update'],
  submitRatesForReview: ['matka.rates', 'update'],
  publishRates: ['matka.rates', 'update'],
  updateDraw: ['matka.results', 'create'],
  approveResult: ['matka.results', 'create'],
  rejectResult: ['matka.results', 'create'],
}

async function main(): Promise<void> {
  const roles = await pool.query(`
    SELECT r.tenant, r.name, p.domain, p.action
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    ORDER BY r.tenant, r.name`)

  const byRole = new Map<string, Array<{ domain: string; actions: string[] }>>()
  for (const row of roles.rows as Array<{ tenant: string; name: string; domain: string | null; action: string | null }>) {
    const key = `${row.tenant} / ${row.name}`
    if (!byRole.has(key)) byRole.set(key, [])
    if (!row.domain || !row.action) continue
    const list = byRole.get(key)!
    const existing = list.find((x) => x.domain === row.domain)
    if (existing) existing.actions.push(row.action)
    else list.push({ domain: row.domain, actions: [row.action] })
  }

  // The two principals that are not rows in `roles`.
  byRole.set('— Super Admin (all:*)', [{ domain: 'all', actions: ['*'] }])
  byRole.set('— agent (derived)', deriveAgentPermissions(['sports', 'casino'] as never) as never)
  byRole.set('— admin holding nothing', [])

  const roleNames = [...byRole.keys()]
  const entries = Object.entries(PROPOSED)

  console.log(`${entries.length} proposed gates, checked against ${roleNames.length} principals.\n`)

  // Per operation: who still passes.
  for (const [op, [domain, action]] of entries) {
    const pass = roleNames.filter((r) => hasPermission(byRole.get(r) as never, domain, action))
    const named = pass.filter((r) => !r.startsWith('—'))
    console.log(`${op}`)
    console.log(`  gate: ${domain}:${action}`)
    console.log(`  passes: ${pass.length ? pass.map((r) => r.replace(/^.*\//, '').trim()).join(', ') : 'NOBODY — this gate would lock everyone out'}`)
    if (named.length === 0) {
      console.log(`  ⚠ no named role holds it. Either the permission is unseeded, or the gate is wrong.`)
    }
    console.log('')
  }

  // Per role: how much of the proposal it loses.
  console.log('--- how many of these each role would still reach ---')
  for (const r of roleNames) {
    const n = entries.filter(([, [d, a]]) => hasPermission(byRole.get(r) as never, d, a)).length
    console.log(`  ${r.padEnd(38)} ${String(n).padStart(3)} / ${entries.length}`)
  }

  await pool.end()
}

main().catch(async (e) => {
  console.error(e)
  try { await pool.end() } catch { /* closed */ }
  process.exitCode = 1
})
