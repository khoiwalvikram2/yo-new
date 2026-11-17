/**
 * Query.exposureByMarket against the real database.
 *
 * What is proven, each by an exact figure rather than "greater than zero":
 *   - one row per sport holding open liability (matched and unmatched), with the
 *     sport's own key and name, and one matka row for every matka type together,
 *     summing potential_win with a NULL adding nothing;
 *   - settled, won, lost, void and cancelled bets are left out;
 *   - an open bet placed through the bet tool is INCLUDED, as it is in the
 *     dashboard Exposure figure;
 *   - another tenant, another whitelabel of the same tenant and a bet in a
 *     currency other than the whitelabel's base currency are left out, and the
 *     base currency really is read from app_configs (the second tenant is
 *     configured in USD);
 *   - agent scoping by both routes (the users.agent_id subtree and referral),
 *     never another agent's players, and nothing for an agent with no players;
 *   - reconciliation: the sports rows add up to getCurrentOpenSportsExposure and
 *     the matka row equals getCurrentOpenMatkaExposure for the same tenant,
 *     whitelabel and currency, and together they equal the Exposure the KPI
 *     repos report for a range ending now;
 *   - core mode equals the KPI's core-mode definition over the real whitelabels.
 *
 * Money amounts are distinct powers of two (or sums of them), so any wrongly
 * included row shows up as a figure no correct query could produce.
 *
 * Writes only inside two throwaway tenants of its own (prefix exp-by-mkt-test-)
 * and removes everything it wrote, before the run (leftovers of a crashed run)
 * and after it, then counts what is left and fails if anything is. It creates
 * no `whitelabels` row, so no scheduler that walks the whitelabel list can pick
 * the tenants up. Its one app_configs row (the second tenant's base currency)
 * is keyed by a throwaway tenant id and removed with the rest.
 *
 * The sports catalogue is global (no tenant column), so the test creates no
 * catalogue rows. It borrows — reads, never modifies — one existing runner
 * chain from each of three sports as foreign-key targets for its own bets,
 * preferring inactive markets.
 *
 * QueryCache is stubbed for the resolver calls: its ioredis client has no close
 * method and would keep this process alive. The cache wrapper itself is covered
 * by the unit tests. No audit write is on this path.
 *
 * Requires DATABASE_URL.
 *   node --env-file-if-exists=.env --test --import tsx src/services/__tests__/exposureByMarketService.integration.test.ts
 */
import { after, before, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const TENANT = 'exp-by-mkt-test-tenant'
/** A second tenant, configured with USD as its base currency. */
const OTHER = 'exp-by-mkt-test-tenant-b'
/** A second whitelabel id inside TENANT. */
const OTHER_WL = 'exp-by-mkt-test-wl-x'

let db: (typeof import('@src/db/client.js'))['db']
let svc: typeof import('@src/services/exposureByMarketService.js')
let sportsRepo: typeof import('@src/repos/reporting/sportsReportingRepo.js')
let matkaRepo: typeof import('@src/repos/reporting/matkaReportingRepo.js')
let getWhitelabelBaseCurrency: (typeof import('@src/services/dashboardService.js'))['getWhitelabelBaseCurrency']
let Query: Record<string, (...a: any[]) => Promise<any>>

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

type Chain = { key: string; name: string; sport_id: string; league_id: string; event_id: string; market_id: string; runner_id: string; selection_code: string }
/** Three borrowed sports, ordered by name: S1 < S2 < S3. */
let S1: Chain
let S2: Chain
let S3: Chain
const matkaIdByTenant = new Map<string, string>()

async function sweep(): Promise<void> {
  await db.execute(sql`DELETE FROM sports_bets WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM matka_bets WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM referral_attributions WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM users WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM matkas WHERE tenant IN (${TENANT}, ${OTHER})`)
  await db.execute(sql`DELETE FROM app_configs WHERE whitelabel_id IN (${TENANT}, ${OTHER}, ${OTHER_WL})`)
  await db.execute(sql`
    DELETE FROM agent_hierarchy_closure
    WHERE ancestor_id IN (SELECT id FROM agents WHERE tenant_id IN (${TENANT}, ${OTHER}))
       OR descendant_id IN (SELECT id FROM agents WHERE tenant_id IN (${TENANT}, ${OTHER}))`)
  await db.execute(sql`DELETE FROM agents WHERE tenant_id IN (${TENANT}, ${OTHER})`)
}

/** Every row this test could have written, counted; all must be 0 after the sweep. */
async function leftovers(): Promise<Record<string, number>> {
  const r = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM sports_bets WHERE tenant IN (${TENANT}, ${OTHER}) OR whitelabel_id IN (${TENANT}, ${OTHER}, ${OTHER_WL}))::int AS sports_bets,
      (SELECT COUNT(*) FROM matka_bets WHERE tenant IN (${TENANT}, ${OTHER}) OR whitelabel_id IN (${TENANT}, ${OTHER}, ${OTHER_WL}))::int AS matka_bets,
      (SELECT COUNT(*) FROM referral_attributions WHERE tenant IN (${TENANT}, ${OTHER}))::int AS referral_attributions,
      (SELECT COUNT(*) FROM users WHERE tenant IN (${TENANT}, ${OTHER}))::int AS users,
      (SELECT COUNT(*) FROM matkas WHERE tenant IN (${TENANT}, ${OTHER}))::int AS matkas,
      (SELECT COUNT(*) FROM app_configs WHERE whitelabel_id IN (${TENANT}, ${OTHER}, ${OTHER_WL}))::int AS app_configs,
      (SELECT COUNT(*) FROM agents WHERE tenant_id IN (${TENANT}, ${OTHER}))::int AS agents`)
  return r.rows[0] as Record<string, number>
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
    VALUES (${tenant}, ${'XBM ' + label}, ${`exp-by-mkt-${label}-${Date.now()}`}, 'active', 'x', ${agentId})
    RETURNING id`)
  return Number((r.rows[0] as { id: number }).id)
}

async function mkMatka(tenant: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO matkas (tenant, name, code, timezone, schedule, status, limits, visibility, settings)
    VALUES (${tenant}, 'Exposure By Market Test', 'exp-by-mkt-test', 'Asia/Kolkata',
            '{}'::jsonb, 'inactive', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)
  return String((r.rows[0] as { id: string }).id)
}

type BetOpts = { tenant?: string; whitelabelId?: string; currency?: string; tool?: boolean }

async function sportsBet(userId: number, s: Chain, status: string, liability: number, opts: BetOpts = {}) {
  const t = opts.tenant ?? TENANT
  await db.execute(sql`
    INSERT INTO sports_bets (tenant, whitelabel_id, user_id, sport_id, league_id, market_id, event_id,
                             runner_id, selection_id, side, price, size, stake, liability, status,
                             currency, exclude_from_admin_running)
    VALUES (${t}, ${opts.whitelabelId ?? t}, ${userId}, ${s.sport_id}, ${s.league_id}, ${s.market_id}, ${s.event_id},
            ${s.runner_id}, ${s.selection_code}, 'back', 2, ${liability}, ${liability}, ${liability}, ${status},
            ${opts.currency ?? 'INR'}, ${opts.tool === true})`)
}

async function matkaBet(userId: number, type: string, status: string, potentialWin: number | null, opts: BetOpts = {}) {
  const t = opts.tenant ?? TENANT
  await db.execute(sql`
    INSERT INTO matka_bets (tenant, whitelabel_id, user_id, matka_id, matka_type, market_name, bid_type,
                            bet_numbers, bet_amount, payout_multiplier, potential_win, status, currency)
    VALUES (${t}, ${opts.whitelabelId ?? t}, ${userId}, ${matkaIdByTenant.get(t)!}, ${type}, 'Exposure By Market Test',
            'SINGLE', '5', 10, 9, ${potentialWin}, ${status}, ${opts.currency ?? 'INR'})`)
}

async function borrowSports(): Promise<void> {
  // One runner chain per sport, for the first three sports (by name) that have one.
  const r = await db.execute(sql`
    SELECT key, name, sport_id, league_id, event_id, market_id, runner_id, selection_code FROM (
      SELECT DISTINCT ON (l.sport_id)
             s.key, s.name, l.sport_id, e.league_id, m.event_id, r.market_id, r.id AS runner_id, r.selection_code
      FROM sports_runners r
      JOIN sports_markets m ON m.id = r.market_id
      JOIN sports_events e ON e.id = m.event_id
      JOIN sports_leagues l ON l.id = e.league_id
      JOIN sports s ON s.id = l.sport_id
      ORDER BY l.sport_id, (m.status = 'inactive') DESC, m.created_at ASC
    ) AS chains`)
  const chains = (r.rows as Chain[]).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  assert.ok(chains.length >= 3, 'needs existing runner chains in three different sports to reference as foreign-key targets')
  ;[S1, S2, S3] = chains
  assert.ok(S1.name !== S2.name && S2.name !== S3.name, 'the three borrowed sports need distinct names')
}

async function buildFixtures(): Promise<void> {
  await borrowSports()
  matkaIdByTenant.set(TENANT, await mkMatka(TENANT))
  matkaIdByTenant.set(OTHER, await mkMatka(OTHER))
  await db.execute(sql`INSERT INTO app_configs (whitelabel_id, base_currency) VALUES (${OTHER}, 'USD')`)

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
  // Confirmed: PlayerAuthService.getAgentPlayerIds counts only confirmed attributions (since
  // 2026-10-21), and the column defaults to 'pending'.
  await db.execute(sql`
    INSERT INTO referral_attributions (tenant, referrer_id, referee_id, tier, status)
    VALUES (${TENANT}, ${u1}, ${u3}, 1, 'confirmed')`)

  // --- TENANT, whitelabel TENANT, INR (TENANT has no app_configs row: base INR) — open ---
  await sportsBet(u1, S3, 'matched', 256)
  await sportsBet(u2, S3, 'unmatched', 128) //           S3 = 384
  await sportsBet(u3, S2, 'matched', 16)
  await sportsBet(u5, S2, 'matched', 32, { tool: true }) // S2 = 48: the bet-tool bet counts
  await sportsBet(u4, S1, 'matched', 48) //              S1 = 48: ties S2, first by name
  await matkaBet(u1, 'starline', 'pending', 1024)
  await matkaBet(u2, 'worli', 'active', 512)
  await matkaBet(u3, 'starline', 'pending', null) //     NULL potential_win adds nothing
  await matkaBet(u4, 'jackpot', 'pending', 2048) //      matka = 3584, all types in one row

  // --- Closed: never exposure ---
  await sportsBet(u1, S3, 'won', 4096)
  await sportsBet(u2, S3, 'lost', 8192)
  await sportsBet(u3, S2, 'settled', 16384)
  await sportsBet(u4, S1, 'void', 32768)
  await sportsBet(u5, S1, 'cancelled', 65536)
  await matkaBet(u1, 'starline', 'won', 4096)
  await matkaBet(u2, 'worli', 'lost', 8192)
  await matkaBet(u3, 'starline', 'cancelled', 16384)
  await matkaBet(u4, 'jackpot', 'void', 32768)

  // --- Another whitelabel of the same tenant ---
  await sportsBet(u1, S3, 'matched', 131072, { whitelabelId: OTHER_WL })
  await matkaBet(u1, 'starline', 'pending', 196608, { whitelabelId: OTHER_WL })

  // --- TENANT's own whitelabel, but not its base currency ---
  await sportsBet(u1, S3, 'matched', 262144, { currency: 'USD' })
  await matkaBet(u1, 'starline', 'pending', 393216, { currency: 'USD' })

  // --- The other tenant, whose base currency is USD: only its USD bets count ---
  await sportsBet(uB, S1, 'matched', 524288, { tenant: OTHER, currency: 'USD' })
  await matkaBet(uB, 'starline', 'pending', 786432, { tenant: OTHER, currency: 'USD' })
  await sportsBet(uB, S3, 'matched', 1048576, { tenant: OTHER, currency: 'INR' })
  await matkaBet(uB, 'starline', 'pending', 1572864, { tenant: OTHER, currency: 'INR' })
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  svc = await import('@src/services/exposureByMarketService.js')
  sportsRepo = await import('@src/repos/reporting/sportsReportingRepo.js')
  matkaRepo = await import('@src/repos/reporting/matkaReportingRepo.js')
  ;({ getWhitelabelBaseCurrency } = await import('@src/services/dashboardService.js'))
  ;({ commonQueryResolvers: Query } = (await import('@src/domains/common/resolvers/queries.js')) as any)

  const { QueryCache } = await import('@src/services/QueryCache.js')
  mock.method(QueryCache, 'getLive', async () => null)
  mock.method(QueryCache, 'setLive', async () => {})

  await sweep()
  try {
    await buildFixtures()
  } catch (e) {
    await sweep().catch(() => {})
    throw e
  }
})

after(async () => {
  try {
    if (db) {
      await sweep()
      const left = await leftovers()
      assert.ok(
        Object.values(left).every((n) => Number(n) === 0),
        `cleanup left rows behind: ${JSON.stringify(left)}`
      )
    }
  } finally {
    mock.restoreAll()
    const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
    await closeRedisEmitter()
  }
})

const sportsRow = (s: Chain, amount: number) => ({ key: `sports:${s.key}`, product: 'sports', label: s.name, amount })
const matkaRow = (amount: number) => ({ key: 'matka', product: 'matka', label: 'Matka', amount })
const sumOf = (rows: { amount: number }[]) => rows.reduce((t, r) => t + r.amount, 0)

const PERMS = [
  { domain: 'overview.dashboard', actions: ['view'] },
  { domain: 'reporting.exposure', actions: ['view'] },
]
const asAgent = (agentId: string) => ({
  user: { sub: agentId, type: 'agent', agentId, roles: [] },
  permissions: PERMS,
  tenant: TENANT,
  whitelabel: { id: TENANT },
})
const asAdmin = (tenant: string) => ({
  user: { sub: '1', type: 'admin', roles: ['Whitelabel Admin'] },
  permissions: PERMS,
  tenant,
  whitelabel: { id: tenant },
})

describe('a whitelabel admin reads the whole open book of its whitelabel', () => {
  it('gets one row per sport and one matka row, with exact amounts, in order', async () => {
    const got = await svc.computeExposureByMarket({ tenant: TENANT, whitelabelId: TENANT })
    assert.deepEqual(got.markets, [
      // 1024 + 512 + 2048; the NULL potential_win adds nothing; three matka types, one row.
      matkaRow(3584),
      // 256 matched + 128 unmatched; not the won/lost bets, the other whitelabel's or the USD one.
      sportsRow(S3, 384),
      // S1 and S2 tie at 48 and are ordered by name. S2 is 16 + the bet-tool bet's 32.
      sportsRow(S1, 48),
      sportsRow(S2, 48),
    ])
  })

  it('reaches the same rows through the resolver', async () => {
    const got = await Query.exposureByMarket(undefined, {}, asAdmin(TENANT), undefined)
    assert.deepEqual(got.markets, [matkaRow(3584), sportsRow(S3, 384), sportsRow(S1, 48), sportsRow(S2, 48)])
    assert.ok(!Number.isNaN(Date.parse(got.at)), 'at is not an ISO time')
  })
})

describe('only this whitelabel, in its base currency', () => {
  it('shows the other whitelabel of the same tenant only its own bets', async () => {
    const got = await svc.computeExposureByMarket({ tenant: TENANT, whitelabelId: OTHER_WL })
    assert.deepEqual(got.markets, [matkaRow(196608), sportsRow(S3, 131072)])
  })

  it('reads the base currency from app_configs: the USD tenant sees its USD bets and not its INR ones', async () => {
    assert.equal(await getWhitelabelBaseCurrency(OTHER), 'USD')
    assert.equal(await getWhitelabelBaseCurrency(TENANT), 'INR', 'an unconfigured whitelabel falls back to INR')
    const got = await Query.exposureByMarket(undefined, {}, asAdmin(OTHER), undefined)
    assert.deepEqual(got.markets, [matkaRow(786432), sportsRow(S1, 524288)])
  })
})

describe('reconciliation with the dashboard Exposure figure', () => {
  const scopes = [
    { name: 'the INR whitelabel', tenant: TENANT, whitelabelId: TENANT },
    { name: 'the second whitelabel of that tenant', tenant: TENANT, whitelabelId: OTHER_WL },
    { name: 'the USD tenant', tenant: OTHER, whitelabelId: OTHER },
  ]

  for (const s of scopes) {
    it(`matches getCurrentOpenSportsExposure and getCurrentOpenMatkaExposure for ${s.name}`, async () => {
      const currency = await getWhitelabelBaseCurrency(s.tenant)
      const filter = { tenant: s.tenant, whitelabelId: s.whitelabelId, currency }
      const [card, sports, matka] = await Promise.all([
        svc.computeExposureByMarket({ tenant: s.tenant, whitelabelId: s.whitelabelId }),
        sportsRepo.getCurrentOpenSportsExposure(filter),
        matkaRepo.getCurrentOpenMatkaExposure(filter),
      ])
      assert.ok(sports > 0 && matka > 0, 'the fixture should give this scope both sports and matka exposure')
      assert.equal(sumOf(card.markets.filter((r) => r.product === 'sports')), sports)
      const matkaRows = card.markets.filter((r) => r.product === 'matka')
      assert.equal(matkaRows.length, 1)
      assert.equal(matkaRows[0].amount, matka)
    })
  }

  it('adds up to the Exposure the KPI repos report for a range ending now', async () => {
    // The dashboard's default range: the last 7 days up to now.
    const now = new Date()
    const filter = {
      tenant: TENANT,
      whitelabelId: TENANT,
      currency: await getWhitelabelBaseCurrency(TENANT),
      dateFrom: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      dateTo: now,
    }
    const [card, sportsKPIs, matkaKPIs] = await Promise.all([
      svc.computeExposureByMarket({ tenant: TENANT, whitelabelId: TENANT }),
      sportsRepo.getSportsKPIs(filter),
      matkaRepo.getMatkaKPIs(filter),
    ])
    assert.equal(sumOf(card.markets), sportsKPIs.totalExposure + matkaKPIs.totalExposure)
    assert.equal(sumOf(card.markets), 3584 + 384 + 48 + 48)
  })

  it('core mode equals the KPI core-mode definition over the real whitelabels', async (t) => {
    // The throwaway tenants have no whitelabels row, so this reads only real data,
    // which may move while it is read; a moving book skips rather than fails.
    const { listWhitelabelsDb } = await import('@src/repos/common/whitelabelRepo.js')
    const kpiDefinition = async () => {
      let total = 0
      for (const wl of await listWhitelabelsDb()) {
        const filter = { tenant: wl.id, whitelabelId: wl.id, currency: await getWhitelabelBaseCurrency(wl.id) }
        total += (await sportsRepo.getCurrentOpenSportsExposure(filter)) + (await matkaRepo.getCurrentOpenMatkaExposure(filter))
      }
      return total
    }
    const before = await kpiDefinition()
    const card = await svc.computeExposureByMarket({})
    const afterwards = await kpiDefinition()
    if (before !== afterwards) {
      t.skip('the live open book moved during the reading')
      return
    }
    // Equal to a definition that walks only the whitelabels list, so neither
    // throwaway tenant (no whitelabels row) leaked into the core reading.
    assert.equal(sumOf(card.markets), before)
  })
})

describe('an agent sees only its own players', () => {
  it('the parent sees its direct player, its child agent’s player and a referred player — not X’s player', async () => {
    const got = await Query.exposureByMarket(undefined, {}, asAgent(P), undefined)
    assert.deepEqual(got.markets, [
      matkaRow(1024 + 512), //    u1 and u2 (via child C); u3's NULL adds nothing; not u4's 2048
      sportsRow(S3, 256 + 128), // u1 and u2
      sportsRow(S2, 16), //        u3, reached only by referral; not u5's bet-tool bet (nobody's player)
    ])
  })

  it('the child sees only its own player, never its parent’s', async () => {
    const got = await Query.exposureByMarket(undefined, {}, asAgent(C), undefined)
    assert.deepEqual(got.markets, [matkaRow(512), sportsRow(S3, 128)])
  })

  it('an unrelated agent sees only its own player', async () => {
    const got = await Query.exposureByMarket(undefined, {}, asAgent(X), undefined)
    assert.deepEqual(got.markets, [matkaRow(2048), sportsRow(S1, 48)])
  })

  it('an agent with no players sees nothing, not the tenant', async () => {
    const got = await Query.exposureByMarket(undefined, {}, asAgent(Z), undefined)
    assert.deepEqual(got.markets, [])
  })

  it('agrees with the service given the same player list', async () => {
    const { PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js')
    const playerIds = await new PlayerAuthService().getAgentPlayerIds(P, TENANT)
    assert.deepEqual([...playerIds].sort((a, b) => a - b), [u1, u2, u3].sort((a, b) => a - b))
    const got = await svc.computeExposureByMarket({ tenant: TENANT, whitelabelId: TENANT, agent: { agentId: P, playerIds } })
    assert.deepEqual(got.markets, [matkaRow(1536), sportsRow(S3, 384), sportsRow(S2, 16)])
  })
})
