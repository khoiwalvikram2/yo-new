/**
 * Regression guard for agent-scoped bet filtering.
 *
 * A player belongs to an agent by one of two routes:
 *   - direct assignment  (users.agent_id points at the agent)
 *   - referral           (referral_attributions.referee_id)
 *
 * An earlier revision resolved the referral route only. Every agent whose
 * players were assigned directly — the common case — therefore matched zero
 * players, and agent-scoped analytics reported 0 bets while the reporting
 * repos, which filter on users.agent_id, reported the true totals.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sql } from 'drizzle-orm';
import { buildAgentFilterCTE, isEmptySqlCondition, userConditionForReduce } from '../AgentFilterUtils.js';

/** Flatten a drizzle SQL object into inspectable text.
 *  Drizzle keeps its parts in `queryChunks`; sql.raw() wraps text in a chunk
 *  whose `value` is a string[]. */
function sqlText(fragment: any): string {
	const chunks = fragment?.queryChunks ?? [];
	return chunks
		.map((c: any) => {
			if (typeof c === 'string') return c;
			const v = c?.value;
			if (typeof v === 'string') return v;
			if (Array.isArray(v)) return v.join('');
			return '';
		})
		.join('');
}

describe('buildAgentFilterCTE', () => {
	it('returns empty fragments when no agent is supplied (admin view)', () => {
		const { cte, userCondition } = buildAgentFilterCTE(undefined, 'tenant-a', 'cb.user_id');
		assert.ok(isEmptySqlCondition(userCondition), 'userCondition must be empty for admins');
		assert.strictEqual(sqlText(cte).trim(), '', 'cte must be empty for admins');
	});

	it('resolves players assigned DIRECTLY via users.agent_id', () => {
		const { cte } = buildAgentFilterCTE('agent-1', 'tenant-a', 'cb.user_id');
		const text = sqlText(cte);
		assert.match(text, /agent_direct_players/, 'must define a direct-assignment branch');
		assert.match(text, /FROM users/, 'direct branch reads from users');
		assert.match(text, /agent_id IN \(SELECT descendant_id FROM agent_descendants\)/);
	});

	it('still resolves players attributed via referral', () => {
		const { cte } = buildAgentFilterCTE('agent-1', 'tenant-a', 'cb.user_id');
		const text = sqlText(cte);
		assert.match(text, /agent_referred_players/, 'must keep the referral branch');
		assert.match(text, /referral_attributions/);
	});

	it('UNIONs both routes so neither is lost', () => {
		const text = sqlText(buildAgentFilterCTE('agent-1', 'tenant-a', 'cb.user_id').cte).replace(/\s+/g, ' ');
		assert.match(text, /agent_players AS \( SELECT player_id FROM agent_direct_players UNION SELECT player_id FROM agent_referred_players/);
	});

	it('scopes the subtree through the closure table, not parent_agent_id', () => {
		const text = sqlText(buildAgentFilterCTE('agent-1', 'tenant-a', 'cb.user_id').cte);
		assert.match(text, /agent_hierarchy_closure/, 'closure table supports arbitrary depth');
		assert.doesNotMatch(text, /parent_agent_id/, 'a direct-parent check would miss grandchildren');
	});

	it('binds the supplied user_id column in the emitted condition', () => {
		const { userCondition } = buildAgentFilterCTE('agent-1', 'tenant-a', 'sb.user_id');
		const text = sqlText(userCondition);
		assert.match(text, /sb\.user_id IN \(SELECT player_id FROM agent_players\)/);
		assert.ok(text.trim().startsWith('AND'), 'condition is designed to append to a WHERE clause');
	});

	it('userConditionForReduce strips the leading AND', () => {
		const { userCondition } = buildAgentFilterCTE('agent-1', 'tenant-a', 'mb.user_id');
		const reduced = sqlText(userConditionForReduce(userCondition));
		assert.ok(!/^\s*AND\b/i.test(reduced), 'must not double up ANDs when combined');
		assert.match(reduced, /mb\.user_id IN/);
	});
});

describe('isEmptySqlCondition', () => {
	// This helper inspected `.sql` and `.chunks`, neither of which exists on a
	// drizzle SQL object (it uses `queryChunks`), so every branch fell through
	// and it returned false for every input — it could never detect an empty
	// condition at all.
	const cases: Array<[string, ReturnType<typeof sql>, boolean]> = [
		['bare empty template', sql``, true],
		['raw empty string', sql.raw(''), true],
		['raw bare AND', sql.raw('AND'), true],
		['raw real condition', sql.raw('AND x = 1'), false],
		['admin view (no agent)', buildAgentFilterCTE(undefined, 't', 'cb.user_id').userCondition, true],
		['agent view', buildAgentFilterCTE('a1', 't', 'cb.user_id').userCondition, false],
	];

	for (const [label, fragment, expected] of cases) {
		it(`reports ${label} as ${expected ? 'empty' : 'non-empty'}`, () => {
			assert.strictEqual(isEmptySqlCondition(fragment), expected);
		});
	}

	it('treats null and undefined as empty', () => {
		assert.strictEqual(isEmptySqlCondition(null), true);
		assert.strictEqual(isEmptySqlCondition(undefined), true);
	});
});

describe('userConditionForReduce', () => {
	it('returns an empty fragment when there is nothing to contribute', () => {
		const { userCondition } = buildAgentFilterCTE(undefined, 't', 'cb.user_id');
		assert.ok(isEmptySqlCondition(userConditionForReduce(userCondition)));
	});

	it('preserves the condition when one exists', () => {
		const { userCondition } = buildAgentFilterCTE('a1', 't', 'cb.user_id');
		// Previously this always returned an empty fragment, silently dropping
		// the agent scope from any query that combined conditions via reduce().
		assert.ok(!isEmptySqlCondition(userConditionForReduce(userCondition)));
	});
});
