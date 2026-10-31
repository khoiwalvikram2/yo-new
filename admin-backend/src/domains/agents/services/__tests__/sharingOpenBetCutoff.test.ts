/**
 * SHARING open-bet gap (W10, agent-schemes hardening).
 *
 * GGR is read by bet CREATION time and only for SETTLED bets. Before this fix a
 * SHARING window ran to "now" even when a bet placed inside it was still open:
 * the bet was not in the window's share (not settled), and the next window
 * started after its creation time, so once it settled it was never shared.
 *
 * The open window now ends at the creation of the earliest still-open bet of the
 * agent's SHARE base (capWindowAtOpenBet). These tests drive the engine against
 * an in-memory world (bets with timestamps and an open flag, rate rows, a
 * ledger, settlements, wallets and a clock), as W9's engine tests do:
 *   - an open bet in the window → the window ends right before it;
 *   - once it settles it is counted in the next window, exactly once;
 *   - SHARE lines still tile time and the all-time share is exact;
 *   - an extended (partially settled) window never ends before what it already settled;
 *   - a requested periodTo past the open bet is clamped to it;
 *   - a sub-agent's open bet holds its parent's window too (downline scope).
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/sharingOpenBetCutoff.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SharingSettlementEngine,
  capWindowAtOpenBet,
  round2,
  type ShareDomain,
  type SharingLedgerLine,
  type SharingSettlementWriter,
} from '../SharingSettlementEngine.js'
import type { RateRow } from '../agentMutationRules.js'

const at = (iso: string) => new Date(iso)
const TZ = 'Asia/Kolkata'
// 2026-10-01 00:00 IST = 2026-09-30T18:30Z (the agents' creation day).
const DAY1 = at('2026-09-30T18:30:00.000Z')
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // root SHARING agent, 20%
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // its sub-agent, 10%

type Bet = { id: number; agentId: string; domain: ShareDomain; at: Date; ggr: number; open: boolean }
type Line = SharingLedgerLine & { agentId: string; createdAt: Date }

function world(opts: { withOpenBetDep?: boolean } = {}) {
  const bets: Bet[] = []
  const lines: Line[] = []
  const settlements: Array<{ id: string; agentId: string; periodFrom: Date; periodTo: Date; totalAmount: number }> = []
  const wallets = new Map<string, number>()
  const openBetCalls: Array<{ agentId: string; from: Date; to: Date }> = []
  let clock = DAY1
  const parentOf: Record<string, string | null> = { [P]: null, [C]: P }
  const rates: Record<string, Partial<Record<ShareDomain, RateRow[]>>> = {
    [P]: { sports: [{ effectiveFrom: DAY1, effectiveTo: null, rate: 0.2 }], casino: [{ effectiveFrom: DAY1, effectiveTo: null, rate: 0.2 }] },
    [C]: { sports: [{ effectiveFrom: DAY1, effectiveTo: null, rate: 0.1 }], casino: [{ effectiveFrom: DAY1, effectiveTo: null, rate: 0.1 }] },
  }
  const inSubtree = (root: string, agentId: string): boolean => {
    let cur: string | null | undefined = agentId
    while (cur) {
      if (cur === root) return true
      cur = parentOf[cur]
    }
    return false
  }
  const inWindow = (b: Bet, from: Date, to: Date) => b.at.getTime() >= from.getTime() && b.at.getTime() < to.getTime()
  // Settled bets only, by creation time — what LiveGGRReader counts.
  const ggr = (domain: ShareDomain) => async (p: { agentId: string; from: Date; to: Date; scope: 'direct' | 'downline' }) => {
    let total = 0
    for (const b of bets) {
      if (b.open || b.domain !== domain || !inWindow(b, p.from, p.to)) continue
      if (p.scope === 'downline' ? inSubtree(p.agentId, b.agentId) : b.agentId === p.agentId) total += b.ggr
    }
    return { ggr: total }
  }
  const engine = new SharingSettlementEngine({
    readers: { getSportsGGR: ggr('sports'), getCasinoGGR: ggr('casino'), getMatkaGGR: ggr('matka') },
    rateRows: async (agentId, domain) => rates[agentId]?.[domain] ?? [],
    ledgerLines: async (agentId, from, to) =>
      lines.filter((l) => l.agentId === agentId && new Date(l.periodFrom).getTime() < to.getTime() && new Date(l.periodTo).getTime() > from.getTime()),
    lastPostedSettlement: async (agentId) => {
      const own = settlements.filter((s) => s.agentId === agentId).sort((a, b) => b.periodTo.getTime() - a.periodTo.getTime())
      return own[0] ? { periodFrom: own[0].periodFrom, periodTo: own[0].periodTo } : null
    },
    timezone: async () => TZ,
    now: () => clock,
    // Earliest open bet of the agent's downline players placed in [from, to) — LiveGGRReader.earliestOpenBetForAgent.
    ...(opts.withOpenBetDep === false
      ? {}
      : {
          earliestOpenBetAt: async (agent: { id: string }, from: Date, to: Date) => {
            openBetCalls.push({ agentId: agent.id, from, to })
            let earliest: number | null = null
            for (const b of bets) {
              if (!b.open || !inWindow(b, from, to) || !inSubtree(agent.id, b.agentId)) continue
              if (earliest == null || b.at.getTime() < earliest) earliest = b.at.getTime()
            }
            return earliest == null ? null : new Date(earliest)
          },
        }),
  })
  let seq = 0
  const writer: SharingSettlementWriter = {
    async lockAgent() {},
    async addLedgerLine(l) {
      lines.push({ ...l, createdAt: new Date(clock.getTime() + ++seq) })
    },
    async openAndPostSettlement(p) {
      const id = `s${++seq}`
      settlements.push({ id, agentId: p.agentId, periodFrom: p.periodFrom, periodTo: p.periodTo, totalAmount: p.totalAmount })
      return { id }
    },
    async creditWallet(agentId, _currency, amount) {
      wallets.set(agentId, round2((wallets.get(agentId) ?? 0) + amount))
    },
    async recordTransaction(p) {
      return { ...p, id: `t${++seq}` }
    },
  }
  const agent = (id: string) => ({ id, tenantId: 't1', createdAt: at('2026-10-01T03:00:00.000Z'), allowedDomains: ['sports', 'casino'], parentAgentId: parentOf[id] ?? null })
  let betSeq = 0
  return {
    bets,
    lines,
    wallets,
    openBetCalls,
    engine,
    agent,
    setNow: (d: Date) => {
      clock = d
    },
    bet: (agentId: string, iso: string, g: number, extra: { open?: boolean; domain?: ShareDomain } = {}) => {
      const b: Bet = { id: ++betSeq, agentId, domain: extra.domain ?? 'sports', at: at(iso), ggr: g, open: extra.open ?? false }
      bets.push(b)
      return b
    },
    settleBet: (b: Bet) => {
      b.open = false
    },
    settle: (agentId: string, extra: { requestedAmount?: number; requestedPeriodTo?: Date | null; settledByAgentId?: string | null } = {}) =>
      engine.settle({
        agent: agent(agentId),
        writer,
        currency: 'INR',
        tenant: 't1',
        notes: 'w10 test',
        requestedAmount: extra.requestedAmount ?? 0,
        requestedPeriodTo: extra.requestedPeriodTo ?? null,
        settledByAgentId: extra.settledByAgentId ?? null,
        settledByUuid: null,
      }),
    shareLines: (agentId: string) => lines.filter((l) => l.agentId === agentId && l.lineType === 'SHARE'),
  }
}

const sum = (xs: Array<{ amount: number | string }>) => round2(xs.reduce((s, x) => s + Number(x.amount), 0))

function assertTiled(lines: Line[]) {
  const byDomain = new Map<string, Line[]>()
  for (const l of lines) byDomain.set(String(l.domain), [...(byDomain.get(String(l.domain)) ?? []), l])
  for (const [domain, ls] of byDomain) {
    const sorted = [...ls].sort((a, b) => new Date(a.periodFrom).getTime() - new Date(b.periodFrom).getTime())
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        new Date(sorted[i].periodFrom).getTime() >= new Date(sorted[i - 1].periodTo).getTime(),
        `SHARE lines overlap for ${domain}: ${JSON.stringify([sorted[i - 1], sorted[i]])}`
      )
    }
  }
}

describe('capWindowAtOpenBet (pure)', () => {
  const floor = at('2026-10-01T02:00:00.000Z')
  const to = at('2026-10-01T10:00:00.000Z')
  it('no open bet, or one at/after the window end → the window is unchanged', () => {
    assert.deepEqual(capWindowAtOpenBet({ floor, periodTo: to, earliestOpenBetAt: null }), { periodTo: to, openBetCutoff: null })
    assert.deepEqual(capWindowAtOpenBet({ floor, periodTo: to, earliestOpenBetAt: to }), { periodTo: to, openBetCutoff: null })
    assert.deepEqual(capWindowAtOpenBet({ floor, periodTo: to, earliestOpenBetAt: at('2026-10-01T11:00:00.000Z') }), { periodTo: to, openBetCutoff: null })
    assert.deepEqual(capWindowAtOpenBet({ floor, periodTo: to, earliestOpenBetAt: new Date(NaN) }), { periodTo: to, openBetCutoff: null })
  })
  it('an open bet inside the window ends the window at its creation time', () => {
    const open = at('2026-10-01T05:00:00.000Z')
    assert.deepEqual(capWindowAtOpenBet({ floor, periodTo: to, earliestOpenBetAt: open }), { periodTo: open, openBetCutoff: open })
  })
  it('never before the floor (what is already settled stays inside the window)', () => {
    const open = at('2026-10-01T01:00:00.000Z')
    assert.deepEqual(capWindowAtOpenBet({ floor, periodTo: to, earliestOpenBetAt: open }), { periodTo: floor, openBetCutoff: open })
  })
})

describe('SHARING window ends before the earliest open bet', () => {
  it('open bet in the window → the window ends right before it; after it settles it is counted in the next window, once', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000) // 10:00 IST, settled: players lost 1000
    const open = w.bet(P, '2026-10-01T05:30:00.000Z', 500, { open: true }) // 11:00 IST, still open (will lose 500)
    w.bet(P, '2026-10-01T06:30:00.000Z', 200) // 12:00 IST, settled, after the open bet
    w.setNow(at('2026-10-01T08:30:00.000Z')) // 14:00 IST

    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.periodFrom.getTime(), DAY1.getTime())
    assert.equal(pending.periodTo.getTime(), open.at.getTime(), 'the window stops at the open bet, not at now')
    assert.equal(pending.openBetCutoff?.getTime(), open.at.getTime())
    assert.equal(pending.remaining, 200, 'only the 10:00 bet (1000 x 20%); the 12:00 bet waits behind the open one')

    const first = await w.settle(P, { requestedPeriodTo: pending.periodTo })
    assert.ok(first.ok, JSON.stringify(first))
    if (!first.ok) return
    assert.equal(first.amount, 200, 'pending == posted')
    assert.equal(first.periodTo.getTime(), open.at.getTime())

    // Still open: the next window is empty, nothing to settle and nothing skipped.
    w.setNow(at('2026-10-01T10:30:00.000Z'))
    const held = await w.engine.pending(w.agent(P))
    assert.equal(held.periodFrom.getTime(), open.at.getTime())
    assert.equal(held.periodTo.getTime(), open.at.getTime(), 'empty window while the bet is open')
    assert.equal(held.remaining, 0)
    assert.equal((await w.settle(P)).ok, false, 'an empty window cannot be settled')

    // The bet settles: the next window starts where the last ended and includes it.
    w.settleBet(open)
    w.setNow(at('2026-10-02T04:30:00.000Z'))
    const next = await w.engine.pending(w.agent(P))
    assert.equal(next.periodFrom.getTime(), open.at.getTime(), 'no gap: the next window starts at the held bet')
    assert.equal(next.periodTo.getTime(), at('2026-10-02T04:30:00.000Z').getTime(), 'nothing open any more: the window runs to now')
    assert.equal(next.openBetCutoff, null)
    assert.equal(next.remaining, 140, 'the formerly open bet (500) and the 12:00 bet (200), x 20%')
    const second = await w.settle(P)
    assert.ok(second.ok && second.amount === 140, JSON.stringify(second))

    assert.equal(sum(w.shareLines(P)), 340, 'all-time SHARE = 20% x 1700: every bet shared exactly once')
    assert.equal(w.wallets.get(P), 340)
    assertTiled(w.shareLines(P))
  })

  it('without the open-bet dependency the window still runs to now (the old behaviour, W9 tests unchanged)', async () => {
    const w = world({ withOpenBetDep: false })
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000)
    w.bet(P, '2026-10-01T05:30:00.000Z', 500, { open: true })
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.periodTo.getTime(), at('2026-10-01T08:30:00.000Z').getTime())
    assert.equal(pending.openBetCutoff, null)
  })

  it('an open casino bet holds the window as well (all share domains)', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000)
    const open = w.bet(P, '2026-10-01T05:00:00.000Z', 100, { open: true, domain: 'casino' })
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.periodTo.getTime(), open.at.getTime())
  })

  it('a requested periodTo past the open bet is clamped to it', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000)
    const open = w.bet(P, '2026-10-01T05:30:00.000Z', 500, { open: true })
    w.bet(P, '2026-10-01T06:30:00.000Z', 200)
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const out = await w.settle(P, { requestedPeriodTo: at('2026-10-01T08:00:00.000Z') })
    assert.ok(out.ok, JSON.stringify(out))
    if (!out.ok) return
    assert.equal(out.periodTo.getTime(), open.at.getTime())
    assert.equal(out.amount, 200, 'the 12:00 bet is not settled past the open one')
  })

  it('an extended (partially settled) window never ends before what it already settled', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000) // share 200
    w.setNow(at('2026-10-01T06:30:00.000Z')) // 12:00 IST
    const partial = await w.settle(P, { requestedAmount: 50 })
    assert.ok(partial.ok && partial.remainingAfter === 150)

    const open = w.bet(P, '2026-10-01T07:30:00.000Z', 300, { open: true }) // 13:00 IST, open
    w.bet(P, '2026-10-01T08:30:00.000Z', 500) // 14:00 IST, settled
    w.setNow(at('2026-10-01T09:30:00.000Z')) // 15:00 IST
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.extendsPartial, true)
    assert.equal(pending.periodFrom.getTime(), DAY1.getTime())
    assert.equal(pending.periodTo.getTime(), open.at.getTime(), 'extended to the open bet, not to now')
    assert.equal(pending.remaining, 150, 'the 14:00 bet waits behind the open one')
    const last = w.openBetCalls.at(-1)!
    assert.equal(last.from.getTime(), at('2026-10-01T06:30:00.000Z').getTime(), 'open bets are looked for after what is already settled')

    const rest = await w.settle(P)
    assert.ok(rest.ok && rest.amount === 150, JSON.stringify(rest))

    w.settleBet(open)
    w.setNow(at('2026-10-02T04:30:00.000Z'))
    const next = await w.engine.pending(w.agent(P))
    assert.equal(next.periodFrom.getTime(), open.at.getTime())
    assert.equal(next.remaining, 160, '(300 + 500) x 20%')
    assert.ok((await w.settle(P)).ok)
    assert.equal(sum(w.shareLines(P)), 360, '20% x (1000 + 300 + 500)')
    assert.equal(w.wallets.get(P), 360)
    assertTiled(w.shareLines(P))
  })

  it('an extended window whose open bet sits at the last settlement end stays that window (the remainder is still settleable)', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000) // share 200
    const open = w.bet(P, '2026-10-01T05:30:00.000Z', 300, { open: true })
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const partial = await w.settle(P, { requestedAmount: 50 }) // window [DAY1, open)
    assert.ok(partial.ok && partial.periodTo.getTime() === open.at.getTime())
    w.setNow(at('2026-10-01T10:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.periodTo.getTime(), open.at.getTime(), 'same window again')
    assert.equal(pending.remaining, 150)
    const rest = await w.settle(P)
    assert.ok(rest.ok && rest.amount === 150, JSON.stringify(rest))
    assert.equal(sum(w.shareLines(P)), 200, 'the window share is posted once')
  })

  it('a sub-agent\'s open bet holds its parent\'s window too (the parent shares its whole subtree)', async () => {
    const w = world()
    w.bet(C, '2026-10-01T04:30:00.000Z', 1000)
    const open = w.bet(C, '2026-10-01T05:30:00.000Z', 400, { open: true })
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const parent = await w.engine.pending(w.agent(P))
    const child = await w.engine.pending(w.agent(C))
    assert.equal(parent.periodTo.getTime(), open.at.getTime())
    assert.equal(child.periodTo.getTime(), open.at.getTime())
    assert.equal(parent.remaining, 200)
    assert.equal(child.remaining, 100)
  })

  it('an open bet placed before the window start (an old window) does not freeze the current one', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000)
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    assert.ok((await w.settle(P)).ok)
    // A bet created inside the settled window but recorded as open only later (legacy data).
    w.bet(P, '2026-10-01T05:00:00.000Z', 50, { open: true })
    w.bet(P, '2026-10-01T09:30:00.000Z', 500)
    w.setNow(at('2026-10-01T10:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.periodFrom.getTime(), at('2026-10-01T08:30:00.000Z').getTime())
    assert.equal(pending.periodTo.getTime(), at('2026-10-01T10:30:00.000Z').getTime())
    assert.equal(pending.remaining, 100)
  })
})
