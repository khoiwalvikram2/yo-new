/**
 * Unit tests for Query.exposureByMarket and its service. No database, no Redis.
 *
 * The pg pool is replaced by one that throws, so any test here that would have
 * issued a query fails loudly instead of quietly reading the shared database;
 * QueryCache is replaced by an in-memory stand-in for the same reason. The
 * core-mode tests stand in for the service's reads (`exposureByMarketReads`)
 * so the merge can be checked against books whose contents are known.
 *
 *   node --env-file-if-exists=.env --test --import tsx src/services/__tests__/exposureByMarketService.test.ts
 */
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { parse, Kind, type ObjectTypeDefinitionNode, type ObjectTypeExtensionNode, type TypeNode } from 'graphql'

type Svc = typeof import('@src/services/exposureByMarketService.js')
type Row = import('@src/services/exposureByMarketService.js').ExposureByMarketRow
type BookFilter = import('@src/services/exposureByMarketService.js').OpenBookFilter

let svc: Svc
let Query: Record<string, (...a: any[]) => Promise<any>>
let QueryCache: (typeof import('@src/services/QueryCache.js'))['QueryCache']
let PlayerAuthService: (typeof import('@src/domains/players/services/PlayerAuthService.js'))['PlayerAuthService']
let pool: (typeof import('@src/db/client.js'))['pool']
let realtimeSnapshotCacheKey: (typeof import('@src/services/realtimeSnapshotService.js'))['realtimeSnapshotCacheKey']

const DASHBOARD = { domain: 'overview.dashboard', actions: ['view'] }
const EXPOSURE = { domain: 'reporting.exposure', actions: ['view'] }
const BOTH = [DASHBOARD, EXPOSURE]
/** The message must START with this (assert.rejects would match a RegExp against "Error: ..."). */
const FORBIDDEN = (e: any) => /^Forbidden: insufficient permissions/.test(String(e?.message))

/** Keys read from and written to the cache stand-in during one test. */
let cacheReads: string[] = []
let cacheWrites: { key: string; data: unknown }[] = []
let cacheStore = new Map<string, unknown>()
/** Calls that reached the service's reads, by name. */
let readCalls: string[] = []

before(async () => {
  svc = await import('@src/services/exposureByMarketService.js')
  ;({ commonQueryResolvers: Query } = (await import('@src/domains/common/resolvers/queries.js')) as any)
  ;({ QueryCache } = await import('@src/services/QueryCache.js'))
  ;({ PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js'))
  ;({ pool } = await import('@src/db/client.js'))
  ;({ realtimeSnapshotCacheKey } = await import('@src/services/realtimeSnapshotService.js'))
})

/** Wraps each of the service's reads so a test can see whether it was reached. */
function spyOnReads(): void {
  const reads = svc.exposureByMarketReads
  for (const name of ['whitelabelIds', 'baseCurrency', 'openSportsBySport', 'openMatka'] as const) {
    const original = reads[name] as (...a: any[]) => any
    mock.method(reads, name, (...a: any[]) => {
      readCalls.push(name)
      return original(...a)
    })
  }
}

beforeEach(() => {
  cacheReads = []
  cacheWrites = []
  cacheStore = new Map()
  readCalls = []
  const refuse = () => {
    throw new Error('unit test touched the database')
  }
  mock.method(pool, 'query', refuse)
  mock.method(pool, 'connect', refuse)
  mock.method(QueryCache, 'getLive', async (key: string) => {
    cacheReads.push(key)
    return (cacheStore.get(key) as any) ?? null
  })
  mock.method(QueryCache, 'setLive', async (key: string, data: unknown) => {
    cacheWrites.push({ key, data })
    cacheStore.set(key, data)
  })
  spyOnReads()
})

afterEach(() => {
  mock.restoreAll()
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

const call = (ctx: unknown) => Query.exposureByMarket(undefined, {}, ctx, undefined)
const admin = (permissions: unknown, extra: Record<string, unknown> = {}) => ({
  user: { sub: '1', type: 'admin', roles: ['Whitelabel Admin'] },
  permissions,
  tenant: 't1',
  whitelabel: { id: 't1' },
  ...extra,
})
/** drizzle wraps the driver error as "Failed query: ..." with the original as `cause`. */
const touchedTheDatabase = (e: any) => /unit test touched the database/.test(`${e?.message} ${e?.cause?.message}`)

describe('the permission gate', () => {
  const refusals: [string, unknown][] = [
    ['a signed-in caller holding nothing', admin([])],
    ['a caller holding overview.dashboard:view but not reporting.exposure:view', admin([DASHBOARD])],
    ['a caller holding reporting.exposure:view but not overview.dashboard:view', admin([EXPOSURE])],
    ['a caller holding only an unrelated permission', admin([{ domain: 'casino', actions: ['read'] }])],
    ['a caller holding the right domains with the wrong action', admin([{ domain: 'overview.dashboard', actions: ['export'] }, EXPOSURE])],
    ['a caller whose permissions are missing entirely', { user: { sub: '1', type: 'admin', roles: [] }, tenant: 't1' }],
    ['a call with no context at all', undefined],
  ]

  for (const [name, ctx] of refusals) {
    it(`refuses ${name}, before the cache or the database`, async () => {
      // The pool stand-in throws a different message, so matching Forbidden also
      // proves no query ran first.
      await assert.rejects(() => call(ctx), FORBIDDEN)
      assert.deepEqual(cacheReads, [], 'the cache was consulted for a caller who may not see the card')
      assert.deepEqual(cacheWrites, [])
      assert.deepEqual(readCalls, [], 'a read ran for a caller who may not see the card')
    })
  }

  it('refuses an agent missing a permission before asking for its players', async () => {
    let asked = false
    mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async () => {
      asked = true
      return []
    })
    await assert.rejects(
      () => call({ user: { sub: 'ag', type: 'agent', agentId: 'ag', roles: [] }, permissions: [DASHBOARD], tenant: 't1', whitelabel: { id: 't1' } }),
      FORBIDDEN
    )
    assert.equal(asked, false)
    assert.deepEqual(cacheReads, [])
  })

  it('(harness check) lets a caller holding both through to the cache', async () => {
    const key = svc.exposureByMarketCacheKey({ tenant: 't1', whitelabelId: 't1' })
    cacheStore.set(key, { at: '2026-09-22T09:59:58.000Z', markets: [] })
    const got = await call(admin(BOTH))
    assert.deepEqual(got, { at: '2026-09-22T09:59:58.000Z', markets: [] })
    assert.deepEqual(cacheReads, [key])
  })
})

describe('the cache key is a security boundary', () => {
  it('differs across tenant, whitelabel, agent, non-agent admin and core mode', () => {
    const k = svc.exposureByMarketCacheKey
    const scopes = {
      core: {},
      coreAgent: { agent: { agentId: 'agent-1', playerIds: [1] } },
      adminA: { tenant: 'a', whitelabelId: 'a' },
      adminB: { tenant: 'b', whitelabelId: 'b' },
      adminA_wlOther: { tenant: 'a', whitelabelId: 'other' },
      adminA_noWl: { tenant: 'a' },
      wlOnly: { whitelabelId: 'a' },
      agent1A: { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'agent-1', playerIds: [1] } },
      agent2A: { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'agent-2', playerIds: [1] } },
      agent1B: { tenant: 'b', whitelabelId: 'b', agent: { agentId: 'agent-1', playerIds: [1] } },
      agentNoPlayersA: { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'agent-3', playerIds: [] } },
    }
    const seen = new Map<string, string>()
    for (const [name, s] of Object.entries(scopes)) {
      const value = k(s)
      assert.ok(!seen.has(value), `${name} and ${seen.get(value)} share the cache key ${value}`)
      seen.set(value, name)
    }
  })

  it('names core mode, a non-agent admin and an agent explicitly, under its own prefix', () => {
    const k = svc.exposureByMarketCacheKey
    assert.equal(k({}), 'live:exposure-by-market:v1|core|wl-any|admin')
    assert.equal(k({ tenant: 'a', whitelabelId: 'a' }), 'live:exposure-by-market:v1|tenant=a|wl=a|admin')
    assert.equal(
      k({ tenant: 'a', whitelabelId: 'a', agent: { agentId: 'x', playerIds: [] } }),
      'live:exposure-by-market:v1|tenant=a|wl=a|agent=x'
    )
  })

  it('never collides with the Real-time snapshot key for the same scope', () => {
    for (const s of [{}, { tenant: 'a', whitelabelId: 'a' }, { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'x', playerIds: [1] } }]) {
      assert.notEqual(svc.exposureByMarketCacheKey(s), realtimeSnapshotCacheKey(s))
    }
  })

  it('does not let a tenant, whitelabel or agent id forge another scope by embedding a separator', () => {
    const k = svc.exposureByMarketCacheKey
    assert.notEqual(k({ tenant: 'a|wl=b', whitelabelId: 'c' }), k({ tenant: 'a', whitelabelId: 'b|wl=c' }))
    assert.notEqual(k({ tenant: 'a', whitelabelId: 'a|admin' }), k({ tenant: 'a', whitelabelId: 'a' }))
    assert.notEqual(
      k({ tenant: 'a', whitelabelId: 'a', agent: { agentId: 'x|admin', playerIds: [] } }),
      k({ tenant: 'a', whitelabelId: 'a' })
    )
    assert.ok(!k({ tenant: 'a|core', whitelabelId: 'a' }).includes('|core|'))
    // A tenant literally called "core" is still a tenant, not core mode.
    assert.notEqual(k({ tenant: 'core' }), k({}))
    assert.notEqual(k({ tenant: 'a', whitelabelId: 'wl-any' }), k({ tenant: 'a' }))
  })

  it('is stable for the same scope and ignores the player list', () => {
    const k = svc.exposureByMarketCacheKey
    assert.equal(k({ tenant: 'a', whitelabelId: 'a' }), k({ tenant: 'a', whitelabelId: 'a' }))
    assert.equal(
      k({ tenant: 'a', whitelabelId: 'a', agent: { agentId: 'x', playerIds: [1] } }),
      k({ tenant: 'a', whitelabelId: 'a', agent: { agentId: 'x', playerIds: [1, 2] } })
    )
  })
})

describe('an agent with no players', () => {
  const now = new Date('2026-09-22T10:00:00.000Z')

  it('gets an empty reading from the service without a single read or query', async () => {
    const got = await svc.computeExposureByMarket({ tenant: 'a', whitelabelId: 'a', agent: { agentId: 'lonely', playerIds: [] } }, now)
    assert.deepEqual(got, { at: now.toISOString(), markets: [] })
    assert.deepEqual(readCalls, [], 'an agent with no players reached a read')
  })

  it('gets an empty reading in core mode too, without listing the whitelabels', async () => {
    const got = await svc.computeExposureByMarket({ agent: { agentId: 'lonely', playerIds: [] } }, now)
    assert.deepEqual(got, { at: now.toISOString(), markets: [] })
    assert.deepEqual(readCalls, [])
  })

  it('(harness check) an agent WITH players does reach the database, so the tests above mean something', async () => {
    await assert.rejects(
      () => svc.computeExposureByMarket({ tenant: 'a', whitelabelId: 'a', agent: { agentId: 'busy', playerIds: [1] } }, now),
      touchedTheDatabase
    )
    assert.ok(readCalls.includes('baseCurrency'))
  })

  it('gets an empty reading through the resolver, scoped by its own agent id and tenant', async () => {
    const seen: unknown[][] = []
    mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async (...a: unknown[]) => {
      seen.push(a)
      return []
    })
    const got = await call({
      user: { sub: 'agent-uuid-1', type: 'agent', agentId: 'agent-uuid-1', roles: [] },
      permissions: BOTH,
      tenant: 'tenant-a',
      whitelabel: { id: 'tenant-a' },
    })
    assert.deepEqual(seen, [['agent-uuid-1', 'tenant-a']])
    assert.deepEqual(got.markets, [])
    assert.ok(!Number.isNaN(Date.parse(got.at)), 'at is not an ISO time')
    assert.deepEqual(cacheReads, [
      svc.exposureByMarketCacheKey({ tenant: 'tenant-a', whitelabelId: 'tenant-a', agent: { agentId: 'agent-uuid-1', playerIds: [] } }),
    ])
    assert.deepEqual(readCalls, [])
  })

  it('an agent session with no agent id fails closed to an empty reading', async () => {
    let asked = false
    mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async () => {
      asked = true
      return [1, 2, 3]
    })
    const got = await call({ user: { sub: 'x', type: 'agent', roles: [] }, permissions: BOTH, tenant: 'tenant-a', whitelabel: { id: 'tenant-a' } })
    assert.equal(asked, false)
    assert.deepEqual(got.markets, [])
    assert.deepEqual(cacheReads, [])
    assert.deepEqual(readCalls, [])
  })
})

describe('a malformed scope', () => {
  // The cache key treats only `undefined` as core mode, but every SQL predicate tests truthiness,
  // so '' would read platform-wide under a non-core key. Refusing it is the only safe reading.
  const EMPTY_SCOPE = /empty tenant, whitelabel or agent id is not a valid scope/
  const now = new Date('2026-09-22T10:00:00.000Z')
  const cases: [string, Parameters<Svc['computeExposureByMarket']>[0]][] = [
    ['an empty tenant', { tenant: '', whitelabelId: 'a' }],
    ['an empty whitelabel id', { tenant: 'a', whitelabelId: '' }],
    ['an empty tenant and whitelabel id', { tenant: '', whitelabelId: '' }],
    ['an empty agent id', { tenant: 'a', whitelabelId: 'a', agent: { agentId: '', playerIds: [1] } }],
    ['an empty agent id with no players', { tenant: 'a', whitelabelId: 'a', agent: { agentId: '', playerIds: [] } }],
  ]

  for (const [name, scope] of cases) {
    it(`refuses ${name} instead of reading it as platform-wide`, async () => {
      // Matching the message matters: the pool stand-in rejects too, so a bare rejection would
      // also pass if the scope had reached the database.
      await assert.rejects(() => svc.computeExposureByMarket(scope, now), EMPTY_SCOPE)
      await assert.rejects(() => svc.getExposureByMarket(scope, now), EMPTY_SCOPE)
      assert.deepEqual(cacheReads, [], 'a malformed scope reached the cache')
      assert.deepEqual(cacheWrites, [], 'a malformed scope was written to the cache')
      assert.deepEqual(readCalls, [], 'a malformed scope reached a read')
    })
  }
})

describe('rows are merged by key and ordered', () => {
  const sport = (key: string, label: string, amount: number): Row => ({ key: `sports:${key}`, product: 'sports', label, amount })
  const matka = (amount: number): Row => ({ key: 'matka', product: 'matka', label: 'Matka', amount })

  it('adds a market that appears in several books, and orders by amount DESC then label ASC', () => {
    const got = svc.mergeMarketRows([
      [sport('cricket', 'Cricket', 100), sport('tennis', 'Tennis', 30), matka(5)],
      [sport('cricket', 'Cricket', 50), sport('football', 'Football', 30), matka(20)],
      [sport('basketball', 'Basketball', 30)],
    ])
    assert.deepEqual(got, [
      sport('cricket', 'Cricket', 150),
      sport('basketball', 'Basketball', 30),
      sport('football', 'Football', 30),
      sport('tennis', 'Tennis', 30),
      matka(25),
    ])
  })

  it('omits a market whose total is zero, and never a non-zero one', () => {
    const got = svc.mergeMarketRows([
      [sport('cricket', 'Cricket', 0), sport('golf', 'Golf', 0.01), matka(0)],
      [sport('cricket', 'Cricket', 0), matka(0)],
    ])
    assert.deepEqual(got, [sport('golf', 'Golf', 0.01)])
    assert.deepEqual(svc.mergeMarketRows([]), [])
    assert.deepEqual(svc.mergeMarketRows([[], []]), [])
  })

  it('breaks a tie on amount and label by key, so the order never depends on the input', () => {
    const a = sport('horse-racing-uk', 'Racing', 10)
    const b = sport('horse-racing-in', 'Racing', 10)
    assert.deepEqual(svc.mergeMarketRows([[a, b]]), [b, a])
    assert.deepEqual(svc.mergeMarketRows([[b, a]]), [b, a])
  })

  it('does not modify the books it is given', () => {
    const book = [sport('cricket', 'Cricket', 1)]
    svc.mergeMarketRows([book, [sport('cricket', 'Cricket', 2)]])
    assert.equal(book[0].amount, 1)
  })
})

describe('core mode reads every whitelabel in its own currency, then merges', () => {
  const now = new Date('2026-09-22T10:00:00.000Z')
  const books: Record<string, { sports: Row[]; matka: number }> = {
    'wl-a': {
      sports: [
        { key: 'sports:cricket', product: 'sports', label: 'Cricket', amount: 400 },
        { key: 'sports:tennis', product: 'sports', label: 'Tennis', amount: 50 },
        { key: 'sports:golf', product: 'sports', label: 'Golf', amount: 0 },
      ],
      matka: 0,
    },
    'wl-b': {
      sports: [
        { key: 'sports:cricket', product: 'sports', label: 'Cricket', amount: 100 },
        { key: 'sports:football', product: 'sports', label: 'Football', amount: 50 },
      ],
      matka: 1000,
    },
    'wl-usd': { sports: [{ key: 'sports:tennis', product: 'sports', label: 'Tennis', amount: 25 }], matka: 0 },
  }
  const currencies: Record<string, string> = { 'wl-a': 'INR', 'wl-b': 'INR', 'wl-usd': 'USD' }

  function standIn(): { sportsFilters: BookFilter[]; matkaFilters: BookFilter[]; currencyAsked: string[] } {
    const seen = { sportsFilters: [] as BookFilter[], matkaFilters: [] as BookFilter[], currencyAsked: [] as string[] }
    const reads = svc.exposureByMarketReads
    mock.method(reads, 'whitelabelIds', async () => Object.keys(books))
    mock.method(reads, 'baseCurrency', async (id: string) => {
      seen.currencyAsked.push(id)
      return currencies[id]
    })
    mock.method(reads, 'openSportsBySport', async (f: BookFilter) => {
      seen.sportsFilters.push(f)
      return books[f.tenant!].sports
    })
    mock.method(reads, 'openMatka', async (f: BookFilter) => {
      seen.matkaFilters.push(f)
      return books[f.tenant!].matka
    })
    return seen
  }

  const byTenant = (a: BookFilter, b: BookFilter) => (a.tenant! < b.tenant! ? -1 : 1)

  it('reads each whitelabel as tenant = whitelabel = its id, in its own base currency', async () => {
    const seen = standIn()
    await svc.computeExposureByMarket({}, now)
    const expected = [
      { tenant: 'wl-a', whitelabelId: 'wl-a', currency: 'INR', playerIds: undefined },
      { tenant: 'wl-b', whitelabelId: 'wl-b', currency: 'INR', playerIds: undefined },
      { tenant: 'wl-usd', whitelabelId: 'wl-usd', currency: 'USD', playerIds: undefined },
    ]
    assert.deepEqual([...seen.sportsFilters].sort(byTenant), expected)
    assert.deepEqual([...seen.matkaFilters].sort(byTenant), expected)
    assert.deepEqual([...seen.currencyAsked].sort(), ['wl-a', 'wl-b', 'wl-usd'])
  })

  it('adds the markets across whitelabels, drops the zero ones and orders them', async () => {
    standIn()
    const got = await svc.computeExposureByMarket({}, now)
    assert.equal(got.at, now.toISOString())
    assert.deepEqual(got.markets, [
      { key: 'matka', product: 'matka', label: 'Matka', amount: 1000 },
      { key: 'sports:cricket', product: 'sports', label: 'Cricket', amount: 500 },
      { key: 'sports:tennis', product: 'sports', label: 'Tennis', amount: 75 },
      { key: 'sports:football', product: 'sports', label: 'Football', amount: 50 },
    ])
  })

  it('keeps an agent’s player filter on every whitelabel it reads', async () => {
    const seen = standIn()
    await svc.computeExposureByMarket({ agent: { agentId: 'ag', playerIds: [7, 9] } }, now)
    assert.equal(seen.sportsFilters.length, 3)
    for (const f of [...seen.sportsFilters, ...seen.matkaFilters]) assert.deepEqual(f.playerIds, [7, 9])
  })

  it('reads one whitelabel, in the currency of its tenant, when a whitelabel is selected', async () => {
    const seen = standIn()
    const got = await svc.computeExposureByMarket({ tenant: 'wl-usd', whitelabelId: 'wl-usd' }, now)
    assert.deepEqual(seen.currencyAsked, ['wl-usd'])
    assert.deepEqual(seen.sportsFilters, [{ tenant: 'wl-usd', whitelabelId: 'wl-usd', currency: 'USD', playerIds: undefined }])
    assert.deepEqual(got.markets, [{ key: 'sports:tennis', product: 'sports', label: 'Tennis', amount: 25 }])
  })

  it('returns an empty reading when there are no whitelabels', async () => {
    standIn()
    mock.method(svc.exposureByMarketReads, 'whitelabelIds', async () => [])
    assert.deepEqual(await svc.computeExposureByMarket({}, now), { at: now.toISOString(), markets: [] })
  })
})

describe('the resolver picks the scope, and the cache serves only that scope', () => {
  const canned = (n: number) => ({
    at: '2026-09-22T09:59:58.000Z',
    markets: [{ key: 'sports:cricket', product: 'sports', label: 'Cricket', amount: n }],
  })

  it('serves a whitelabel admin from its own tenant key, keeping the cached time', async () => {
    const own = svc.exposureByMarketCacheKey({ tenant: 'tenant-a', whitelabelId: 'tenant-a' })
    cacheStore.set(own, canned(7))
    cacheStore.set(svc.exposureByMarketCacheKey({}), canned(999))
    cacheStore.set(svc.exposureByMarketCacheKey({ tenant: 'tenant-b', whitelabelId: 'tenant-b' }), canned(555))
    const got = await call(admin(BOTH, { tenant: 'tenant-a', whitelabel: { id: 'tenant-a' } }))
    assert.deepEqual(got, canned(7))
    assert.deepEqual(cacheReads, [own])
  })

  it('serves a director in core mode from the core key', async () => {
    cacheStore.set(svc.exposureByMarketCacheKey({}), canned(42))
    const got = await call({
      user: { sub: '1', type: 'admin', roles: ['Super Admin'] },
      permissions: [{ domain: 'all', actions: ['*'] }],
      directorMode: 'core',
      tenant: 'default',
      whitelabel: { id: 'default' },
    })
    assert.deepEqual(got, canned(42))
    assert.deepEqual(cacheReads, [svc.exposureByMarketCacheKey({})])
  })

  it('serves a director in whitelabel mode from the selected whitelabel key', async () => {
    const chosen = svc.exposureByMarketCacheKey({ tenant: 'tenant-c', whitelabelId: 'tenant-c' })
    cacheStore.set(chosen, canned(3))
    const got = await call({
      user: { sub: '1', type: 'admin', roles: ['Super Admin'] },
      permissions: [{ domain: 'all', actions: ['*'] }],
      directorMode: 'whitelabel',
      directorWhitelabelId: 'tenant-c',
      tenant: 'default',
      whitelabel: { id: 'default' },
    })
    assert.deepEqual(got, canned(3))
    assert.deepEqual(cacheReads, [chosen])
  })

  it('never serves an agent the tenant-wide admin entry', async () => {
    cacheStore.set(svc.exposureByMarketCacheKey({ tenant: 'tenant-a', whitelabelId: 'tenant-a' }), canned(100))
    mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async () => [])
    const got = await call({
      user: { sub: 'ag', type: 'agent', agentId: 'ag', roles: [] },
      permissions: BOTH,
      tenant: 'tenant-a',
      whitelabel: { id: 'tenant-a' },
    })
    assert.deepEqual(got.markets, [], 'an agent was served the tenant-wide cached reading')
  })

  it('writes a fresh reading back under the key it read', async () => {
    const scope = { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'z', playerIds: [] } }
    await svc.getExposureByMarket(scope, new Date('2026-09-22T10:00:00.000Z'))
    assert.equal(cacheWrites.length, 1)
    assert.equal(cacheWrites[0].key, svc.exposureByMarketCacheKey(scope))
    assert.deepEqual(cacheWrites[0].data, { at: '2026-09-22T10:00:00.000Z', markets: [] })
  })
})

describe('a cached value that fails the shape check', () => {
  const scope = { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'z', playerIds: [] } }
  const now = new Date('2026-09-22T10:00:00.000Z')
  const row = { key: 'sports:cricket', product: 'sports', label: 'Cricket', amount: 5 }
  const malformed: [string, unknown][] = [
    ['a value with no markets', { at: '2026-09-22T09:00:00.000Z' }],
    ['markets that are not a list', { at: '2026-09-22T09:00:00.000Z', markets: { cricket: 5 } }],
    ['a value with no time', { markets: [row] }],
    ['a row whose amount is a string', { at: 'x', markets: [{ ...row, amount: '5' }] }],
    ['a row whose amount is null (NaN after JSON)', { at: 'x', markets: [{ ...row, amount: null }] }],
    ['a row from a product this card does not show', { at: 'x', markets: [{ ...row, product: 'casino' }] }],
    ['a row with no key', { at: 'x', markets: [{ product: 'sports', label: 'Cricket', amount: 5 }] }],
    ['a row with no label', { at: 'x', markets: [{ key: 'matka', product: 'matka', amount: 5 }] }],
    ['a list with a null row', { at: 'x', markets: [row, null] }],
    ['a bare number', 42],
  ]

  for (const [name, value] of malformed) {
    it(`is ignored and recomputed: ${name}`, async () => {
      cacheStore.set(svc.exposureByMarketCacheKey(scope), value)
      const got = await svc.getExposureByMarket(scope, now)
      assert.deepEqual(got, { at: now.toISOString(), markets: [] })
      assert.equal(cacheWrites.length, 1, 'the recomputed reading was not written back')
    })
  }

  it('(harness check) a well-formed cached value is served as it is', async () => {
    const good = { at: '2026-09-22T09:59:59.000Z', markets: [row] }
    cacheStore.set(svc.exposureByMarketCacheKey(scope), good)
    assert.deepEqual(await svc.getExposureByMarket(scope, now), good)
    assert.equal(cacheWrites.length, 0)
  })
})

describe('the schema matches the contract', () => {
  const show = (t: TypeNode): string =>
    t.kind === Kind.NON_NULL_TYPE ? `${show(t.type)}!` : t.kind === Kind.LIST_TYPE ? `[${show(t.type)}]` : t.name.value

  async function fieldsOf(name: string): Promise<Record<string, string>> {
    const { typeDefs } = await import('@src/types/graphql.js')
    const type = parse(typeDefs).definitions.find(
      (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === name
    )
    assert.ok(type, `${name} is not declared`)
    return Object.fromEntries((type.fields ?? []).map((f) => [f.name.value, show(f.type)]))
  }

  it('declares ExposureByMarket and ExposureByMarketRow with exactly the agreed fields', async () => {
    assert.deepEqual(await fieldsOf('ExposureByMarket'), { at: 'String!', markets: '[ExposureByMarketRow!]!' })
    assert.deepEqual(await fieldsOf('ExposureByMarketRow'), {
      key: 'String!',
      product: 'String!',
      label: 'String!',
      amount: 'Float!',
    })
  })

  it('exposes Query.exposureByMarket: ExposureByMarket! with no arguments', async () => {
    const { typeDefs } = await import('@src/types/graphql.js')
    const found = parse(typeDefs)
      .definitions.filter(
        (d): d is ObjectTypeDefinitionNode | ObjectTypeExtensionNode =>
          (d.kind === Kind.OBJECT_TYPE_DEFINITION || d.kind === Kind.OBJECT_TYPE_EXTENSION) && d.name.value === 'Query'
      )
      .flatMap((d) => d.fields ?? [])
      .filter((f) => f.name.value === 'exposureByMarket')
    assert.equal(found.length, 1, 'exposureByMarket must be declared exactly once on Query')
    assert.equal((found[0].arguments ?? []).length, 0, 'exposureByMarket must take no arguments (in particular no dateRange)')
    assert.equal(show(found[0].type), 'ExposureByMarket!')
  })

  it('is visible to probe:admin-authz, which finds Query fields with a line regex', async () => {
    // Copied from parseFields in scripts/probeAdminAuthz.ts; keep the two in step. Its optional
    // "(args)" group is lazy and may run across lines, so a docstring line such as
    // "  window (activityWindowMins), ..." once swallowed realtimeSnapshot, this field and
    // paymentAnalytics, and the probe silently never called them.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src', 'types', 'operations', 'queries.graphql'), 'utf8')
    const re = /^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*(\(([\s\S]*?)\))?\s*:\s*[A-Za-z[]/gm
    const names: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) names.push(m[1])
    assert.ok(names.includes('exposureByMarket'), 'probe:admin-authz cannot see Query.exposureByMarket')
    assert.ok(names.includes('realtimeSnapshot'), 'probe:admin-authz cannot see Query.realtimeSnapshot')
  })
})
