import 'dotenv/config'
import { Client } from 'pg'

// Read-only survey of a tenant's data volume across the credit/sharing/commission surfaces.
//   npx tsx scripts/auditTenantSurvey.ts thetitanbook-fun

async function main() {
  const tenant = process.argv[2]
  if (!tenant) { console.error('usage: auditTenantSurvey.ts <tenant>'); process.exit(1) }
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const q = async (label: string, sql: string, params: any[] = []) => {
    try { const r = await c.query(sql, params); console.log(`\n### ${label}`); console.table(r.rows) }
    catch (e: any) { console.log(`\n### ${label}  (err: ${e.message})`) }
  }

  await q('users by player_type', `SELECT player_type, count(*) n FROM users WHERE tenant=$1 GROUP BY 1 ORDER BY 1`, [tenant])
  await q('agents by scheme_type (tenant_id)', `SELECT scheme_type, status, count(*) n FROM agents WHERE tenant_id=$1 GROUP BY 1,2 ORDER BY 1,2`, [tenant])
  await q('wallets count', `SELECT count(*) n, round(sum(cast(cash as numeric)),2) total_cash, round(sum(cast(exposure as numeric)),2) total_exposure FROM wallets WHERE tenant=$1`, [tenant])
  await q('casino_bets by status', `SELECT status, count(*) n, round(sum(cast(stake as numeric)),2) stake FROM casino_bets WHERE tenant=$1 GROUP BY 1 ORDER BY 1`, [tenant])
  await q('sports bets count (if table)', `SELECT count(*) n FROM sports_bets WHERE tenant=$1`, [tenant])
  await q('agent_ledger by line_type', `SELECT al.line_type, al.domain, count(*) n, round(sum(cast(al.amount as numeric)),2) amt FROM agent_ledger al JOIN agents a ON a.id=al.agent_id WHERE a.tenant_id=$1 GROUP BY 1,2 ORDER BY 1,2`, [tenant])
  await q('agent_settlements by status', `SELECT s.status, count(*) n, round(sum(cast(s.total_amount as numeric)),2) amt FROM agent_settlements s JOIN agents a ON a.id=s.agent_id WHERE a.tenant_id=$1 GROUP BY 1`, [tenant])
  await q('commission_payouts', `SELECT count(*) n, round(sum(cast(amount as numeric)),2) amt FROM commission_payouts p JOIN agents a ON a.id=p.agent_id WHERE a.tenant_id=$1`, [tenant])
  await q('agent_player_credits count', `SELECT count(*) n FROM agent_player_credits apc JOIN agents a ON a.id=apc.agent_id WHERE a.tenant_id=$1`, [tenant])
  await q('whitelabel row', `SELECT id, credit_limit, credit_used, credit_available, settlement_balance, settlement_balance_sports, settlement_balance_casino, settlement_balance_matka FROM whitelabels WHERE id=$1`, [tenant])

  await c.end()
}
main().catch((e) => { console.error('survey failed:', e.message); process.exit(1) })
