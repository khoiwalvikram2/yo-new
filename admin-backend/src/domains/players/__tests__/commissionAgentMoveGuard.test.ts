/**
 * The commission guard on moving a COMMISSION player between agents.
 *
 * Commission is computed from the players an agent has now, so a move
 * re-attributes the player's past bets in every unpaid cycle. The guard used to
 * look only at the SOURCE agent: a player could move into a target whose closed
 * cycles were still unpaid, and the bets the source chain had already been paid
 * for were then paid again to the new chain. It now checks the target and its
 * upline too (and the source's upline), skipping agents above both.
 *
 * It also treated a zero-commission cycle as unsettled forever (a cycle is
 * SETTLED only when a payout above zero exists, and zero payouts are refused),
 * so one zero week blocked every later move. A zero cycle now counts as settled
 * unless the move itself could make it payable.
 *
 * All reads are injected; nothing here touches the database.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateCommissionAgentMoveGuard,
  type CommissionMoveGuardDeps,
  type PlayerCycleActivity,
} from '../services/commissionAgentMoveGuard.js'
import type { CommissionCycleInfo } from '@src/domains/agents/services/CommissionCycleService.js'

const TENANT = 'w2-test-tenant'
const PLAYER = 7

const W1 = { from: new Date('2026-09-28T18:30:00Z'), to: new Date('2026-10-05T18:30:00Z') }
const W2 = { from: new Date('2026-10-05T18:30:00Z'), to: new Date('2026-10-12T18:30:00Z') }
const NOW = { from: new Date('2026-10-19T18:30:00Z'), to: new Date('2026-10-26T18:30:00Z') }

const settled = (w: typeof W1): CommissionCycleInfo => ({ ...w, status: 'SETTLED' })
const unpaid = (w: typeof W1): CommissionCycleInfo => ({ ...w, status: 'CLOSED_UNSETTLED' })
const open = (w: typeof W1): CommissionCycleInfo => ({ ...w, status: 'OPEN' })

/**
 * Hierarchy used below:
 *
 *        ROOT
 *       /    \
 *     SP      TP
 *     |       |
 *    SRC     TGT
 */
const CHAINS: Record<string, string[]> = {
  ROOT: ['ROOT'],
  SP: ['SP', 'ROOT'],
  TP: ['TP', 'ROOT'],
  SRC: ['SRC', 'SP', 'ROOT'],
  TGT: ['TGT', 'TP', 'ROOT'],
}

function deps(opts: {
  cycles: Record<string, CommissionCycleInfo[]>
  activity?: (from: Date) => PlayerCycleActivity
  payable?: (agentId: string, from: Date) => boolean
  snapshot?: string
}): CommissionMoveGuardDeps & { payableCalls: string[] } {
  const payableCalls: string[] = []
  return {
    payableCalls,
    latestSnapshot: async () => (opts.snapshot ? { status: opts.snapshot, cycleFrom: null, cycleTo: null } : null),
    listCycles: async (agentId) => opts.cycles[agentId] ?? [],
    chainOf: async (agentId) => CHAINS[agentId] ?? [agentId],
    playerActivity: async (_t, _p, from) => (opts.activity ? opts.activity(from) : { settledCount: 3, ggr: 100 }),
    hasPayableCommission: async (agentId, _t, cycle) => {
      payableCalls.push(agentId)
      return opts.payable ? opts.payable(agentId, cycle.from) : true
    },
  }
}

describe('commission move guard: target side', () => {
  it('blocks when the TARGET agent has an unpaid closed cycle in which the player bet', async () => {
    const d = deps({ cycles: { SRC: [settled(W1)], TGT: [unpaid(W1)] } })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
    assert.match(r.blockers[0], /target agent\b/)
    assert.equal(r.commissionCycleStatus, 'CLOSED_UNSETTLED')
  })

  it("blocks when the target agent's UPLINE has an unpaid closed cycle in which the player bet", async () => {
    const d = deps({ cycles: { SRC: [settled(W1)], TGT: [settled(W1)], TP: [unpaid(W1)] } })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
    assert.match(r.blockers[0], /target agent's upline/)
  })

  it('ignores an agent above both source and target (the player stays in its downline)', async () => {
    const d = deps({ cycles: { SRC: [settled(W1)], TGT: [settled(W1)], ROOT: [unpaid(W1)] } })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.deepEqual(r.blockers, [])
  })

  it("also checks the source agent's upline, which loses the player's GGR", async () => {
    const d = deps({ cycles: { SRC: [settled(W1)], SP: [unpaid(W1)] } })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
    assert.match(r.blockers[0], /source agent's upline/)
  })

  it('does not block on target cycles in which the player did not bet', async () => {
    const d = deps({
      cycles: { SRC: [settled(W1), settled(W2)], TGT: [unpaid(W1), unpaid(W2)] },
      activity: () => ({ settledCount: 0, ggr: 0 }),
    })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.deepEqual(r.blockers, [])
    assert.equal(r.commissionCycleStatus, 'SETTLED')
  })

  it('without a target it behaves as before: source only', async () => {
    const d = deps({ cycles: { SRC: [unpaid(W1)], TGT: [unpaid(W1)] } })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, null, d)
    assert.equal(r.blockers.length, 1)
    assert.match(r.blockers[0], /Settle the agent's commission before moving/)
  })
})

describe('commission move guard: zero-commission cycles', () => {
  it('a zero source cycle counts as settled when the player lost (removing it cannot create commission)', async () => {
    const d = deps({ cycles: { SRC: [unpaid(W1)] }, activity: () => ({ settledCount: 2, ggr: 50 }), payable: () => false })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.deepEqual(r.blockers, [])
    assert.deepEqual(d.payableCalls, ['SRC'])
  })

  it('a source cycle with commission still payable keeps blocking', async () => {
    const d = deps({ cycles: { SRC: [unpaid(W1)] }, activity: () => ({ settledCount: 2, ggr: 50 }), payable: () => true })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
  })

  it('a zero source cycle still blocks when the player WON (removing a winner can lift the source above zero)', async () => {
    const d = deps({ cycles: { SRC: [unpaid(W1)] }, activity: () => ({ settledCount: 2, ggr: -80 }), payable: () => false })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
  })

  it('a zero target cycle counts as settled when the player won (adding it cannot create commission)', async () => {
    const d = deps({ cycles: { SRC: [settled(W1)], TGT: [unpaid(W1)] }, activity: () => ({ settledCount: 1, ggr: -20 }), payable: () => false })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.deepEqual(r.blockers, [])
  })

  it('a zero target cycle still blocks when the player LOST (its GGR would make the new chain payable)', async () => {
    const d = deps({ cycles: { SRC: [settled(W1)], TGT: [unpaid(W1)] }, activity: () => ({ settledCount: 1, ggr: 300 }), payable: () => false })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
    assert.match(r.blockers[0], /target agent\b/)
  })

  it('the open cycle still blocks when the player bet in it', async () => {
    const d = deps({ cycles: { SRC: [settled(W1), open(NOW)], TGT: [open(NOW)] }, payable: () => false })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
    assert.match(r.blockers[0], /current open commission cycle/)
  })

  it('a BLOCKED source snapshot still blocks unconditionally', async () => {
    const d = deps({ cycles: { SRC: [settled(W1)] }, snapshot: 'BLOCKED' })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
    assert.equal(r.commissionCycleStatus, 'BLOCKED')
  })
})

// CommissionCycleService now reports a zero-commission closed cycle as SETTLED with zeroCommission
// (no payout row). The guard must still treat it as open to change when the move could make it payable.
describe('commission move guard: zero cycles reported as SETTLED', () => {
  const zeroSettled = (w: typeof W1): CommissionCycleInfo => ({ ...w, status: 'SETTLED', zeroCommission: true })

  it('a zero source cycle blocks when the player WON (removing a winner lifts the source above zero)', async () => {
    const d = deps({ cycles: { SRC: [zeroSettled(W1)] }, activity: () => ({ settledCount: 2, ggr: -80 }) })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
  })

  it('a zero source cycle does not block when the player lost', async () => {
    const d = deps({ cycles: { SRC: [zeroSettled(W1)] }, activity: () => ({ settledCount: 2, ggr: 50 }) })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.deepEqual(r.blockers, [])
  })

  it('a zero target cycle blocks when the player LOST (its GGR would make the new chain payable)', async () => {
    const d = deps({ cycles: { SRC: [settled(W1)], TGT: [zeroSettled(W1)] }, activity: () => ({ settledCount: 1, ggr: 300 }) })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.equal(r.blockers.length, 1)
    assert.match(r.blockers[0], /target agent\b/)
  })

  it('a really paid cycle (SETTLED without zeroCommission) never blocks', async () => {
    const d = deps({ cycles: { SRC: [settled(W1)], TGT: [settled(W1)] }, activity: () => ({ settledCount: 1, ggr: 300 }) })
    const r = await evaluateCommissionAgentMoveGuard('SRC', TENANT, PLAYER, 'TGT', d)
    assert.deepEqual(r.blockers, [])
  })
})
