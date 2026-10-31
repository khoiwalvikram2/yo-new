/**
 * Unit tests for Query.realtimeSnapshot and its service. No database, no Redis.
 *
 * The pg pool is replaced by one that throws, so any test here that would have
 * issued a query fails loudly instead of quietly reading the shared database;
 * QueryCache is replaced by an in-memory stand-in for the same reason.
 *
 *   node --env-file-if-exists=.env --test --import tsx src/services/__tests__/realtimeSnapshotService.test.ts
 */
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { parse, Kind, type ObjectTypeDefinitionNode, type ObjectTypeExtensionNode } from 'graphql'

type Svc = typeof import('@src/services/realtimeSnapshotService.js')

let svc: Svc
let Query: Record<string, (...a: any[]) => Promise<any>>
let QueryCache: (typeof import('@src/services/QueryCache.js'))['QueryCache']
let PlayerAuthService: (typeof import('@src/domains/players/services/PlayerAuthService.js'))['PlayerAuthService']
let pool: (typeof import('@src/db/client.js'))['pool']

const DASHBOARD = [{ domain: 'overview.dashboard', actions: ['view'] }]
const FORBIDDEN = /Forbidden: insufficient permissions to view dashboard/

/** Keys read from and written to the cache stand-in during one test. */
let cacheReads: string[] = []
let cacheWrites: { key: string; data: unknown }[] = []
let cacheStore = new Map<string, unknown>()

before(async () => {
  svc = await import('@src/services/realtimeSnapshotService.js')
  ;({ commonQueryResolvers: Query } = (await import('@src/domains/common/resolvers/queries.js')) as any)
  ;({ QueryCache } = await import('@src/services/QueryCache.js'))
  ;({ PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js'))
  ;({ pool } = await import('@src/db/client.js'))
})

beforeEach(() => {
  cacheReads = []
  cacheWrites = []
  cacheStore = new Map()
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
})

afterEach(() => {
  mock.restoreAll()
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

const call = (ctx: unknown) => Query.realtimeSnapshot(undefined, {}, ctx, undefined)

describe('the permission gate', () => {
  it('refuses a signed-in caller holding nothing', async () => {
    await assert.rejects(
      () => call({ user: { sub: '1', type: 'admin', roles: [] }, permissions: [], tenant: 't1', whitelabel: { id: 't1' } }),
      FORBIDDEN
    )
  })

  it('refuses a caller whose permissions are missing entirely', async () => {
    await assert.rejects(() => call({ user: { sub: '1', type: 'admin', roles: [] }, tenant: 't1' }), FORBIDDEN)
    await assert.rejects(() => call(undefined), FORBIDDEN)
  })

  it('refuses a caller holding only an unrelated permission', async () => {
    await assert.rejects(
      () =>
        call({
          user: { sub: '1', type: 'admin', roles: [] },
          permissions: [{ domain: 'casino', actions: ['read'] }],
          tenant: 't1',
          whitelabel: { id: 't1' },
        }),
      FORBIDDEN
    )
  })

  it('refuses before reading the cache or the database', async () => {
    await assert.rejects(() => call({ user: { sub: '1', type: 'admin', roles: [] }, permissions: [], tenant: 't1' }), FORBIDDEN)
    assert.deepEqual(cacheReads, [], 'the cache was consulted for a caller who is not allowed to see the card')
  })
})

describe('the cache key is a security boundary', () => {
  it('differs across tenant, whitelabel, agent, non-agent admin and core mode', () => {
    const k = svc.realtimeSnapshotCacheKey
    const scopes = {
      core: {},
      adminA: { tenant: 'a', whitelabelId: 'a' },
      adminB: { tenant: 'b', whitelabelId: 'b' },
      adminA_wlOther: { tenant: 'a', whitelabelId: 'other' },
      adminA_noWl: { tenant: 'a' },
      agent1A: { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'agent-1', playerIds: [1] } },
      agent2A: { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'agent-2', playerIds: [1] } },
      agent1B: { tenant: 'b', whitelabelId: 'b', agent: { agentId: 'agent-1', playerIds: [1] } },
      agentNoPlayersA: { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'agent-3', playerIds: [] } },
    }
    const keys = Object.entries(scopes).map(([name, s]) => [name, k(s)] as const)
    const seen = new Map<string, string>()
    for (const [name, value] of keys) {
      assert.ok(!seen.has(value), `${name} and ${seen.get(value)} share the cache key ${value}`)
      seen.set(value, name)
    }
  })

  it('names core mode, a non-agent admin and an agent explicitly', () => {
    const k = svc.realtimeSnapshotCacheKey
    assert.match(k({}), /\|core\|/)
    assert.match(k({ tenant: 'a', whitelabelId: 'a' }), /\|admin$/)
    assert.match(k({ tenant: 'a', whitelabelId: 'a', agent: { agentId: 'x', playerIds: [] } }), /\|agent=x$/)
  })

  it('does not let a tenant or agent id forge another scope by embedding a separator', () => {
    const k = svc.realtimeSnapshotCacheKey
    assert.notEqual(k({ tenant: 'a|wl=b', whitelabelId: 'c' }), k({ tenant: 'a', whitelabelId: 'b|wl=c' }))
    assert.notEqual(k({ tenant: 'a', whitelabelId: 'a|admin' }), k({ tenant: 'a', whitelabelId: 'a' }))
    assert.notEqual(
      k({ tenant: 'a', whitelabelId: 'a', agent: { agentId: 'x|admin', playerIds: [] } }),
      k({ tenant: 'a', whitelabelId: 'a' })
    )
    // A tenant literally called "core" is still a tenant, not core mode.
    assert.notEqual(k({ tenant: 'core' }), k({}))
  })

  it('is stable for the same scope', () => {
    const k = svc.realtimeSnapshotCacheKey
    assert.equal(k({ tenant: 'a', whitelabelId: 'a' }), k({ tenant: 'a', whitelabelId: 'a' }))
  })
})

describe('an agent with no players', () => {
  it('gets zeros from the service without a single query', async () => {
    const now = new Date('2026-09-22T10:00:00.000Z')
    const got = await svc.computeRealtimeSnapshot(
      { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'lonely', playerIds: [] } },
      now
    )
    assert.deepEqual(got, {
      at: now.toISOString(),
      activePlayers: 0,
      activityWindowMins: 5,
      activeBets: 0,
      depositsLastHour: 0,
      withdrawalsLastHour: 0,
    })
  })

  it('(harness check) an agent WITH players does reach the database, so the test above means something', async () => {
    await assert.rejects(
      () =>
        svc.computeRealtimeSnapshot(
          { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'busy', playerIds: [1] } },
          new Date('2026-09-22T10:00:00.000Z')
        ),
      // drizzle wraps the driver error as "Failed query: ..." with the original as `cause`.
      (e: any) => /unit test touched the database/.test(`${e?.message} ${e?.cause?.message}`)
    )
  })

  it('gets zeros through the resolver, scoped by its own agent id and tenant', async () => {
    const seen: unknown[][] = []
    mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async (...a: unknown[]) => {
      seen.push(a)
      return []
    })
    const got = await call({
      user: { sub: 'agent-uuid-1', type: 'agent', agentId: 'agent-uuid-1', roles: [] },
      permissions: DASHBOARD,
      tenant: 'tenant-a',
      whitelabel: { id: 'tenant-a' },
    })
    assert.deepEqual(seen, [['agent-uuid-1', 'tenant-a']])
    assert.equal(got.activePlayers, 0)
    assert.equal(got.activeBets, 0)
    assert.equal(got.depositsLastHour, 0)
    assert.equal(got.withdrawalsLastHour, 0)
    assert.equal(got.activityWindowMins, 5)
    assert.ok(!Number.isNaN(Date.parse(got.at)), 'at is not an ISO time')
    assert.deepEqual(cacheReads, [
      svc.realtimeSnapshotCacheKey({ tenant: 'tenant-a', whitelabelId: 'tenant-a', agent: { agentId: 'agent-uuid-1', playerIds: [] } }),
    ])
  })

  it('an agent session with no agent id fails closed to zeros', async () => {
    let asked = false
    mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async () => {
      asked = true
      return [1, 2, 3]
    })
    const got = await call({
      user: { sub: 'x', type: 'agent', roles: [] },
      permissions: DASHBOARD,
      tenant: 'tenant-a',
      whitelabel: { id: 'tenant-a' },
    })
    assert.equal(asked, false)
    assert.equal(got.activePlayers + got.activeBets + got.depositsLastHour + got.withdrawalsLastHour, 0)
  })
})

describe('a malformed scope', () => {
  // The cache key treats only `undefined` as core mode, but every SQL predicate tests truthiness,
  // so '' would run platform-wide under a non-core key. Refusing it is the only safe reading.
  const EMPTY_SCOPE = /empty tenant, whitelabel or agent id is not a valid scope/
  const now = new Date('2026-09-22T10:00:00.000Z')
  const cases: [string, Parameters<Svc['computeRealtimeSnapshot']>[0]][] = [
    ['an empty tenant', { tenant: '', whitelabelId: 'a' }],
    ['an empty whitelabel id', { tenant: 'a', whitelabelId: '' }],
    ['an empty agent id', { tenant: 'a', whitelabelId: 'a', agent: { agentId: '', playerIds: [1] } }],
  ]

  for (const [name, scope] of cases) {
    it(`refuses ${name} instead of reading it as platform-wide`, async () => {
      // Matching the message matters: the pool stand-in rejects too, so a bare rejection would
      // also pass if the scope had reached the database.
      await assert.rejects(() => svc.computeRealtimeSnapshot(scope, now), EMPTY_SCOPE)
      await assert.rejects(() => svc.getRealtimeSnapshot(scope, now), EMPTY_SCOPE)
      assert.deepEqual(cacheReads, [], 'a malformed scope reached the cache')
      assert.deepEqual(cacheWrites, [], 'a malformed scope was written to the cache')
    })
  }
})

describe('the resolver picks the scope, and the cache serves only that scope', () => {
  const canned = (n: number) => ({
    at: '2026-09-22T09:59:58.000Z',
    activePlayers: n,
    activityWindowMins: 5,
    activeBets: n,
    depositsLastHour: n,
    withdrawalsLastHour: n,
  })

  it('serves a whitelabel admin from its own tenant key, keeping the cached time', async () => {
    const own = svc.realtimeSnapshotCacheKey({ tenant: 'tenant-a', whitelabelId: 'tenant-a' })
    cacheStore.set(own, canned(7))
    cacheStore.set(svc.realtimeSnapshotCacheKey({}), canned(999))
    cacheStore.set(svc.realtimeSnapshotCacheKey({ tenant: 'tenant-b', whitelabelId: 'tenant-b' }), canned(555))
    const got = await call({
      user: { sub: '1', type: 'admin', roles: ['Whitelabel Admin'] },
      permissions: DASHBOARD,
      tenant: 'tenant-a',
      whitelabel: { id: 'tenant-a' },
    })
    assert.deepEqual(got, canned(7))
    assert.deepEqual(cacheReads, [own])
  })

  it('serves a director in core mode from the core key', async () => {
    cacheStore.set(svc.realtimeSnapshotCacheKey({}), canned(42))
    const got = await call({
      user: { sub: '1', type: 'admin', roles: ['Super Admin'] },
      permissions: [{ domain: 'all', actions: ['*'] }],
      directorMode: 'core',
      tenant: 'default',
      whitelabel: { id: 'default' },
    })
    assert.deepEqual(got, canned(42))
    assert.deepEqual(cacheReads, [svc.realtimeSnapshotCacheKey({})])
  })

  it('serves a director in whitelabel mode from the selected whitelabel key', async () => {
    const chosen = svc.realtimeSnapshotCacheKey({ tenant: 'tenant-c', whitelabelId: 'tenant-c' })
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
    cacheStore.set(svc.realtimeSnapshotCacheKey({ tenant: 'tenant-a', whitelabelId: 'tenant-a' }), canned(100))
    mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async () => [])
    const got = await call({
      user: { sub: 'ag', type: 'agent', agentId: 'ag', roles: [] },
      permissions: DASHBOARD,
      tenant: 'tenant-a',
      whitelabel: { id: 'tenant-a' },
    })
    assert.equal(got.activePlayers, 0, 'an agent was served the tenant-wide cached reading')
  })

  it('writes a fresh reading back under the key it read', async () => {
    const scope = { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'z', playerIds: [] } }
    await svc.getRealtimeSnapshot(scope, new Date('2026-09-22T10:00:00.000Z'))
    assert.equal(cacheWrites.length, 1)
    assert.equal(cacheWrites[0].key, svc.realtimeSnapshotCacheKey(scope))
  })

  it('ignores a malformed cache entry and computes instead', async () => {
    const scope = { tenant: 'a', whitelabelId: 'a', agent: { agentId: 'z', playerIds: [] } }
    cacheStore.set(svc.realtimeSnapshotCacheKey(scope), { activePlayers: 'lots' })
    const got = await svc.getRealtimeSnapshot(scope, new Date('2026-09-22T10:00:00.000Z'))
    assert.equal(got.activePlayers, 0)
  })
})

describe('the schema matches the contract', () => {
  it('declares RealtimeSnapshot with exactly the agreed fields', async () => {
    const { typeDefs } = await import('@src/types/graphql.js')
    const doc = parse(typeDefs)
    const type = doc.definitions.find(
      (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'RealtimeSnapshot'
    )
    assert.ok(type, 'RealtimeSnapshot is not declared')
    const fields = Object.fromEntries(
      (type.fields ?? []).map((f) => {
        const t = f.type
        const shown = t.kind === Kind.NON_NULL_TYPE && t.type.kind === Kind.NAMED_TYPE ? `${t.type.name.value}!` : 'other'
        return [f.name.value, shown]
      })
    )
    assert.deepEqual(fields, {
      at: 'String!',
      activePlayers: 'Int!',
      activityWindowMins: 'Int!',
      activeBets: 'Int!',
      depositsLastHour: 'Float!',
      withdrawalsLastHour: 'Float!',
    })
  })

  it('exposes Query.realtimeSnapshot: RealtimeSnapshot! with no arguments', async () => {
    const { typeDefs } = await import('@src/types/graphql.js')
    const doc = parse(typeDefs)
    const found = doc.definitions
      .filter(
        (d): d is ObjectTypeDefinitionNode | ObjectTypeExtensionNode =>
          (d.kind === Kind.OBJECT_TYPE_DEFINITION || d.kind === Kind.OBJECT_TYPE_EXTENSION) && d.name.value === 'Query'
      )
      .flatMap((d) => d.fields ?? [])
      .filter((f) => f.name.value === 'realtimeSnapshot')
    assert.equal(found.length, 1, 'realtimeSnapshot must be declared exactly once on Query')
    const field = found[0]
    assert.equal((field.arguments ?? []).length, 0, 'realtimeSnapshot must take no arguments (in particular no dateRange)')
    assert.ok(
      field.type.kind === Kind.NON_NULL_TYPE && field.type.type.kind === Kind.NAMED_TYPE && field.type.type.name.value === 'RealtimeSnapshot',
      'realtimeSnapshot must return RealtimeSnapshot!'
    )
  })
})
