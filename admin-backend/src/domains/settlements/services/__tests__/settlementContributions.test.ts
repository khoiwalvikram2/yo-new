/**
 * SHARING settlement contributions (W9): decision 3 — referral-linked players
 * count — and the whole subtree, each player once.
 *
 * The assembly is pure; the player-scope query is checked by rendering its SQL.
 * No database is read or written.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/settlements/services/__tests__/settlementContributions.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assembleContributions, scopedPlayersQuery, type ScopedPlayerRow, type PlayerDomainActivity } from '../SettlementContributionService.js'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // the agent being settled
const C1 = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1' // direct child
const G1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1' // grandchild under C1
const C2 = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2' // direct child with no players

const player = (playerId: number, viaAgentId: string, over: Partial<ScopedPlayerRow> = {}): ScopedPlayerRow => ({
  playerId,
  name: `p${playerId}`,
  username: `u${playerId}`,
  status: 'active',
  viaAgentId,
  route: 'direct',
  ...over,
})

describe('assembleContributions', () => {
  // 1: A's own player. 2: referred by player 1 (no agent of its own) → A's bucket.
  // 3: grandchild G1's player → C1's bucket. 4: suspended but bet in the window.
  // 5: suspended, no bets → not listed. 6: active, no bets → listed with zeros.
  const players: ScopedPlayerRow[] = [
    player(1, A),
    player(2, A, { route: 'referral' }),
    player(2, A, { route: 'referral' }), // the same player twice must count once
    player(3, G1),
    player(4, C1, { status: 'SUSPENDED' }),
    player(5, C1, { status: 'suspended' }),
    player(6, A),
  ]
  const activity: PlayerDomainActivity[] = [
    { playerId: 1, domain: 'sports', ggr: 1000, share: 200 },
    { playerId: 2, domain: 'sports', ggr: 500, share: 100 },
    { playerId: 2, domain: 'casino', ggr: -100, share: -20 },
    { playerId: 3, domain: 'sports', ggr: 300, share: 60 },
    { playerId: 4, domain: 'matka', ggr: 50, share: 10 },
    // In the SHARE base but missing from the player list (e.g. another tenant's user row).
    { playerId: 7, domain: 'sports', ggr: 10, share: 2, viaAgentId: G1 },
  ]
  const childOf = new Map<string, string>([[C1, C1], [G1, C1], [C2, C2]])
  const out = assembleContributions({
    agentId: A,
    players,
    children: [{ id: C1, username: 'child1' }, { id: C2, username: 'child2' }],
    childOf,
    activity,
  })

  it('counts a referral-linked player once, in the bucket of the agent it is attributed to', () => {
    const ids = out.directPlayers.map((p) => p.playerId).sort()
    assert.deepEqual(ids, [1, 2, 6])
    const p2 = out.directPlayers.find((p) => p.playerId === 2)!
    assert.equal(p2.share, 80)
    assert.equal(p2.pl, -400, 'P/L is the player side: −GGR')
    assert.equal(p2.domainBreakdown.casino.cutAmount, -80, 'cut = GGR − share')
  })

  it('covers the whole subtree: a grandchild’s players are under the direct child', () => {
    const c1 = out.subAgents.find((s) => s.subAgentId === C1)!
    assert.deepEqual(c1.players.map((p) => p.playerId).sort(), [3, 4, 7])
    assert.equal(c1.totalShare, 72)
    assert.equal(c1.playerCount, 3)
    const c2 = out.subAgents.find((s) => s.subAgentId === C2)!
    assert.equal(c2.playerCount, 0)
  })

  it('lists inactive players only when they bet in the window', () => {
    const all = [...out.directPlayers, ...out.subAgents.flatMap((s) => s.players)].map((p) => p.playerId)
    assert.ok(all.includes(4), 'suspended player with bets is counted')
    assert.ok(!all.includes(5), 'suspended player without bets is not')
  })

  it('the shares add up to the agent’s SHARE base (every activity row counted once)', () => {
    const expected = activity.reduce((s, a) => s + a.share, 0)
    assert.equal(Math.round((out.totals.directShare + out.totals.subAgentShare) * 100) / 100, expected)
    assert.equal(out.totals.directPlayersCount, 3)
    assert.equal(out.totals.subAgentsCount, 2)
  })
})

describe('scopedPlayersQuery', () => {
  it('uses the SHARE base attribution: COALESCE(own agent, confirmed referrer’s agent) within the subtree', () => {
    const { sql, params } = scopedPlayersQuery([A, C1, G1], 't1').toSQL()
    assert.match(sql, /coalesce\("users"\."agent_id", "ggr_referrer"\."agent_id"\)/i)
    assert.match(sql, /left join "referral_attributions"/i)
    assert.match(sql, /"referral_attributions"\."status" = \$/i)
    assert.ok(params.includes('confirmed'), 'confirmed attributions only')
    assert.ok(params.includes(A) && params.includes(G1), 'the whole subtree')
  })
})
