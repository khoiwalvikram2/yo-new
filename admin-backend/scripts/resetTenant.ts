/**
 * Reset a tenant (whitelabel) back to its "freshly created" state.
 *
 * Deletes ALL clients/players and ALL agents (every scheme type) of one tenant, plus all of
 * their money/bets/history, then restores the whitelabel credit to its ORIGINAL allocation —
 * exactly the state right after `createWhitelabel` ran.
 *
 * WHAT IS DELETED (operational data tied to users/agents/money/history):
 *   - All users/players (REGULAR, AGENT_CREDIT, WHITELABEL_CREDIT, SHARING/COMMISSION players)
 *     EXCEPT whitelabel admin user(s) (role 'Whitelabel Admin') — those are recreated at
 *     whitelabel creation, so we keep them.
 *   - All agents (COMMISSION, SHARING, CREDIT) + every agent_* child (cascade).
 *   - Wallets, ledgers, bets (sports/casino/matka), deposits/withdrawals, bonuses awarded,
 *     settlements, commission, credit ledger, sessions, notifications, audit, approvals,
 *     referral activity, reporting snapshots, game results/draws.
 *
 * WHAT IS KEPT (the tenant's setup + configuration, so it stays usable):
 *   - whitelabels row (credit RESET, see below), whitelabel_sharing_config
 *   - RBAC: roles, permissions, role_permissions  + the whitelabel admin user & its user_roles
 *   - Casino settings: whitelabel_casino_*, casino_categories, casino_provider_vendor_shares,
 *     casino_game_bundles, game_groups
 *   - Business config: payments (whitelabel_payment_methods, whitelabel_pg_settings, otp_providers),
 *     sports (sports_settings, league_settings, event_settings, sports_auto_configs),
 *     matka rules/rates (matka_bid_rules, matka_default_rates), VIP tiers (vip_tiers + children),
 *     promotions, bonus_campaigns, referral programs (referral_programs/rules/budgets/coupons),
 *     risk (risk_config, automation_rules)
 *
 * CREDIT RESET (matches a just-created whitelabel):
 *   credit_limit     = original allocation (first ALLOCATION ledger row; or --limit override)
 *   credit_used      = 0
 *   credit_available = credit_limit
 *   settlement_balance{,_sports,_casino,_matka} = 0
 *   credit_alert_threshold = kept as-is (config)
 *
 * Usage:
 *   npm run reset:tenant -- --tenant <wl-id>                 # DRY-RUN (counts only, ROLLBACK)
 *   npm run reset:tenant -- --tenant <wl-id> --confirm       # COMMIT (one atomic transaction)
 *   npm run reset:tenant -- --tenant <wl-id> --limit 500000  # override original allocation
 *
 * Irreversible once --confirm is passed. Local/test/operational reset — for production verify
 * record-retention/compliance first. Refuses the 'default' tenant unless --allow-default.
 */

import 'dotenv/config'
import pg from 'pg'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const tenant = arg('tenant')
const confirm = process.argv.includes('--confirm')
const allowDefault = process.argv.includes('--allow-default')
const limitOverrideStr = arg('limit')

if (!tenant) {
  console.error('Usage: npm run reset:tenant -- --tenant <wl-id> [--confirm] [--limit <amount>] [--allow-default]')
  console.error('  DRY-RUN by default (counts only, rolled back). Add --confirm to commit.')
  process.exit(2)
}
if (tenant === 'default' && !allowDefault) {
  console.error("Refusing to reset the 'default' tenant (it is the casino-settings template). Pass --allow-default to override.")
  process.exit(2)
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(2) }
const limitOverride = limitOverrideStr != null ? Number(limitOverrideStr) : undefined
if (limitOverride != null && (Number.isNaN(limitOverride) || limitOverride < 0)) {
  console.error('--limit must be a non-negative number'); process.exit(2)
}

/**
 * Operational tables to wipe, in FK-safe order (children before parents).
 * Each runs `DELETE FROM table WHERE <where>` with $1 = tenant.
 *   - col:   shorthand for `col = $1`
 *   - where: explicit predicate (for tables scoped by user_id instead of tenant)
 * Pre-flight validates the column/table exists; missing ones are skipped (printed) BEFORE the
 * transaction starts, so the transaction itself only runs known-good statements.
 */
type Wipe = { table: string; col?: string; where?: string }
const WIPE: Wipe[] = [
  // -- bets, sessions, patterns (NO ACTION FKs to users -> must go before users) --
  { table: 'sports_bets',                   col: 'tenant' },
  { table: 'casino_bets',                   col: 'tenant' },              // before bonus_awards (FK)
  { table: 'matka_bets',                    col: 'tenant' },              // before matkas (FK)
  { table: 'betting_patterns',              col: 'tenant' },
  { table: 'user_casino_sessions',          col: 'tenant' },
  // -- bonuses awarded (no tenant col -> scope by user; campaigns are KEPT) --
  { table: 'bonus_awards',                  where: 'user_id IN (SELECT id FROM users WHERE tenant=$1)' },
  { table: 'bonus_credits',                 where: 'user_id IN (SELECT id FROM users WHERE tenant=$1)' },
  { table: 'reporting_bonus_ledgers',       col: 'tenant' },
  // -- wallet / ledger --
  { table: 'wallet_ledger',                 col: 'tenant' },
  { table: 'ledger_entries',                col: 'tenant' },
  { table: 'wallets',                       col: 'tenant' },
  // -- deposits / withdrawals / payouts --
  { table: 'withdrawal_requests',           col: 'tenant' },
  { table: 'deposit_requests',              col: 'tenant' },
  { table: 'user_payout_accounts',          col: 'tenant' },
  { table: 'welivepay_orders',              col: 'tenant' },
  // -- referral activity (programs/rules/budgets/coupons are KEPT) --
  { table: 'referral_raffle_entries',       col: 'tenant' },
  { table: 'referral_raffle_draws',         col: 'tenant' },
  { table: 'referral_earnings',             col: 'tenant' },
  { table: 'referral_settlements',          col: 'tenant' },
  { table: 'referral_attributions',         col: 'tenant' },
  { table: 'referral_clicks',               col: 'tenant' },
  { table: 'referral_links',                col: 'tenant' },
  // -- per-player misc --
  { table: 'player_credit_adjustments',     col: 'tenant' },
  { table: 'player_limits',                 col: 'tenant' },
  // vip member history/txns (no tenant col -> scope by member; must precede vip_members) --
  { table: 'vip_transactions',              where: 'member_id IN (SELECT id FROM vip_members WHERE tenant=$1)' },
  { table: 'vip_member_history',            where: 'member_id IN (SELECT id FROM vip_members WHERE tenant=$1)' },
  { table: 'vip_members',                   col: 'tenant' },
  { table: 'admin_ip_allowlist',            col: 'tenant' },
  { table: 'user_otps',                     col: 'tenant' },
  { table: 'casino_likes',                  col: 'tenant' },
  { table: 'casino_recent',                 col: 'tenant' },
  { table: 'notifications',                 col: 'tenant' },
  { table: 'casino_game_bet_settings',      col: 'tenant_id' },
  // -- reporting --
  { table: 'reporting_daily_snapshots',     col: 'tenant' },
  { table: 'reporting_agent_rollups',       col: 'tenant' },
  { table: 'reporting_snapshot_events',     col: 'tenant' },
  { table: 'reporting_export_jobs',         col: 'tenant' },
  { table: 'reporting_saved_reports',       col: 'tenant' },
  // -- settlements / commission (cascade children of agents, but have tenant col) --
  { table: 'commission_payouts',            col: 'tenant' },
  { table: 'commission_adjustments',        col: 'tenant_id' },
  { table: 'commission_cycle_snapshots',    col: 'tenant_id' },
  { table: 'agent_settlement_transactions', col: 'tenant' },
  { table: 'settlements',                   col: 'tenant' },
  // -- game results / draws (matka market children before matkas, handled as a special step) --
  { table: 'sports_results',                col: 'tenant' },
  { table: 'sports_auto_results',           col: 'tenant' },
  { table: 'sports_auto_runs',              col: 'tenant' },
  { table: 'matka_results',                 col: 'tenant' },
  { table: 'matka_result_schedules',        col: 'tenant' },
  { table: 'matka_rate_versions',           col: 'tenant' },
  { table: 'draws',                         col: 'tenant' },
  { table: 'results',                       col: 'tenant' },
  // -- audit / approvals --
  { table: 'approvals',                     col: 'tenant' },
  { table: 'audit_annotations',             col: 'tenant' },
  { table: 'audit_export_jobs',             col: 'tenant' },
  { table: 'audit_logs',                    col: 'tenant' },
  // -- agent credit ledger (agents themselves are a special step -> cascades their children) --
  { table: 'agent_credit_ledger',           col: 'tenant_id' },
]

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

try {
  // Validate whitelabel exists + show current state
  const wl = await c.query(
    `SELECT id, name, status, credit_limit, credit_used, credit_available, settlement_balance
       FROM whitelabels WHERE id=$1`, [tenant])
  if (wl.rows.length === 0) { console.error(`Whitelabel '${tenant}' not found. Abort.`); await c.end(); process.exit(1) }
  const w = wl.rows[0]
  console.log('Target whitelabel:', { id: w.id, name: w.name, status: w.status })
  console.log(`  current credit: limit=${w.credit_limit} used=${w.credit_used} available=${w.credit_available} settlement=${w.settlement_balance}`)
  console.log(`Mode: ${confirm ? '*** CONFIRM (will COMMIT) ***' : 'DRY-RUN (will ROLLBACK)'}\n`)

  // ---------- Pre-flight: which WIPE tables/columns actually exist (outside any txn) ----------
  const colRows = (await c.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`)).rows
  const tableCols = new Set<string>(colRows.map((r: any) => `${r.table_name}.${r.column_name}`))
  const tables = new Set<string>(colRows.map((r: any) => r.table_name))
  const plan: Wipe[] = []
  for (const e of WIPE) {
    const ok = e.where ? tables.has(e.table) : tableCols.has(`${e.table}.${e.col}`)
    if (ok) plan.push(e)
    else console.log(`  (skip ${e.table}: ${e.where ? 'table missing' : `column "${e.col}" missing`})`)
  }

  // ---------- Resolve admin users to keep + original allocation (reads, pre-txn) ----------
  const adminQ = await c.query(
    `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.tenant = $1 AND r.name = 'Whitelabel Admin'`, [tenant])
  const adminIds = adminQ.rows.map((r: any) => r.id as number)
  console.log(`\n--- keep ${adminIds.length} whitelabel-admin user(s): [${adminIds.join(', ')}] ---`)

  const allocQ = await c.query(
    `SELECT amount FROM agent_credit_ledger
      WHERE tenant_id=$1 AND transaction_type='ALLOCATION' AND to_entity_type='whitelabel'
      ORDER BY created_at ASC, id ASC LIMIT 1`, [tenant])
  let originalAllocation: number
  if (limitOverride != null) {
    originalAllocation = limitOverride
    console.log(`  original allocation: ${originalAllocation} (from --limit override)`)
  } else if (allocQ.rows.length > 0) {
    originalAllocation = Number(allocQ.rows[0].amount)
    console.log(`  original allocation: ${originalAllocation} (first ALLOCATION ledger row)`)
  } else {
    originalAllocation = Number(w.credit_limit)
    console.log(`  ⚠ no ALLOCATION ledger row found — falling back to current credit_limit=${originalAllocation}. Use --limit to set explicitly.`)
  }

  // ---------- One atomic transaction. No try/catch inside: any real error aborts & rolls back. ----------
  await c.query('BEGIN')

  console.log('\n--- Phase 1: delete operational data ---')
  let total = 0
  for (const { table, col, where } of plan) {
    const pred = where ?? `${col}=$1`
    const cnt = (await c.query(`SELECT COUNT(*)::int n FROM "${table}" WHERE ${pred}`, [tenant])).rows[0].n
    if (!cnt) continue
    total += cnt
    const del = await c.query(`DELETE FROM "${table}" WHERE ${pred}`, [tenant])
    console.log(`  ${table.padEnd(32)} ${confirm ? 'deleted' : 'would del'} ${confirm ? del.rowCount : cnt}`)
  }

  // ---------- Phase 2: matka markets (worli instances have no tenant col -> by market_id) ----------
  console.log('\n--- Phase 2: matka markets ---')
  if (tables.has('matka_worli_instances')) {
    // matka_activity_logs.instance_id -> matka_worli_instances [NO ACTION] — clear before instances.
    if (tables.has('matka_activity_logs')) {
      const al = await c.query(
        `DELETE FROM matka_activity_logs WHERE instance_id IN
           (SELECT id FROM matka_worli_instances WHERE market_id IN (SELECT id FROM matkas WHERE tenant=$1))`, [tenant])
      if (al.rowCount) console.log(`  matka_activity_logs              ${confirm ? 'deleted' : 'would del'} ${al.rowCount}`)
    }
    const wi = await c.query(
      `DELETE FROM matka_worli_instances WHERE market_id IN (SELECT id FROM matkas WHERE tenant=$1)`, [tenant])
    if (wi.rowCount) console.log(`  matka_worli_instances            ${confirm ? 'deleted' : 'would del'} ${wi.rowCount}`)
  }
  const mk = (await c.query(`SELECT COUNT(*)::int n FROM matkas WHERE tenant=$1`, [tenant])).rows[0].n
  if (mk) {
    const del = await c.query(`DELETE FROM matkas WHERE tenant=$1`, [tenant]); total += mk
    console.log(`  matkas                           ${confirm ? 'deleted' : 'would del'} ${confirm ? del.rowCount : mk}`)
  } else { console.log('  (no matka markets)') }

  // ---------- Phase 3: agents (cascades every agent_* child table) ----------
  console.log('\n--- Phase 3: agents (+ cascade children) ---')
  const ag = (await c.query(`SELECT COUNT(*)::int n FROM agents WHERE tenant_id=$1`, [tenant])).rows[0].n
  if (ag) {
    const del = await c.query(`DELETE FROM agents WHERE tenant_id=$1`, [tenant]); total += ag
    console.log(`  agents                           ${confirm ? 'deleted' : 'would del'} ${confirm ? del.rowCount : ag} (credentials/config/wallets/ledger/settlements/closure/player-credits cascade)`)
  } else { console.log('  (no agents)') }

  // ---------- Phase 4: users / clients (keep whitelabel admins; cascades remaining child rows) ----------
  console.log('\n--- Phase 4: users / clients (keeping admins) ---')
  const params: any[] = [tenant]
  let uwhere = 'tenant=$1'
  if (adminIds.length) { uwhere += ' AND id <> ALL($2::int[])'; params.push(adminIds) }
  const uc = (await c.query(`SELECT COUNT(*)::int n FROM users WHERE ${uwhere}`, params)).rows[0].n
  if (uc) {
    const del = await c.query(`DELETE FROM users WHERE ${uwhere}`, params); total += uc
    console.log(`  users                            ${confirm ? 'deleted' : 'would del'} ${confirm ? del.rowCount : uc}`)
  } else { console.log('  (no non-admin users)') }

  // ---------- Phase 5: reset whitelabel credit to original allocation ----------
  console.log('\n--- Phase 5: reset whitelabel credit ---')
  console.log(`  -> credit_limit=${originalAllocation}, credit_used=0, credit_available=${originalAllocation}, settlement_balance(s)=0`)
  if (confirm) {
    await c.query(
      `UPDATE whitelabels
          SET credit_limit=$2, credit_used='0', credit_available=$2,
              settlement_balance='0', settlement_balance_sports='0',
              settlement_balance_casino='0', settlement_balance_matka='0'
        WHERE id=$1`, [tenant, originalAllocation.toString()])
  }

  // ---------- Phase 6: verify (only when committing) ----------
  if (confirm) {
    console.log('\n--- Phase 6: verify ---')
    const checks: [string, string][] = [
      ['agents', 'tenant_id'], ['agent_credit_ledger', 'tenant_id'], ['wallets', 'tenant'],
      ['sports_bets', 'tenant'], ['casino_bets', 'tenant'], ['matka_bets', 'tenant'],
    ]
    let leftover = 0
    for (const [t, col] of checks) {
      const n = (await c.query(`SELECT COUNT(*)::int n FROM "${t}" WHERE ${col}=$1`, [tenant])).rows[0].n
      if (n) { leftover += n; console.log(`  ⚠ ${t} still has ${n} rows`) }
    }
    const usersLeft = (await c.query(`SELECT COUNT(*)::int n FROM users WHERE tenant=$1`, [tenant])).rows[0].n
    console.log(`  remaining users (admins kept): ${usersLeft}`)
    console.log(`  leftover operational rows    : ${leftover} ${leftover === 0 ? '✓' : '❌'}`)
  }

  if (confirm) {
    await c.query('COMMIT')
    console.log(`\n✅ COMMITTED. Tenant '${tenant}' reset to fresh-created state. Total operational rows deleted: ${total}.`)
  } else {
    await c.query('ROLLBACK')
    console.log(`\n(DRY-RUN) ROLLBACK done. ${total} rows would be deleted. Re-run with --confirm to commit.`)
  }
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('\n❌ FAILED — transaction rolled back. Error:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await c.end()
}
