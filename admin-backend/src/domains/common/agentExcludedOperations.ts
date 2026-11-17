/**
 * Admin-panel reads no agent may make, whatever it holds.
 *
 * An agent principal carries flat grants (`matka:read`, `reporting:read`, `sports:read`, `casino:read`,
 * `users:read` with `players:manage`; see AgentPermissionsService) so that its own monitoring screens work, and
 * config/nestedPermissions.ts maps those same flats onto admin-screen permissions: `matka.management:view`,
 * `matka.rates:view`, `reporting.snapshot-health:view`, `sports.results:view`, `casino.vendors:view` and
 * `players.move-agent:view`. The mapping cannot simply change, because the Whitelabel Admin role is granted
 * through the same flats, and some of those nested permissions also gate reads an agent does need (`matkas`).
 *
 * Measured as a sub-agent: every field below answered exactly what the whitelabel admin gets, among them the
 * whole matka market configuration as CSV, the platform's snapshot pipeline and pg-boss queues, and
 * movePlayerToAgentPreCheck, which returned any player's name and phone number (seven players walked in a
 * second). Each one backs only an admin route (adminRoute or superAdminRoute in the panel's router), and the
 * mutation behind the pre-check already refuses agents.
 *
 * guardAdminSurface (domains/crmSurfaceGuard.ts) refuses an agent session on every field named here, so no
 * resolver has to remember to. A new admin-only read an agent's flats would open belongs on this list.
 */
export const AGENT_EXCLUDED_OPERATIONS: Readonly<Record<string, string>> = {
  // Matka management and settings (/matka/management, /matka/settings/:id, /matka/view/:id).
  matka: "one market's schedule, limits and settings",
  matkasByIds: 'market rows by id, for the marketing bundles screen',
  matkaRateVersions: "a market's payout-rate history",
  matkasExportCSV: 'every market with its limits and settings, as CSV',
  matkaDefaultRates: 'the default payout rates',

  // Snapshot Health (/reporting/snapshot-health, Super Admin only): the platform's reporting pipeline.
  snapshotHealthSummary: "the platform's snapshot pipeline",
  snapshotRuns: 'the same',
  snapshotRunsConnection: 'the same',
  snapshotEvents: 'the same',
  snapshotEventsConnection: 'the same',
  snapshotPgBossOverview: "the platform's pg-boss job counts and schedules",
  snapshotMissingDays: 'the same pipeline',
  snapshotStaleDays: 'the same pipeline',

  // Manual sports results (/sports/manual-results).
  sportsResultStats: 'the manual-results counters',

  // Casino vendor management (/casino/vendors).
  casinoVendorsWithSettings: "every vendor's enable flags and settings",

  // Moving a player between agents is an admin action; movePlayerToAgent refuses agents the same way.
  movePlayerToAgentPreCheck: "the admin move-player pre-check, which returns the player's name and phone",
}

const EXCLUDED: ReadonlySet<string> = new Set(Object.keys(AGENT_EXCLUDED_OPERATIONS))

/** Whether an agent session must be refused on this root field. */
export function isAgentExcludedOperation(fieldName: string): boolean {
  return EXCLUDED.has(fieldName)
}
