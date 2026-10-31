/**
 * Decision 3 (2026-10-21): players linked to an agent through a CONFIRMED
 * referral_attributions row count in that agent's commission (and SHARE), and
 * every player is counted ONCE, under one agent: COALESCE(users.agent_id,
 * referrer.agent_id).
 *
 * READ-ONLY against the configured database: SELECTs only, compared with an
 * independent formulation (WHERE ... IN / EXISTS, no joins that could fan out).
 * Skipped without DATABASE_URL, or when the data has no case to check.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/liveGGRReferralScope.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';

const hasDb = Boolean(process.env.DATABASE_URL);
const FAR_PAST = new Date(0);
const FAR_FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

async function rows(query: ReturnType<typeof sql>): Promise<any[]> {
	const { db } = await import('@/db/client.js');
	const r: any = await db.execute(query);
	return Array.isArray(r) ? r : r?.rows ?? [];
}

describe('LiveGGRReader: referral-linked players (decision 3)', { skip: !hasDb }, () => {
	it('the SQL attributes each bet to one agent: COALESCE(agent_id, referrer agent_id), confirmed referrals only', async () => {
		const { attributedAgentId, referralAttributionJoinOn } = await import('../commissionPlayerScope.js');
		const { PgDialect } = await import('drizzle-orm/pg-core');
		const dialect = new PgDialect();
		const attributed = dialect.sqlToQuery(attributedAgentId).sql;
		assert.match(attributed, /COALESCE\("users"\."agent_id", "ggr_referrer"\."agent_id"\)/);
		const on = dialect.sqlToQuery(referralAttributionJoinOn('t1') as any);
		assert.match(on.sql, /"referral_attributions"\."status" = \$\d/);
		assert.ok(on.params.includes('confirmed'));
	});

	it('an agent\'s casino GGR includes its players\' confirmed referees that have no agent of their own', async () => {
		const [pick] = await rows(sql`
			SELECT ra.tenant AS tenant, ru.agent_id AS agent_id, ra.referee_id AS referee_id
			FROM referral_attributions ra
			JOIN users u ON u.id = ra.referee_id
			JOIN users ru ON ru.id = ra.referrer_id
			WHERE ra.status = 'confirmed' AND u.agent_id IS NULL AND ru.agent_id IS NOT NULL AND ru.tenant = ra.tenant
			  AND EXISTS (SELECT 1 FROM casino_bets cb WHERE cb.user_id = u.id AND cb.wallet_type = 'cash'
			              AND cb.status IN ('won', 'lost') AND cb.tenant = ra.tenant AND cb.whitelabel_id = ra.tenant)
			LIMIT 1`);
		if (!pick) return; // no referred player with casino bets in this database
		const tenant = String(pick.tenant);
		const agentId = String(pick.agent_id);

		const [expected] = await rows(sql`
			SELECT COALESCE(SUM(cb.stake::numeric - COALESCE(cb.payout::numeric, cb.win_amount::numeric, 0)), 0) AS ggr
			FROM casino_bets cb
			WHERE cb.tenant = ${tenant} AND cb.whitelabel_id = ${tenant} AND cb.wallet_type = 'cash'
			  AND cb.status IN ('won', 'lost')
			  AND cb.user_id IN (
			    SELECT id FROM users WHERE agent_id = ${agentId}
			    UNION
			    SELECT ra.referee_id FROM referral_attributions ra
			    JOIN users ru ON ru.id = ra.referrer_id
			    JOIN users u ON u.id = ra.referee_id
			    WHERE ra.status = 'confirmed' AND ra.tenant = ${tenant} AND ru.tenant = ${tenant}
			      AND ru.agent_id = ${agentId} AND u.agent_id IS NULL
			  )`);
		const [refereeOnly] = await rows(sql`
			SELECT COALESCE(SUM(cb.stake::numeric - COALESCE(cb.payout::numeric, cb.win_amount::numeric, 0)), 0) AS ggr,
			       COUNT(*)::int AS n
			FROM casino_bets cb
			WHERE cb.user_id = ${Number(pick.referee_id)} AND cb.tenant = ${tenant} AND cb.whitelabel_id = ${tenant}
			  AND cb.wallet_type = 'cash' AND cb.status IN ('won', 'lost')`);
		assert.ok(Number(refereeOnly.n) > 0);

		const { LiveGGRReader } = await import('../LiveGGRReader.js');
		const live = await new LiveGGRReader().getCasinoGGRByAgentIds({
			agentIds: [agentId],
			tenantId: tenant,
			from: FAR_PAST,
			to: FAR_FUTURE,
			whitelabelId: tenant,
		});
		assert.ok(Math.abs(live.ggr - Number(expected.ggr)) < 0.01, `live ${live.ggr} vs expected ${expected.ggr}`);
	});

	it('across every agent of a tenant, each bet is counted once (sum of per-agent rows = independent total)', async () => {
		const [pick] = await rows(sql`
			SELECT ra.tenant AS tenant FROM referral_attributions ra
			WHERE ra.status = 'confirmed' GROUP BY ra.tenant ORDER BY COUNT(*) DESC LIMIT 1`);
		if (!pick) return;
		const tenant = String(pick.tenant);
		const agentIds = (await rows(sql`SELECT id FROM agents WHERE tenant_id = ${tenant}`)).map((r) => String(r.id));
		if (agentIds.length === 0) return;

		const [expected] = await rows(sql`
			SELECT COALESCE(SUM(cb.stake::numeric - COALESCE(cb.payout::numeric, cb.win_amount::numeric, 0)), 0) AS ggr
			FROM casino_bets cb
			JOIN users u ON u.id = cb.user_id
			WHERE cb.tenant = ${tenant} AND cb.whitelabel_id = ${tenant} AND cb.wallet_type = 'cash'
			  AND cb.status IN ('won', 'lost')
			  AND (
			    u.agent_id IN (SELECT id FROM agents WHERE tenant_id = ${tenant})
			    OR (u.agent_id IS NULL AND EXISTS (
			      SELECT 1 FROM referral_attributions ra JOIN users ru ON ru.id = ra.referrer_id
			      WHERE ra.referee_id = u.id AND ra.status = 'confirmed' AND ra.tenant = ${tenant}
			        AND ru.tenant = ${tenant} AND ru.agent_id IN (SELECT id FROM agents WHERE tenant_id = ${tenant})
			    ))
			  )`);

		const { LiveGGRReader } = await import('../LiveGGRReader.js');
		const perAgent = await new LiveGGRReader().getGGRByCycleAndAgent({
			agentIds,
			tenantId: tenant,
			from: FAR_PAST,
			to: FAR_FUTURE,
			whitelabelId: tenant,
		});
		const total = perAgent.reduce((s, r) => s + r.casino, 0);
		assert.ok(Math.abs(total - Number(expected.ggr)) < 0.05, `per-agent sum ${total} vs independent ${expected.ggr}`);
		// One row per (cycle, agent): no agent appears twice for a cycle.
		const keys = perAgent.map((r) => `${r.cycleKey}|${r.agentId}`);
		assert.equal(new Set(keys).size, keys.length);
	});
});
