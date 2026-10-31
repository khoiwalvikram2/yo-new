/**
 * Repair agent_credentials.tenant_id so it matches the owning agent's agents.tenant_id.
 *
 * Why: migration 0084 made agent usernames unique PER TENANT and scoped the agent-login
 * lookup to the credential's tenant_id. On DBs where the tenant_id column was added but the
 * backfill from agents never ran, every agent_credentials.tenant_id is left at the column
 * default ('default'). For agents in a non-default tenant (e.g. gamdaddy-com) this is wrong:
 *   - once the tenant-scoped login code is live, those agents CANNOT log in
 *     (login filters WHERE tenant_id = <context tenant>, which won't match 'default'), and
 *   - per-tenant username uniqueness is effectively disabled (everyone under 'default').
 * This script sets each credential's tenant_id to its agent's tenant_id.
 *
 * SAFE: dry-run by default; only touches mismatched rows; refuses to apply if the fix would
 * create a duplicate (tenant_id, lower(username)) (the unique index from migration 0084).
 * Nothing else (password, username, …) is changed.
 *
 * Usage:
 *   npm run repair:agent-cred-tenant                      # DRY-RUN (show what would change)
 *   npm run repair:agent-cred-tenant -- --apply           # COMMIT the fix
 *   npm run repair:agent-cred-tenant -- --tenant gamdaddy-com          # dry-run, one agent-tenant
 *   npm run repair:agent-cred-tenant -- --tenant gamdaddy-com --apply  # commit, one agent-tenant
 */

import 'dotenv/config'
import pg from 'pg'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const onlyTenant = arg('tenant') // optional: limit to agents whose agents.tenant_id = this
const apply = process.argv.includes('--apply')

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(2) }
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    console.log(`DB: ${(() => { try { return new URL(process.env.DATABASE_URL!).host } catch { return '?' } })()} | mode: ${apply ? '*** APPLY ***' : 'dry-run'}${onlyTenant ? ` | tenant filter: ${onlyTenant}` : ''}\n`)

    // 1. Mismatched credentials (credential tenant != owning agent's tenant).
    const mismatchSql = `
      SELECT ac.agent_id, ac.username, ac.tenant_id AS cred_tenant, a.tenant_id AS agent_tenant
      FROM agent_credentials ac
      JOIN agents a ON a.id = ac.agent_id
      WHERE ac.tenant_id IS DISTINCT FROM a.tenant_id
        ${onlyTenant ? 'AND a.tenant_id = $1' : ''}
      ORDER BY a.tenant_id, ac.username`
    const mismatch = await c.query(mismatchSql, onlyTenant ? [onlyTenant] : [])
    console.log(`Mismatched rows (cred tenant != agent tenant): ${mismatch.rowCount}`)
    if (mismatch.rowCount) {
      console.table(mismatch.rows.map((r: any) => ({ username: r.username, cred_tenant: r.cred_tenant, '-> agent_tenant': r.agent_tenant })))
    }

    // 2. Orphan credentials (no matching agent) — cannot derive a tenant; report only.
    const orphan = await c.query(
      `SELECT ac.username, ac.tenant_id FROM agent_credentials ac
       LEFT JOIN agents a ON a.id = ac.agent_id WHERE a.id IS NULL`
    )
    if (orphan.rowCount) {
      console.log(`\nNOTE: ${orphan.rowCount} orphan credential(s) with no matching agent — left untouched (no agent tenant to use):`)
      console.table(orphan.rows)
    }

    if (mismatch.rowCount === 0) {
      console.log('\nNothing to repair — every agent_credentials.tenant_id already matches its agent. ✅')
      return
    }

    // 3. Collision safety: would the corrected state violate UNIQUE (tenant_id, lower(username))?
    //    Compute the effective tenant for EVERY credential (agent tenant when present) and look
    //    for duplicate (eff_tenant, lower(username)). If any exist, applying would 23505.
    const collide = await c.query(`
      SELECT eff_tenant, lower(username) AS lu, count(*)::int AS n,
             array_agg(username) AS usernames
      FROM (
        SELECT COALESCE(a.tenant_id, ac.tenant_id) AS eff_tenant, ac.username
        FROM agent_credentials ac
        LEFT JOIN agents a ON a.id = ac.agent_id
      ) t
      GROUP BY 1, 2
      HAVING count(*) > 1`)
    if (collide.rowCount) {
      console.log(`\n🛑 REFUSING TO APPLY: the fix would create ${collide.rowCount} duplicate (tenant_id, lower(username)) group(s):`)
      console.table(collide.rows)
      console.log('Resolve these username clashes within a tenant first (rename one), then re-run.')
      process.exit(1)
    }

    if (!apply) {
      console.log('\n(dry-run) The above row(s) WOULD be updated to their agent\'s tenant_id. No collisions detected — safe to apply.')
      console.log('Re-run with --apply to commit.')
      return
    }

    // 4. Apply inside a transaction.
    await c.query('BEGIN')
    const upd = await c.query(
      `UPDATE agent_credentials ac
       SET tenant_id = a.tenant_id
       FROM agents a
       WHERE ac.agent_id = a.id
         AND ac.tenant_id IS DISTINCT FROM a.tenant_id
         ${onlyTenant ? 'AND a.tenant_id = $1' : ''}`,
      onlyTenant ? [onlyTenant] : []
    )
    await c.query('COMMIT')
    console.log(`\n✅ APPLIED: ${upd.rowCount} credential(s) updated to match their agent's tenant_id.`)

    // 5. Verify.
    const left = await c.query(mismatchSql, onlyTenant ? [onlyTenant] : [])
    console.log(`Remaining mismatches: ${left.rowCount} (should be 0).`)
  } catch (e: any) {
    try { await c.query('ROLLBACK') } catch { /* ignore */ }
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error('repair failed:', e.message); process.exit(1) })
