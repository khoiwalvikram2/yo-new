/**
 * The SQL of an agent's export (agent features spec §4). The agent's players must be filtered in
 * the WHERE of the same statement that carries the 10k cap. The old processor capped the
 * whitelabel's rows first and filtered them in memory, so an agent's file came out short. The
 * filter must also be the reporting definition (closure subtree + confirmed referrals).
 *
 * Unit tests: SQL is rendered with .toSQL(), never executed.
 *   node --env-file-if-exists=.env --test --import tsx src/repos/reporting/__tests__/agentExportQueries.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_EXPORT_ROW_CAP,
  agentCasinoBetsQuery,
  agentDepositsQuery,
  agentMatkaBetsQuery,
  agentPlayersQuery,
  agentSettlementsQuery,
  agentSportsBetsQuery,
  agentWithdrawalsQuery,
  agentsInScopeQuery,
  pickEnumValue,
} from '../agentExportQueries.js'
import { depositStatusEnum, payoutStatusEnum } from '@shared/db/schema.js'

const SCOPE = { agentId: 'agent-9', tenant: 'brand-a', whitelabelId: 'wl-a' }
const WINDOW = { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-07T23:59:59.999Z') }
const flat = (text: string) => text.replace(/\s+/g, ' ')
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const PLAYER_SCOPED: Array<[string, () => { toSQL(): { sql: string; params: unknown[] } }, string]> = [
  ['players', () => agentPlayersQuery(SCOPE, 'active'), '"users"."id"'],
  ['sports bets', () => agentSportsBetsQuery(SCOPE, WINDOW, 'won'), '"sports_bets"."user_id"'],
  ['casino bets', () => agentCasinoBetsQuery(SCOPE, WINDOW, 'lost'), '"casino_bets"."user_id"'],
  ['matka bets', () => agentMatkaBetsQuery(SCOPE, WINDOW, 'pending', 'worli'), '"matka_bets"."user_id"'],
  ['deposits', () => agentDepositsQuery(SCOPE, WINDOW, 'pending'), '"deposit_requests"."user_id"'],
  ['withdrawals', () => agentWithdrawalsQuery(SCOPE, WINDOW, 'completed'), '"withdrawal_requests"."user_id"'],
]

describe('agent export queries', () => {
  for (const [name, build, column] of PLAYER_SCOPED) {
    it(`${name}: the agent's players are filtered in the WHERE of the statement that is capped`, () => {
      const q = build().toSQL()
      const text = flat(q.sql)
      assert.match(text, new RegExp(` where .*${escape(column)} IN \\( ?WITH agent_descendants.* limit \\$\\d+$`, 'i'))
      assert.match(text, /agent_hierarchy_closure/, 'the subtree comes from the closure table')
      assert.match(text, /referral_attributions/, 'referral-linked players count')
      assert.match(text, /status = 'confirmed'/, 'confirmed referrals only')
      assert.doesNotMatch(text, /parent_agent_id/, 'a direct-parent check would miss grandchildren')
      assert.equal(q.params.at(-1), AGENT_EXPORT_ROW_CAP)
      assert.ok(q.params.includes('agent-9'), 'bound to the scope agent')
      assert.ok(q.params.includes('brand-a'), 'players of the scope tenant only')
    })
  }

  it('players: selects only the columns the export writes, never the credentials', () => {
    const text = flat(agentPlayersQuery(SCOPE).toSQL().sql)
    assert.doesNotMatch(text, /password_hash/, 'the password hash never leaves the database')
    assert.doesNotMatch(text, /token_version/)
    assert.match(text, /^select "id", "name", .* from "users" where/i, 'an explicit column list, not select *')
  })

  it('keeps the tenant and whitelabel predicates on bets', () => {
    for (const build of [() => agentSportsBetsQuery(SCOPE, {}), () => agentCasinoBetsQuery(SCOPE, {}), () => agentMatkaBetsQuery(SCOPE, {})]) {
      const q = build().toSQL()
      const text = flat(q.sql)
      assert.match(text, /"(sports|casino|matka)_bets"\."tenant" = \$\d+/)
      assert.match(text, /"(sports|casino|matka)_bets"\."whitelabel_id" = \$\d+/)
      assert.ok(q.params.includes('wl-a'))
    }
  })

  it('applies the period to created_at, and only when one is given', () => {
    const text = flat(agentSportsBetsQuery(SCOPE, WINDOW).toSQL().sql)
    assert.match(text, /"sports_bets"\."created_at" >= \$\d+/)
    assert.match(text, /"sports_bets"\."created_at" <= \$\d+/)
    assert.doesNotMatch(flat(agentSportsBetsQuery(SCOPE, {}).toSQL().sql), /"created_at" >=/)
  })

  it('a status the column cannot hold matches nothing instead of failing the export', () => {
    assert.equal(pickEnumValue('pending', depositStatusEnum.enumValues), 'PENDING')
    assert.equal(pickEnumValue('all', depositStatusEnum.enumValues), undefined)
    assert.equal(pickEnumValue('', depositStatusEnum.enumValues), undefined)
    assert.equal(pickEnumValue(undefined, depositStatusEnum.enumValues), undefined)
    assert.equal(pickEnumValue('rejected', payoutStatusEnum.enumValues), null)
    assert.ok(agentDepositsQuery(SCOPE, {}, 'pending').toSQL().params.includes('PENDING'))
    assert.match(flat(agentWithdrawalsQuery(SCOPE, {}, 'rejected').toSQL().sql), /\bfalse\b/)
  })

  it("settlements: the listed agents' rows only, in the tenant, capped", () => {
    const q = agentSettlementsQuery('brand-a', ['a-1', 'a-2'], WINDOW).toSQL()
    const text = flat(q.sql)
    assert.match(text, /"agent_settlement_transactions"\."agent_id" in \(\$\d+, \$\d+\)/)
    assert.match(text, /"agent_settlement_transactions"\."tenant" = \$\d+/)
    assert.match(text, / limit \$\d+$/)
    assert.match(
      text,
      /order by "agent_settlement_transactions"\."created_at" desc, "agent_settlement_transactions"\."id" desc/,
      'an id tiebreak keeps the cap deterministic',
    )
    assert.equal(q.params.at(-1), AGENT_EXPORT_ROW_CAP)
    assert.match(flat(agentSettlementsQuery('brand-a', [], WINDOW).toSQL().sql), /\bfalse\b/, 'no agents, no rows')
  })

  it('the scope agents query is tenant-bound and lists only the given ids', () => {
    const text = flat(agentsInScopeQuery('brand-a', ['a-1']).toSQL().sql)
    assert.match(text, /"agents"\."tenant_id" = \$\d+/)
    assert.match(text, /"agents"\."id" in \(\$\d+\)/)
    assert.match(flat(agentsInScopeQuery('brand-a', []).toSQL().sql), /\bfalse\b/)
  })
})
