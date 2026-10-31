/**
 * SHARING settlement engine (W9, agent-schemes hardening).
 *
 * One engine computes every pending figure and performs the settlement, so the
 * amount shown is the amount posted. These tests drive it against an in-memory
 * world — bets with timestamps behind a fake GGR reader, rate rows, a ledger, the
 * settlement records, wallets and a clock — so nothing touches the database.
 *
 * Covered: multi-period settling (2nd and 3rd settlements see only new activity,
 * a mid-day settlement's later bets land in the next window), pending == posted
 * for the same window, the direction sign, partial settlements extending the
 * window without overlapping SHARE lines, mid-period rate proration, the parent
 * funding its sub-agent, the admin dashboard total, and the settlement lock.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/sharingSettlementEngine.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SharingSettlementEngine,
  containedShareLines,
  planSettlementAmount,
  planWindowShare,
  rateSegments,
  round2,
  settledInWindow,
  settlementWalletMoves,
  sharingDirection,
  summarizeSharingPending,
  type ShareDomain,
  type SharingLedgerLine,
  type SharingSettlementWriter,
} from '../SharingSettlementEngine.js'
import { nextSharingWindow } from '../SettlementPeriodUtils.js'
import type { RateRow } from '../agentMutationRules.js'

const at = (iso: string) => new Date(iso)
const TZ = 'Asia/Kolkata'
// IST day boundaries expressed in UTC: 2026-10-01 00:00 IST = 2026-09-30T18:30Z.
const DAY1 = at('2026-09-30T18:30:00.000Z')
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // root SHARING agent
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // its sub-agent

type Bet = { agentId: string; domain: ShareDomain; at: Date; ggr: number }
type Line = SharingLedgerLine & { agentId: string; createdAt: Date; meta?: any; refKey?: string | null }

/** An in-memory world the engine reads and writes. */
function world(opts: { rates?: Record<string, Partial<Record<ShareDomain, RateRow[]>>>; parentOf?: Record<string, string | null> } = {}) {
  const bets: Bet[] = []
  const lines: Line[] = []
  const settlements: Array<{ id: string; agentId: string; periodFrom: Date; periodTo: Date; totalAmount: number; settledByAgentId: string | null }> = []
  const wallets = new Map<string, number>()
  const events: string[] = []
  let clock = DAY1
  const parentOf = opts.parentOf ?? { [P]: null, [C]: P }
  const rates = opts.rates ?? {
    [P]: { sports: [{ effectiveFrom: DAY1, effectiveTo: null, rate: 0.2 }] },
    [C]: { sports: [{ effectiveFrom: DAY1, effectiveTo: null, rate: 0.1 }] },
  }
  // 'downline' scope: an agent's GGR is its own players' plus every descendant's.
  const inSubtree = (root: string, agentId: string): boolean => {
    let cur: string | null | undefined = agentId
    while (cur) {
      if (cur === root) return true
      cur = parentOf[cur]
    }
    return false
  }
  const ggr = (domain: ShareDomain) => async (p: { agentId: string; from: Date; to: Date; scope: 'direct' | 'downline' }) => {
    events.push(`ggr:${domain}`)
    let total = 0
    for (const b of bets) {
      if (b.domain !== domain) continue
      if (!(b.at.getTime() >= p.from.getTime() && b.at.getTime() < p.to.getTime())) continue
      if (p.scope === 'downline' ? inSubtree(p.agentId, b.agentId) : b.agentId === p.agentId) total += b.ggr
    }
    return { ggr: total }
  }
  const engine = new SharingSettlementEngine({
    readers: { getSportsGGR: ggr('sports'), getCasinoGGR: ggr('casino'), getMatkaGGR: ggr('matka') },
    rateRows: async (agentId, domain) => rates[agentId]?.[domain] ?? [],
    ledgerLines: async (agentId, from, to) => {
      events.push('ledger')
      return lines.filter(
        (l) => l.agentId === agentId && new Date(l.periodFrom).getTime() < to.getTime() && new Date(l.periodTo).getTime() > from.getTime()
      )
    },
    lastPostedSettlement: async (agentId) => {
      const own = settlements.filter((s) => s.agentId === agentId).sort((a, b) => b.periodTo.getTime() - a.periodTo.getTime())
      return own[0] ? { periodFrom: own[0].periodFrom, periodTo: own[0].periodTo } : null
    },
    timezone: async () => TZ,
    now: () => clock,
  })
  let seq = 0
  const writer: SharingSettlementWriter = {
    async lockAgent(agentId) {
      events.push(`lock:${agentId}`)
    },
    async addLedgerLine(l) {
      lines.push({ ...l, createdAt: new Date(clock.getTime() + ++seq) })
    },
    async openAndPostSettlement(p) {
      const id = `s${++seq}`
      settlements.push({ id, agentId: p.agentId, periodFrom: p.periodFrom, periodTo: p.periodTo, totalAmount: p.totalAmount, settledByAgentId: p.settledByAgentId })
      return { id }
    },
    async creditWallet(agentId, _currency, amount) {
      wallets.set(agentId, round2((wallets.get(agentId) ?? 0) + amount))
    },
    async recordTransaction(p) {
      return { ...p, id: `t${++seq}`, createdAt: clock }
    },
  }
  const agent = (id: string) => ({ id, tenantId: 't1', createdAt: at('2026-10-01T03:00:00.000Z'), allowedDomains: ['sports'], parentAgentId: parentOf[id] ?? null })
  return {
    bets,
    lines,
    settlements,
    wallets,
    events,
    engine,
    agent,
    setNow: (d: Date) => {
      clock = d
    },
    bet: (agentId: string, iso: string, g: number, domain: ShareDomain = 'sports') => bets.push({ agentId, domain, at: at(iso), ggr: g }),
    settle: (agentId: string, extra: { requestedAmount?: number; requestedPeriodTo?: Date | null; settledByAgentId?: string | null } = {}) =>
      engine.settle({
        agent: agent(agentId),
        writer,
        currency: 'INR',
        tenant: 't1',
        notes: 'w9 test',
        requestedAmount: extra.requestedAmount ?? 0,
        requestedPeriodTo: extra.requestedPeriodTo ?? null,
        settledByAgentId: extra.settledByAgentId ?? null,
        settledByUuid: null,
      }),
    shareLines: (agentId: string) => lines.filter((l) => l.agentId === agentId && l.lineType === 'SHARE'),
  }
}

const sum = (xs: Array<{ amount: number | string }>) => round2(xs.reduce((s, x) => s + Number(x.amount), 0))

/** No two SHARE lines of an agent and domain overlap (they tile time). */
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

describe('direction sign', () => {
  it('positive = TO_AGENT (players lost), negative = FROM_AGENT, ~0 = NONE', () => {
    assert.equal(sharingDirection(200), 'TO_AGENT')
    assert.equal(sharingDirection(-60), 'FROM_AGENT')
    assert.equal(sharingDirection(0.004), 'NONE')
  })

  it('a settlement follows the sign of what is owed, never the caller; a request above it is refused', () => {
    assert.deepEqual(planSettlementAmount(200, 0), { ok: true, amount: 200, direction: 'TO_AGENT' })
    assert.deepEqual(planSettlementAmount(-60, 0), { ok: true, amount: -60, direction: 'FROM_AGENT' })
    assert.deepEqual(planSettlementAmount(-60, 25), { ok: true, amount: -25, direction: 'FROM_AGENT' })
    const over = planSettlementAmount(200, 200.01)
    assert.equal(over.ok, false)
    assert.equal(planSettlementAmount(0.001, 0).ok, false)
  })

  it('players lose → pending is positive, TO_AGENT, and the posted SHARE and SETTLEMENT lines are positive', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000) // players lost 1000
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.remaining, 200)
    assert.equal(pending.direction, 'TO_AGENT')
    const out = await w.settle(P)
    assert.ok(out.ok)
    if (!out.ok) return
    assert.equal(out.direction, 'TO_AGENT')
    assert.equal(out.transaction.direction, 'TO_AGENT')
    assert.equal(sum(w.shareLines(P)), 200)
    assert.equal(sum(w.lines.filter((l) => l.lineType === 'SETTLEMENT')), 200)
    assert.equal(w.wallets.get(P), 200, 'the agent is paid its share')
  })

  it('players win → FROM_AGENT, the agent wallet is debited', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', -500) // players won 500
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.remaining, -100)
    assert.equal(pending.direction, 'FROM_AGENT')
    const out = await w.settle(P)
    assert.ok(out.ok && out.direction === 'FROM_AGENT')
    assert.equal(w.wallets.get(P), -100)
  })
})

describe('multi-period settlement', () => {
  it('2nd and 3rd settlements compute only new activity; a mid-day settlement leaves later bets for the next window', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000) // day 1, 10:00 IST
    w.setNow(at('2026-10-01T08:30:00.000Z')) // day 1, 14:00 IST
    const first = await w.settle(P)
    assert.ok(first.ok)
    if (!first.ok) return
    assert.equal(first.amount, 200)
    assert.equal(first.periodFrom.getTime(), DAY1.getTime(), 'first window starts at the creation day (IST)')
    assert.equal(first.periodTo.getTime(), at('2026-10-01T08:30:00.000Z').getTime(), 'and ends at the settlement instant, not end of day')

    w.bet(P, '2026-10-01T10:30:00.000Z', 500) // day 1, 16:00 IST — after the mid-day settlement
    w.setNow(at('2026-10-02T04:30:00.000Z')) // day 2
    const pending2 = await w.engine.pending(w.agent(P))
    assert.equal(pending2.periodFrom.getTime(), first.periodTo.getTime(), 'next window starts exactly where the last one ended')
    assert.equal(pending2.remaining, 100, 'only the 16:00 bets (500 x 20%)')
    const second = await w.settle(P)
    assert.ok(second.ok && second.amount === 100, `second settlement: ${JSON.stringify(second)}`)

    w.bet(P, '2026-10-03T04:30:00.000Z', -300) // day 3, players won
    w.setNow(at('2026-10-03T06:30:00.000Z'))
    const third = await w.settle(P)
    assert.ok(third.ok && third.amount === -60 && third.direction === 'FROM_AGENT', `third settlement: ${JSON.stringify(third)}`)

    w.setNow(at('2026-10-04T06:30:00.000Z'))
    const after = await w.engine.pending(w.agent(P))
    assert.equal(after.remaining, 0, 'nothing left to settle')
    assert.equal(sum(w.shareLines(P)), 240, 'all-time SHARE = 200 + 100 − 60')
    assert.equal(w.wallets.get(P), 240, 'paid exactly the all-time share')
    assertTiled(w.shareLines(P))
  })

  it('nextSharingWindow: no settlement → creation day; settled → its end; still owed → its start again', () => {
    const now = at('2026-10-05T00:00:00.000Z')
    const created = at('2026-10-01T03:00:00.000Z')
    assert.equal(nextSharingWindow({ last: null, agentCreatedAt: created, whitelabelTimezone: TZ, now }).periodFrom.getTime(), DAY1.getTime())
    const last = { periodFrom: DAY1, periodTo: at('2026-10-02T08:30:00.000Z') }
    const settled = nextSharingWindow({ last, agentCreatedAt: created, whitelabelTimezone: TZ, now, lastWindowRemaining: 0 })
    assert.equal(settled.periodFrom.getTime(), last.periodTo.getTime())
    assert.equal(settled.periodTo.getTime(), now.getTime())
    const partial = nextSharingWindow({ last, agentCreatedAt: created, whitelabelTimezone: TZ, now, lastWindowRemaining: -150 })
    assert.equal(partial.periodFrom.getTime(), DAY1.getTime())
    assert.equal(partial.extendsPartial, true)
  })
})

describe('pending == posted', () => {
  it('settling the window the pending row showed posts exactly the pending amount, even with later bets', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1234.567)
    w.bet(P, '2026-10-01T05:30:00.000Z', -200.01)
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    // A bet arrives between showing the figure and pressing Settle.
    w.bet(P, '2026-10-01T09:00:00.000Z', 5000)
    w.setNow(at('2026-10-01T09:30:00.000Z'))
    const out = await w.settle(P, { requestedAmount: Math.abs(pending.remaining), requestedPeriodTo: pending.periodTo })
    assert.ok(out.ok, JSON.stringify(out))
    if (!out.ok) return
    assert.equal(out.amount, pending.remaining, 'amount posted = pending shown')
    assert.equal(sum(w.shareLines(P)), pending.shareTotal, 'SHARE posted = share shown')
    assert.equal(out.remainingAfter, 0, 'no residue left for the window')
    const next = await w.engine.pending(w.agent(P))
    assert.equal(next.periodFrom.getTime(), pending.periodTo.getTime(), 'the later bet is in the next window')
    assert.equal(next.remaining, 1000)
  })

  it('a window end in the future is clamped to now; one before what is already settled is refused', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000)
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const partial = await w.settle(P, { requestedAmount: 50 })
    assert.ok(partial.ok)
    w.setNow(at('2026-10-01T10:30:00.000Z'))
    const tooShort = await w.settle(P, { requestedPeriodTo: at('2026-10-01T06:00:00.000Z') })
    assert.equal(tooShort.ok, false)
    const future = await w.settle(P, { requestedPeriodTo: at('2027-01-01T00:00:00.000Z') })
    assert.ok(future.ok && future.periodTo.getTime() === at('2026-10-01T10:30:00.000Z').getTime())
  })
})

describe('partial settlements', () => {
  it('extend the window, top up only the difference, and never overlap SHARE lines', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000) // share 200
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const first = await w.settle(P, { requestedAmount: 50 })
    assert.ok(first.ok && first.remainingAfter === 150)

    w.bet(P, '2026-10-01T12:30:00.000Z', 500) // share +100
    w.setNow(at('2026-10-02T04:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.periodFrom.getTime(), DAY1.getTime(), 'window not advanced while something is owed')
    assert.equal(pending.extendsPartial, true)
    assert.equal(pending.shareTotal, 300)
    assert.equal(pending.remaining, 250, '300 − 50 already paid')
    assert.equal((await w.settle(P, { requestedAmount: 251 })).ok, false, 'cannot exceed what is owed')
    const second = await w.settle(P)
    assert.ok(second.ok && second.amount === 250)

    assert.equal(sum(w.shareLines(P)), 300, 'all-time SHARE is the window share once, not 200 + 300')
    assertTiled(w.shareLines(P))
    assert.equal(w.wallets.get(P), 300)
    // Fully settled now: the next window starts at the second settlement's end.
    w.setNow(at('2026-10-03T04:30:00.000Z'))
    const next = await w.engine.pending(w.agent(P))
    assert.equal(next.periodFrom.getTime(), at('2026-10-02T04:30:00.000Z').getTime())
  })

  it('a sign flip in an extended window turns an over-payment into a collection', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000) // +200
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    assert.ok((await w.settle(P, { requestedAmount: 100 })).ok) // paid 100
    w.bet(P, '2026-10-01T12:30:00.000Z', -1250) // players win back: window share −50
    w.setNow(at('2026-10-02T04:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.shareTotal, -50)
    assert.equal(pending.remaining, -150, 'agent was paid 100 and owes 50: collect 150')
    assert.equal(pending.direction, 'FROM_AGENT')
  })

  it('pure helpers: contained lines, settled sum, top-up plan', () => {
    const F = DAY1
    const T1 = at('2026-10-01T08:30:00.000Z')
    const T2 = at('2026-10-02T08:30:00.000Z')
    const lines: SharingLedgerLine[] = [
      { lineType: 'SHARE', domain: 'sports', periodFrom: F, periodTo: T1, amount: 200, createdAt: T1 },
      { lineType: 'SHARE', domain: 'sports', periodFrom: at('2026-09-29T18:30:00.000Z'), periodTo: F, amount: 999, createdAt: F }, // previous window
      { lineType: 'SETTLEMENT', domain: 'sports', periodFrom: F, periodTo: T1, amount: 50, createdAt: T1 },
      { lineType: 'SETTLEMENT', domain: 'sports', periodFrom: at('2026-09-29T18:30:00.000Z'), periodTo: F, amount: 999, createdAt: F },
    ]
    assert.deepEqual(containedShareLines(lines, F, T2).map((l) => l.amount), [200])
    assert.equal(settledInWindow(lines, F, T2), 50, 'the previous window only touches F')
    const plan = planWindowShare({ lines, from: F, to: T2, fresh: { sports: 300, casino: 0, matka: 0 } })
    assert.equal(plan.coverEnd.getTime(), T1.getTime())
    assert.deepEqual(plan.newLines.map((l) => [l.domain, l.periodFrom.getTime(), l.periodTo.getTime(), l.amount]), [['sports', T1.getTime(), T2.getTime(), 100]])
    assert.equal(plan.shareTotal, 300)
    const retry = planWindowShare({ lines, from: F, to: T1, fresh: { sports: 999, casino: 0, matka: 0 } })
    assert.equal(retry.newLines.length, 0, 'an already covered window reuses its lines')
    assert.equal(retry.shareTotal, 200)
  })
})

describe('mid-period rate change', () => {
  it('rateSegments splits the window at the change; bets are charged at the rate in force when placed', async () => {
    const change = at('2026-10-01T06:30:00.000Z') // 12:00 IST
    const rows: RateRow[] = [
      { effectiveFrom: DAY1, effectiveTo: null, rate: 0.2 },
      { effectiveFrom: change, effectiveTo: null, rate: 0.1 },
    ]
    const segs = rateSegments(rows, DAY1, at('2026-10-02T00:00:00.000Z'))
    assert.deepEqual(segs.map((s) => [s.from.getTime(), s.to.getTime(), s.rate]), [
      [DAY1.getTime(), change.getTime(), 0.2],
      [change.getTime(), at('2026-10-02T00:00:00.000Z').getTime(), 0.1],
    ])

    const w = world({ rates: { [P]: { sports: rows } } })
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000) // 10:00 IST at 20%
    w.bet(P, '2026-10-01T08:30:00.000Z', 1000) // 14:00 IST at 10%
    w.setNow(at('2026-10-01T12:30:00.000Z'))
    const pending = await w.engine.pending(w.agent(P))
    assert.equal(pending.shareTotal, 300, '200 + 100, not 2000 x 20% (rate at the window start)')
    const out = await w.settle(P)
    assert.ok(out.ok && out.amount === 300)
  })

  it('no rate row → no share for that stretch', () => {
    const segs = rateSegments([{ effectiveFrom: at('2026-10-01T06:30:00.000Z'), effectiveTo: null, rate: 0.3 }], DAY1, at('2026-10-02T00:00:00.000Z'))
    assert.equal(segs[0].rate, 0)
    assert.equal(segs[1].rate, 0.3)
  })
})

describe('sub-agent settlement is funded by its parent', () => {
  it('the child is paid from the parent wallet; the parent books an ADJUSTMENT, its own pending is unchanged', () => {
    assert.deepEqual(settlementWalletMoves({ agentId: C, parentAgentId: P, amount: 100 }), [
      { agentId: C, amount: 100, role: 'agent' },
      { agentId: P, amount: -100, role: 'parent' },
    ])
    assert.deepEqual(settlementWalletMoves({ agentId: P, parentAgentId: null, amount: 100 }), [{ agentId: P, amount: 100, role: 'agent' }])
  })

  it('end to end: platform pays the root its cumulative share, the root pays the child its part', async () => {
    const w = world()
    w.bet(C, '2026-10-01T04:30:00.000Z', 1000) // the child's player loses 1000
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    const parentBefore = await w.engine.pending(w.agent(P))
    assert.equal(parentBefore.remaining, 200, 'the root takes 20% of its whole subtree')

    const child = await w.settle(C, { settledByAgentId: P })
    assert.ok(child.ok && child.amount === 100)
    assert.equal(w.wallets.get(C), 100)
    assert.equal(w.wallets.get(P), -100, 'the parent funds its child')
    const adj = w.lines.filter((l) => l.agentId === P && l.lineType === 'ADJUSTMENT')
    assert.equal(adj.length, 1)
    assert.equal(Number(adj[0].amount), -100)

    const parentAfter = await w.engine.pending(w.agent(P))
    assert.equal(parentAfter.remaining, 200, "the child's settlement is not the parent's settlement")
    const root = await w.settle(P)
    assert.ok(root.ok && root.amount === 200)
    assert.equal(w.wallets.get(P), 100, 'root nets (20% − 10%) x 1000')
  })
})

describe('admin dashboard SHARING total', () => {
  const rows = [
    { agentId: 'A', parentAgentId: null, remaining: 500 },
    { agentId: 'B', parentAgentId: null, remaining: -200 },
    { agentId: 'C', parentAgentId: 'A', remaining: 1000 }, // settled by A, not the admin
    { agentId: 'D', parentAgentId: null, remaining: 0.001 },
  ]
  it('admin: root agents only, pay and collect netted and reported separately', () => {
    assert.deepEqual(summarizeSharingPending(rows), { net: 300, toAgents: 500, fromAgents: 200, count: 2 })
  })
  it('agent caller: its direct children only', () => {
    assert.deepEqual(summarizeSharingPending(rows, { settlerAgentId: 'A' }), { net: 1000, toAgents: 1000, fromAgents: 0, count: 1 })
  })
})

describe('settlement lock', () => {
  it('takes the per-agent lock before reading anything', async () => {
    const w = world()
    w.bet(P, '2026-10-01T04:30:00.000Z', 1000)
    w.setNow(at('2026-10-01T08:30:00.000Z'))
    w.events.length = 0
    const out = await w.settle(P)
    assert.ok(out.ok)
    assert.equal(w.events[0], `lock:${P}`)
  })
})
