/**
 * Query.realtimeSnapshot against the real database.
 *
 * What is proven, each by an exact figure rather than "greater than zero":
 *   - a bet inside the 5-minute window counts and one outside it does not, and
 *     sliding the clock moves players in and out of the window;
 *   - a player who bet in two products is one active player (a UNION, not a sum
 *     of three per-table counts);
 *   - an open bet counts, a settled one does not, and an open bet placed through
 *     the bet tool is left out as the admin running views leave it out;
 *   - an approved deposit settled inside the hour counts, one settled outside it
 *     does not, a pending or rejected one does not, and "settled at" falls back
 *     to created_at when there is no review time;
 *   - agent scoping: an agent sees its own players at any depth and by both
 *     routes (direct users.agent_id and referral), and never another agent's;
 *     an agent with no players sees zeros;
 *   - tenant isolation between two throwaway tenants.
 *
 * Money amounts are distinct powers of two, so any wrongly included row shows
 * up as a figure no correct query could produce.
 *
 * Writes only inside two throwaway tenants of its own and removes everything
 * it wrote, before the run (leftovers of a crashed run) and after it. It
 * creates no `whitelabels` row: nothing here needs one, and without it no
 * scheduler that walks the whitelabel list can pick the tenants up.
 *
 * The sports and casino catalogues are global (no tenant column), so the test
 * does not create catalogue rows. It borrows — reads, never modifies — one
 * existing sports runner chain and one casino game as foreign-key targets for
 * its own bets, preferring inactive ones.
 *
 * QueryCache is stubbed for the resolver calls: its ioredis client has no close
 * method and would keep this process alive. The cache wrapper itself is
 * covered by the unit tests. No audit write is on this path.
 *
 * Requires DATABASE_URL.
 *   node --env-file-if-exists=.env --test --import tsx src/services/__tests__/realtimeSnapshotService.integration.test.ts
 */
import { after, before, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const TENANT = 'rt-snapshot-test-tenant'
const OTHER = 'rt-snapshot-test-tenant-b'

const MIN = 60_000
const HOUR = 60 * MIN

let db: (typeof import('@src/db/client.js'))['db']
let svc: typeof import('@src/services/realtimeSnapshotService.js')
let Query: Record<string, (...a: any[]) => Promise<any>>

/** The fixed reading time every fixture is placed relative to. */
let anchor: Date
const ago = (ms: number) => new Date(anchor.getTime() - ms)

// Agents: P is the parent of C; X is unrelated; Z has no players at all.
let P = ''
let C = ''
let X = ''
let Z = ''
// Players of TENANT: u1 direct to P, u2 direct to C, u3 referred by u1 (no
// agent of its own), u4 direct to X, u5 nobody's. uB lives in OTHER.
let u1 = 0
let u2 = 0
let u3 = 0
let u4 = 0
let u5 = 0
let uB = 0

let sportsRef: { sport_id: string; league_id: string; event_id: string; market_id: string; runner_id: string; selection_code: string }
let casinoRef: { game_id: number; vendor_id: number; vendor_name: string }
const matkaIdByTenant = new Map<string, string>()

async function sweep(): Promise<void> {
  await db.execute(sql`DELETE FROM sports_bets WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM casino_bets WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM matka_bets WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM deposit_requests WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM withdrawal_requests WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM referral_attributions WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM users WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM matkas WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`
    DELETE FROM agent_hierarchy_closure
    WHERE ancestor_id IN (SELECT id FROM agents WHERE tenant_id IN (${TENANT}, ${OTHER}))
       OR descendant_id IN (SELECT id FROM agents WHERE tenant_id IN (${TENANT}, ${OTHER}))`)
  await db.execute(sql`DELETE FROM agents WHERE tenant_id IN (${TENANT}, ${OTHER})`)
}

async function mkAgent(parentId: string | null): Promise<string> {
  // `agents` has no name column; allowed_domains is NOT NULL with no default.
  const r = await db.execute(sql`
    INSERT INTO agents (tenant_id, scheme_type, allowed_domains, parent_agent_id, status)
    VALUES (${TENANT}, 'CREDIT', ARRAY['sports']::text[], ${parentId}, 'ACTIVE')
    RETURNING id`)
  return String((r.rows[0] as { id: string }).id)
}

/** Mirrors what the application maintains: every ancestor -> descendant pair. */
async function link(ancestor: string, descendant: string, depth: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth)
    VALUES (${ancestor}, ${descendant}, ${depth})
    ON CONFLICT DO NOTHING`)
}

async function mkUser(label: string, agentId: string | null, tenant = TENANT): Promise<number> {
  const r = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash, agent_id)
    VALUES (${tenant}, ${'RT ' + label}, ${`rt-snap-${label}-${Date.now()}`}, 'active', 'x', ${agentId})
    RETURNING id`)
  return Number((r.rows[0] as { id: number }).id)
}

async function mkMatka(tenant: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO matkas (tenant, name, code, timezone, schedule, status, limits, visibility, settings)
    VALUES (${tenant}, 'RT Snapshot Test', 'rt-snapshot-test', 'Asia/Kolkata',
            '{}'::jsonb, 'inactive', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)
  return String((r.rows[0] as { id: string }).id)
}

async function sportsBet(userId: number, status: string, at: Date, opts: { tenant?: string; tool?: boolean } = {}) {
  const t = opts.tenant ?? TENANT
  const s = sportsRef
  await db.execute(sql`
    INSERT INTO sports_bets (tenant, whitelabel_id, user_id, sport_id, league_id, market_id, event_id,
                             runner_id, selection_id, side, price, size, stake, liability, status,
                             exclude_from_admin_running, created_at, updated_at)
    VALUES (${t}, ${t}, ${userId}, ${s.sport_id}, ${s.league_id}, ${s.market_id}, ${s.event_id},
            ${s.runner_id}, ${s.selection_code}, 'back', 2, 10, 10, 10, ${status},
            ${opts.tool === true}, ${at}, ${at})`)
}

async function casinoBet(userId: number, status: string, at: Date, tenant = TENANT) {
  const c = casinoRef
  await db.execute(sql`
    INSERT INTO casino_bets (tenant, whitelabel_id, user_id, game_id, vendor_id, vendor_name, stake, status,
                             created_at, updated_at)
    VALUES (${tenant}, ${tenant}, ${userId}, ${c.game_id}, ${c.vendor_id}, ${c.vendor_name}, 10, ${status},
            ${at}, ${at})`)
}

async function matkaBet(userId: number, status: string, at: Date, tenant = TENANT) {
  await db.execute(sql`
    INSERT INTO matka_bets (tenant, whitelabel_id, user_id, matka_id, matka_type, market_name, bid_type,
                            bet_numbers, bet_amount, payout_multiplier, status, created_at, updated_at)
    VALUES (${tenant}, ${tenant}, ${userId}, ${matkaIdByTenant.get(tenant)!}, 'starline', 'RT Snapshot Test',
            'SINGLE', '5', 10, 9, ${status}, ${at}, ${at})`)
}

let utrSeq = 0
async function deposit(userId: number, amount: number, status: string, reviewedAt: Date | null, createdAt: Date, tenant = TENANT) {
  await db.execute(sql`
    INSERT INTO deposit_requests (tenant, user_id, amount, currency, method, utr, proof_key, status,
                                  reviewed_at, created_at, updated_at)
    VALUES (${tenant}, ${userId}, ${amount}, 'INR', 'UPI', ${`rt-snap-utr-${Date.now()}-${++utrSeq}`}, 'k',
            ${status}, ${reviewedAt}, ${createdAt}, ${createdAt})`)
}

async function withdrawal(userId: number, amount: number, status: string, reviewedAt: Date | null, createdAt: Date, tenant = TENANT) {
  await db.execute(sql`
    INSERT INTO withdrawal_requests (tenant, user_id, amount, currency, status, reviewed_at, created_at, updated_at)
    VALUES (${tenant}, ${userId}, ${amount}, 'INR', ${status}, ${reviewedAt}, ${createdAt}, ${createdAt})`)
}

async function buildFixtures(): Promise<void> {
  const s = await db.execute(sql`
    SELECT l.sport_id, e.league_id, m.event_id, r.market_id, r.id AS runner_id, r.selection_code
    FROM sports_runners r
    JOIN sports_markets m ON m.id = r.market_id
    JOIN sports_events e ON e.id = m.event_id
    JOIN sports_leagues l ON l.id = e.league_id
    ORDER BY (m.status = 'inactive') DESC, m.created_at ASC
    LIMIT 1`)
  assert.ok(s.rows.length, 'needs one existing sports runner chain to reference as a foreign-key target')
  sportsRef = s.rows[0] as typeof sportsRef

  const c = await db.execute(sql`
    SELECT g.id AS game_id, g.vendor_id, v.name AS vendor_name
    FROM casino_games g JOIN casino_vendors v ON v.id = g.vendor_id
    ORDER BY g.is_active ASC, g.id ASC
    LIMIT 1`)
  assert.ok(c.rows.length, 'needs one existing casino game to reference as a foreign-key target')
  casinoRef = c.rows[0] as typeof casinoRef

  matkaIdByTenant.set(TENANT, await mkMatka(TENANT))
  matkaIdByTenant.set(OTHER, await mkMatka(OTHER))

  P = await mkAgent(null)
  C = await mkAgent(P)
  X = await mkAgent(null)
  Z = await mkAgent(null)
  for (const a of [P, C, X, Z]) await link(a, a, 0)
  await link(P, C, 1)

  u1 = await mkUser('u1', P)
  u2 = await mkUser('u2', C)
  u3 = await mkUser('u3', null)
  u4 = await mkUser('u4', X)
  u5 = await mkUser('u5', null)
  uB = await mkUser('uB', null, OTHER)
  await db.execute(sql`
    INSERT INTO referral_attributions (tenant, referrer_id, referee_id, tier)
    VALUES (${TENANT}, ${u1}, ${u3}, 1)`)

  // --- Activity inside the 5-minute window (all settled, so none is open) ---
  await sportsBet(u1, 'lost', ago(1 * MIN))
  await casinoBet(u1, 'lost', ago(2 * MIN)) //  u1 again, other product: still one player
  await matkaBet(u2, 'won', ago(1.5 * MIN))
  await casinoBet(u3, 'lost', ago(1 * MIN))
  await sportsBet(u4, 'lost', ago(1 * MIN))
  // --- Activity outside it ---
  await sportsBet(u5, 'lost', ago(10 * MIN))

  // --- Open and settled bets, all well outside the activity window ---
  await sportsBet(u1, 'matched', ago(30 * MIN)) //       open
  await casinoBet(u2, 'pending', ago(20 * MIN)) //       open
  await matkaBet(u4, 'pending', ago(20 * MIN)) //        open
  await sportsBet(u5, 'unmatched', ago(20 * MIN), { tool: true }) // open, bet tool: left out
  await sportsBet(u4, 'won', ago(20 * MIN)) //           settled
  await casinoBet(u3, 'void', ago(20 * MIN)) //          settled

  // --- Deposits (settled at = COALESCE(reviewed_at, created_at)) ---
  await deposit(u1, 100, 'APPROVED', ago(10 * MIN), ago(2 * HOUR)) //  in: approved 10 min ago
  await deposit(u4, 200, 'APPROVED', ago(30 * MIN), ago(40 * MIN)) //  in
  await deposit(u1, 400, 'APPROVED', ago(2 * HOUR), ago(3 * HOUR)) //  out: settled 2 h ago
  await deposit(u1, 800, 'PENDING', null, ago(5 * MIN)) //             out: pending
  await deposit(u2, 1600, 'APPROVED', null, ago(15 * MIN)) //          in: no review time, falls back to created_at
  await deposit(u2, 3200, 'REJECTED', ago(5 * MIN), ago(6 * MIN)) //   out: rejected

  // --- Withdrawals ---
  await withdrawal(u1, 50, 'COMPLETED', ago(5 * MIN), ago(20 * MIN)) //  in
  await withdrawal(u4, 20, 'COMPLETED', ago(10 * MIN), ago(15 * MIN)) // in
  await withdrawal(u4, 25, 'COMPLETED', ago(3 * HOUR), ago(4 * HOUR)) // out: settled 3 h ago
  await withdrawal(u2, 10, 'PENDING', null, ago(1 * MIN)) //             out
  await withdrawal(u1, 5, 'PROCESSING', null, ago(1 * MIN)) //           out

  // --- The other tenant: must never appear in TENANT's figures ---
  await sportsBet(uB, 'matched', ago(1 * MIN), { tenant: OTHER })
  await deposit(uB, 6400, 'APPROVED', ago(5 * MIN), ago(6 * MIN), OTHER)
  await withdrawal(uB, 1000, 'COMPLETED', ago(5 * MIN), ago(6 * MIN), OTHER)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  svc = await import('@src/services/realtimeSnapshotService.js')
  ;({ commonQueryResolvers: Query } = (await import('@src/domains/common/resolvers/queries.js')) as any)

  const { QueryCache } = await import('@src/services/QueryCache.js')
  mock.method(QueryCache, 'getLive', async () => null)
  mock.method(QueryCache, 'setLive', async () => {})

  anchor = new Date()
  await sweep()
  try {
    await buildFixtures()
  } catch (e) {
    await sweep().catch(() => {})
    throw e
  }
})

after(async () => {
  if (db) await sweep()
  mock.restoreAll()
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

const figures = (s: { activePlayers: number; activeBets: number; depositsLastHour: number; withdrawalsLastHour: number }) => ({
  activePlayers: s.activePlayers,
  activeBets: s.activeBets,
  depositsLastHour: s.depositsLastHour,
  withdrawalsLastHour: s.withdrawalsLastHour,
})

const DASHBOARD = [{ domain: 'overview.dashboard', actions: ['view'] }]
const asAgent = (agentId: string) => ({
  user: { sub: agentId, type: 'agent', agentId, roles: [] },
  permissions: DASHBOARD,
  tenant: TENANT,
  whitelabel: { id: TENANT },
})
const asAdmin = (tenant: string) => ({
  user: { sub: '1', type: 'admin', roles: ['Whitelabel Admin'] },
  permissions: DASHBOARD,
  tenant,
  whitelabel: { id: tenant },
})

describe('a whitelabel admin reads its whole tenant', () => {
  it('gets the exact figures for the tenant at a fixed clock', async () => {
    const got = await svc.computeRealtimeSnapshot({ tenant: TENANT, whitelabelId: TENANT }, anchor)
    assert.deepEqual(figures(got), {
      // u1, u2, u3, u4 bet in the window; u5 only 10 min ago; uB is another tenant.
      activePlayers: 4,
      // sports matched (u1) + casino pending (u2) + matka pending (u4); not the
      // bet-tool bet, not the settled ones, not the other tenant's open bet.
      activeBets: 3,
      depositsLastHour: 100 + 200 + 1600,
      withdrawalsLastHour: 50 + 20,
    })
    assert.equal(got.activityWindowMins, 5)
    assert.equal(got.at, anchor.toISOString())
  })

  it('counts a player who bet in two products once', async () => {
    // Per-table distinct players would be sports {u1,u4} + casino {u1,u3} +
    // matka {u2} = 5. The union is {u1,u2,u3,u4} = 4.
    const got = await svc.computeRealtimeSnapshot({ tenant: TENANT, whitelabelId: TENANT }, anchor)
    assert.equal(got.activePlayers, 4, 'u1 bet on sports and casino and was counted twice')
  })

  it('moves players in and out of the window as the clock moves', async () => {
    const later = await svc.computeRealtimeSnapshot(
      { tenant: TENANT, whitelabelId: TENANT },
      new Date(anchor.getTime() + 6 * MIN)
    )
    assert.equal(later.activePlayers, 0, 'bets older than five minutes still counted')

    const earlier = await svc.computeRealtimeSnapshot(
      { tenant: TENANT, whitelabelId: TENANT },
      new Date(anchor.getTime() - 9 * MIN)
    )
    assert.equal(earlier.activePlayers, 1, 'only u5, who bet 10 minutes before the anchor, is inside [-14, -9] min')
  })

  it('counts a deposit when its settlement falls inside the hour, and only then', async () => {
    // [-2h50m, -1h50m] holds only the deposit approved 2 h ago.
    const got = await svc.computeRealtimeSnapshot(
      { tenant: TENANT, whitelabelId: TENANT },
      new Date(anchor.getTime() - (HOUR + 50 * MIN))
    )
    assert.equal(got.depositsLastHour, 400)
    assert.equal(got.withdrawalsLastHour, 0)
  })

  it('reaches the same figures through the resolver', async () => {
    const got = await Query.realtimeSnapshot(undefined, {}, asAdmin(TENANT), undefined)
    assert.deepEqual(figures(got), {
      activePlayers: 4,
      activeBets: 3,
      depositsLastHour: 1900,
      withdrawalsLastHour: 70,
    })
  })
})

describe('tenants are isolated', () => {
  it('shows the other tenant only its own rows', async () => {
    const got = await Query.realtimeSnapshot(undefined, {}, asAdmin(OTHER), undefined)
    assert.deepEqual(figures(got), {
      activePlayers: 1,
      activeBets: 1,
      depositsLastHour: 6400,
      withdrawalsLastHour: 1000,
    })
  })

  it('includes both throwaway tenants in a core-mode (platform-wide) reading', async () => {
    // Real platform activity adds to these, so only a lower bound is exact.
    const core = await svc.computeRealtimeSnapshot({}, anchor)
    assert.ok(core.activePlayers >= 4 + 1, `core mode saw ${core.activePlayers} active players`)
    assert.ok(core.activeBets >= 3 + 1, `core mode saw ${core.activeBets} open bets`)
    assert.ok(core.depositsLastHour >= 1900 + 6400, `core mode saw ${core.depositsLastHour} in deposits`)
    assert.ok(core.withdrawalsLastHour >= 70 + 1000, `core mode saw ${core.withdrawalsLastHour} in withdrawals`)
  })
})

describe('an agent sees only its own players', () => {
  it('the parent sees its direct player, its child agent’s player and a referred player — not X’s player', async () => {
    const got = await Query.realtimeSnapshot(undefined, {}, asAgent(P), undefined)
    assert.deepEqual(figures(got), {
      activePlayers: 3, //          u1, u2 (via child C), u3 (referral); not u4
      activeBets: 2, //             u1 sports matched, u2 casino pending; not u4's matka
      depositsLastHour: 100 + 1600, // u1 and u2; not u4's 200
      withdrawalsLastHour: 50, //   u1; not u4's 20
    })
  })

  it('the child sees only its own player, never its parent’s', async () => {
    const got = await Query.realtimeSnapshot(undefined, {}, asAgent(C), undefined)
    assert.deepEqual(figures(got), {
      activePlayers: 1,
      activeBets: 1,
      depositsLastHour: 1600,
      withdrawalsLastHour: 0,
    })
  })

  it('an unrelated agent sees only its own player', async () => {
    const got = await Query.realtimeSnapshot(undefined, {}, asAgent(X), undefined)
    assert.deepEqual(figures(got), {
      activePlayers: 1,
      activeBets: 1,
      depositsLastHour: 200,
      withdrawalsLastHour: 20,
    })
  })

  it('an agent with no players sees zeros, not the tenant', async () => {
    const got = await Query.realtimeSnapshot(undefined, {}, asAgent(Z), undefined)
    assert.deepEqual(figures(got), {
      activePlayers: 0,
      activeBets: 0,
      depositsLastHour: 0,
      withdrawalsLastHour: 0,
    })
  })

  it('agrees with the service at the fixed clock', async () => {
    const { PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js')
    const playerIds = await new PlayerAuthService().getAgentPlayerIds(P, TENANT)
    assert.deepEqual([...playerIds].sort((a, b) => a - b), [u1, u2, u3].sort((a, b) => a - b))
    const got = await svc.computeRealtimeSnapshot(
      { tenant: TENANT, whitelabelId: TENANT, agent: { agentId: P, playerIds } },
      anchor
    )
    assert.deepEqual(figures(got), {
      activePlayers: 3,
      activeBets: 2,
      depositsLastHour: 1700,
      withdrawalsLastHour: 50,
    })
  })
})
