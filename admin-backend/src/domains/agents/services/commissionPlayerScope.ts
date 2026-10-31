/**
 * Which agent a player's bets belong to, for commission and for the SHARING
 * "SHARE" payout (decision 3, 2026-10-21: referral-linked players count).
 *
 * A player reaches an agent by one of two routes, the same two reporting uses
 * (AgentFilterUtils.buildAgentFilterCTE):
 *   1. `users.agent_id`;
 *   2. a CONFIRMED `referral_attributions` row whose referrer is one of the
 *      agent's players (same tenant).
 *
 * For money, each player belongs to exactly ONE agent:
 * `COALESCE(users.agent_id, referrer.agent_id)`. A referred player that has its
 * own agent_id stays with that agent and is never counted again through its
 * referrer (reporting's set UNION would include it in both subtrees; paying on
 * it twice is the thing this rule prevents). referral_attributions has a unique
 * index on referee_id, so the join never fans a bet out.
 *
 * Usage: a query already LEFT JOINed to `users` on the bet's user id calls
 * `withReferralScope(query, tenant)` and filters/groups on `attributedAgentId`.
 */

import { and, eq, sql, type AnyColumn } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { users, referralAttributions } from '@shared/db/schema';

export const referrerUsers = alias(users, 'ggr_referrer');

/** The one agent a bet's player belongs to. Needs `users` and `withReferralScope` joins. */
export const attributedAgentId = sql<string>`COALESCE(${users.agentId}, ${referrerUsers.agentId})`;

export { referralAttributions };

/** ON clause for `LEFT JOIN referral_attributions` (needs `users` joined on the bet's user id). */
export function referralAttributionJoinOn(tenantId: string | AnyColumn) {
	return and(
		eq(referralAttributions.refereeId, users.id),
		eq(referralAttributions.status, 'confirmed'),
		eq(referralAttributions.tenant, tenantId),
	);
}

/** ON clause for `LEFT JOIN users AS ggr_referrer` (after referralAttributionJoinOn). */
export function referrerJoinOn(tenantId: string | AnyColumn) {
	return and(eq(referrerUsers.id, referralAttributions.referrerId), eq(referrerUsers.tenant, tenantId));
}

/** IST Monday (YYYY-MM-DD) of the commission cycle a bet was placed in. */
export const istCycleKeySql = (createdAt: AnyColumn) =>
	sql<string>`to_char(date_trunc('week', ${createdAt} AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;

/** Adds the referral route (confirmed attribution -> referrer's agent) to a query joined to users. */
export function withReferralScope(query: any, tenantId: string): any {
	return query
		.leftJoin(referralAttributions, referralAttributionJoinOn(tenantId))
		.leftJoin(referrerUsers, referrerJoinOn(tenantId));
}
