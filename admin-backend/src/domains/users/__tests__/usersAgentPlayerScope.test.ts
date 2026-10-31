/**
 * Agents and the users-domain player mutations, and the admin createPlayer path.
 *
 * The users-domain mutations that act on one player (status, betting flags,
 * bonus eligibility, VIP tier, password-reset flag, withdrawal lock, remark,
 * force logout, limits, wallet) checked only a permission and the tenant.
 * Agents hold those permissions through flat `users:write`, so any agent could
 * act on any player in its whitelabel. They now run the same agent -> player
 * guard as the players-domain mutations (closure-table subtree plus
 * referral-linked players).
 *
 * The admin createPlayer path refused a credit limit of 0 for AGENT_CREDIT,
 * looked the owning agent up across tenants, and deducted the agent's credit
 * outside the player's transaction without a lock.
 *
 * No test here reaches the database: the pg pool is replaced by a tripwire,
 * and the creation transaction by a fake that records what would be written.
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { pool, db } from '@src/db/client.js'
import { PlayerAuthService } from '@src/domains/players/services/PlayerAuthService.js'
import { AgentsRepo } from '@/repos/agents/AgentsRepo.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'
import { usersMutationResolvers } from '../resolvers/mutations.js'
import { usersQueryResolvers } from '../resolvers/queries.js'
import {
  normalizeCreditLimit,
  resolveOwningAgentForCreate,
  type OwningAgentRow,
} from '../resolvers/createPlayerRules.js'

const TENANT = 'w2-test-tenant'
const AGENT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_AGENT_ID = '22222222-2222-4222-8222-222222222222'
const OWN_PLAYER = 101
const OUTSIDE_PLAYER = 999

let dbTouches = 0

function agentCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenant: TENANT,
    user: { type: 'agent', agentId: AGENT_ID, sub: AGENT_ID, isReadOnly: false, ...overrides },
    permissions: deriveAgentPermissions(['sports', 'casino', 'matka']),
  }
}

function adminCtx() {
  return {
    tenant: TENANT,
    user: { sub: '1', roles: ['Whitelabel Admin'] },
    permissions: [{ domain: 'all', actions: ['*'] }],
  }
}

/** A drizzle-shaped chain whose every call returns itself and which awaits to `result`. */
function chain(result: unknown): any {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej)
      return () => chain(result)
    },
    apply() {
      return chain(result)
    },
  })
}

/** A transaction stand-in: reads return nothing; the first insert is recorded and aborts the transaction. */
function fakeTx(inserts: Array<{ table: unknown; values: any }>) {
  return {
    select: () => chain([]),
    update: () => chain([]),
    execute: async () => ({ rows: [] }),
    insert: (table: unknown) => ({
      values: (values: any) => {
        inserts.push({ table, values })
        throw new Error('CAPTURED_INSERT')
      },
    }),
  }
}

beforeEach(() => {
  dbTouches = 0
  // Tripwire: anything that would reach PostgreSQL fails loudly instead.
  mock.method(pool as any, 'query', async () => {
    dbTouches++
    throw new Error('DB_TOUCHED')
  })
  mock.method(pool as any, 'connect', async () => {
    dbTouches++
    throw new Error('DB_TOUCHED')
  })
  // The agent's player scope: players 101 and 102 only.
  mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async () => [OWN_PLAYER, 102])
})

afterEach(() => {
  mock.restoreAll()
})

const call = (name: string, args: any, ctx: any) => (usersMutationResolvers as any)[name](null, args, ctx)

const PLAYER_MUTATIONS: Array<[string, (id: string) => any]> = [
  ['setUserDomainBets', (id) => ({ id, sports: false })],
  ['setUserBonusAllowed', (id) => ({ id, allow: false })],
  ['setUserStatus', (id) => ({ id, status: 'SUSPENDED' })],
  ['setRequirePasswordReset', (id) => ({ id, require: true })],
  ['setWithdrawalLock', (id) => ({ id, lock: true })],
  ['updatePlayerRemark', (id) => ({ userId: id, remark: 'note' })],
  ['forceLogoutUser', (id) => ({ id })],
  ['upsertPlayerLimits', (id) => ({ input: { userId: id, dailyStakeLimit: 100 } })],
  ['adjustWallet', (id) => ({ userId: id, amount: 100 })],
]

describe('users-domain player mutations, agent callers', () => {
  for (const [name, args] of PLAYER_MUTATIONS) {
    it(`${name}: refuses a player outside the agent's subtree before touching the database`, async () => {
      await assert.rejects(() => call(name, args(String(OUTSIDE_PLAYER)), agentCtx()), /Unauthorized/)
      assert.equal(dbTouches, 0, `${name} reached the database for a player it may not act on`)
    })

    it(`${name}: lets the agent through to its own player`, async () => {
      await assert.rejects(
        () => call(name, args(String(OWN_PLAYER)), agentCtx()),
        (err: Error) => !/Unauthorized/.test(err.message),
      )
    })
  }

  it('setUserVipTier: agents are refused for any player, their own included, before the database', async () => {
    // A tier decides deposit methods and limits; the drawer never offered it to agents.
    for (const id of [OWN_PLAYER, OUTSIDE_PLAYER]) {
      await assert.rejects(() => call('setUserVipTier', { id: String(id), vipTierId: '00000000-0000-4000-8000-000000000001' }, agentCtx()),
        /Agents cannot set player VIP tiers/)
    }
    assert.equal(dbTouches, 0)
  })

  it('the guard is a no-op for admins (the tenant filter scopes them)', async () => {
    const scope = mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async () => [])
    await assert.rejects(
      () => call('setUserStatus', { id: String(OUTSIDE_PLAYER), status: 'SUSPENDED' }, adminCtx()),
      (err: Error) => !/Unauthorized/.test(err.message),
    )
    assert.equal(scope.mock.callCount(), 0)
  })

  it('adjustWallet: a CREDIT agent cannot mint cash from the whitelabel pool, even for its own player', async () => {
    mock.method(AgentsRepo.prototype, 'findById', async () => ({ id: AGENT_ID, schemeType: 'CREDIT', tenantId: TENANT }) as any)
    await assert.rejects(
      () => call('adjustWallet', { userId: String(OWN_PLAYER), amount: 500 }, agentCtx()),
      /Agents cannot adjust player balances directly/,
    )
    assert.equal(dbTouches, 0)
  })
})

describe('createPlayer rules (admin path)', () => {
  it('accepts a credit limit of 0, and treats a missing one as 0', () => {
    assert.equal(normalizeCreditLimit(0), 0)
    assert.equal(normalizeCreditLimit(undefined), 0)
    assert.equal(normalizeCreditLimit(null), 0)
    assert.equal(normalizeCreditLimit(250), 250)
  })

  it('still refuses a negative or non-numeric limit', () => {
    assert.throws(() => normalizeCreditLimit(-1), /cannot be negative/)
    assert.throws(() => normalizeCreditLimit('abc'), /must be a number/)
  })

  const repoWith = (rows: OwningAgentRow[]) => ({
    async findByIdScoped(id: string, tenantId: string) {
      return rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null
    },
  })
  const credit = (over: Partial<OwningAgentRow> = {}): OwningAgentRow => ({
    id: AGENT_ID,
    tenantId: TENANT,
    schemeType: 'CREDIT',
    status: 'ACTIVE',
    allowedDomains: ['sports'],
    ...over,
  })

  it('refuses an agent from another tenant', async () => {
    const repo = repoWith([credit({ tenantId: 'another-whitelabel' })])
    await assert.rejects(() => resolveOwningAgentForCreate(repo, AGENT_ID, TENANT, 'AGENT_CREDIT'), /Agent not found/)
  })

  it('refuses an agent that is not ACTIVE', async () => {
    const repo = repoWith([credit({ status: 'SUSPENDED' })])
    await assert.rejects(() => resolveOwningAgentForCreate(repo, AGENT_ID, TENANT, 'AGENT_CREDIT'), /not active/)
  })

  it('refuses a scheme that does not match the player type', async () => {
    const repo = repoWith([credit({ schemeType: 'SHARING' })])
    await assert.rejects(
      () => resolveOwningAgentForCreate(repo, AGENT_ID, TENANT, 'AGENT_CREDIT'),
      /AGENT_CREDIT players can only be created under CREDIT agents/,
    )
  })

  it('accepts an ACTIVE agent of the right scheme in the caller tenant', async () => {
    const agent = await resolveOwningAgentForCreate(repoWith([credit()]), AGENT_ID, TENANT, 'AGENT_CREDIT')
    assert.equal(agent.id, AGENT_ID)
  })
})

describe('createPlayer resolver (admin path)', () => {
  const baseInput = {
    name: 'W2 Test',
    phone: '9000000001',
    password: 'longenough1',
    playerType: 'AGENT_CREDIT',
    agentId: AGENT_ID,
  }

  beforeEach(() => {
    mock.method((db as any).query.appConfigs, 'findFirst', async () => null)
    mock.method(AgentsRepo.prototype, 'getCreditFields', async () => ({
      creditLimit: 1000, creditUsed: 0, creditAvailable: 1000, creditAlertThreshold: 80,
      settlementBalance: 0, settlementBalanceSports: 0, settlementBalanceCasino: 0, settlementBalanceMatka: 0,
    }))
  })

  it('refuses agent callers, who have createPlayerForAgent', async () => {
    await assert.rejects(() => call('createPlayer', { input: { ...baseInput } }, agentCtx()), /createPlayerForAgent/)
    assert.equal(dbTouches, 0)
  })

  it('refuses an owning agent from another tenant', async () => {
    mock.method(AgentsRepo.prototype, 'findById', async (id: string) =>
      ({ id, tenantId: 'another-whitelabel', schemeType: 'CREDIT', status: 'ACTIVE', allowedDomains: ['sports'] }) as any,
    )
    await assert.rejects(
      () => call('createPlayer', { input: { ...baseInput, creditLimit: 0, agentId: OTHER_AGENT_ID } }, adminCtx()),
      /Agent not found/,
    )
    assert.equal(dbTouches, 0)
  })

  it('accepts creditLimit 0 for AGENT_CREDIT and allocates nothing from the agent', async () => {
    mock.method(AgentsRepo.prototype, 'findById', async (id: string) =>
      ({ id, tenantId: TENANT, schemeType: 'CREDIT', status: 'ACTIVE', allowedDomains: ['sports', 'casino'] }) as any,
    )
    const lock = mock.method(AgentsRepo.prototype, 'lockAndUpdateCredit', async () => ({}) as any)
    const inserts: Array<{ table: unknown; values: any }> = []
    mock.method(db as any, 'transaction', async (cb: (tx: any) => Promise<unknown>) => cb(fakeTx(inserts)))

    await assert.rejects(
      () => call('createPlayer', { input: { ...baseInput, creditLimit: 0, matkaBetAllowed: true, matkaVisible: true } }, adminCtx()),
      /CAPTURED_INSERT/,
    )
    assert.equal(lock.mock.callCount(), 0)
    assert.equal(inserts.length, 1)
    const row = inserts[0].values
    assert.equal(row.playerType, 'AGENT_CREDIT')
    assert.equal(row.agentId, AGENT_ID)
    assert.equal(row.creditLimit, '0')
    // The agent has no matka, so the admin's matka toggles are capped off.
    assert.equal(row.matkaBetAllowed, false)
    assert.equal(row.matkaVisible, false)
    assert.equal(row.sportsBetAllowed, true)
  })

  it('deducts the agent credit as a locked delta on the same transaction, before the player insert', async () => {
    mock.method(AgentsRepo.prototype, 'findById', async (id: string) =>
      ({ id, tenantId: TENANT, schemeType: 'CREDIT', status: 'ACTIVE', allowedDomains: ['sports'] }) as any,
    )
    const order: string[] = []
    const inserts: Array<{ table: unknown; values: any }> = []
    let txSeen: unknown = null
    const lock = mock.method(AgentsRepo.prototype, 'lockAndUpdateCredit', async (_id: string, _u: any, tx: unknown) => {
      order.push('lock')
      assert.equal(tx, txSeen, 'the credit lock must run on the creation transaction')
      return {} as any
    })
    mock.method(db as any, 'transaction', async (cb: (tx: any) => Promise<unknown>) => {
      const tx = fakeTx(inserts)
      const insert = tx.insert
      tx.insert = (table: unknown) => {
        order.push('insert')
        return insert(table)
      }
      txSeen = tx
      return cb(tx)
    })

    await assert.rejects(() => call('createPlayer', { input: { ...baseInput, creditLimit: 250 } }, adminCtx()), /CAPTURED_INSERT/)
    assert.equal(lock.mock.callCount(), 1)
    const [agentId, update] = lock.mock.calls[0].arguments as [string, any]
    assert.equal(agentId, AGENT_ID)
    assert.deepEqual(update, { creditUsedDelta: 250, requireAvailableForDelta: true })
    assert.deepEqual(order, ['lock', 'insert'])
  })
})

describe('agent hierarchy reads, agent callers', () => {
  // ROOT -> SELF -> CHILD, and ROOT -> SIBLING. The caller is SELF.
  const ROOT = '44444444-4444-4444-8444-444444444444'
  const SIBLING = '55555555-5555-4555-8555-555555555555'
  const CHILD = '66666666-6666-4666-8666-666666666666'
  const SELF = AGENT_ID
  const tree = [
    { id: ROOT, parentAgentId: null, username: 'root', levelIndex: 1, phone: '1' },
    { id: SELF, parentAgentId: ROOT, username: 'self', levelIndex: 2, phone: '2' },
    { id: CHILD, parentAgentId: SELF, username: 'child', levelIndex: 3, phone: '3' },
    { id: SIBLING, parentAgentId: ROOT, username: 'sibling', levelIndex: 2, phone: '4' },
  ]
  const descendants: Record<string, string[]> = { [ROOT]: [ROOT, SELF, CHILD, SIBLING], [SELF]: [SELF, CHILD], [CHILD]: [CHILD], [SIBLING]: [SIBLING] }

  beforeEach(() => {
    mock.method(AgentsRepo.prototype, 'list', async () => tree as any)
    mock.method(AgentsRepo.prototype, 'getDescendantIds', async (id: string) => descendants[id] ?? [id])
  })

  const q = (name: string, args: any, ctx: any) => (usersQueryResolvers as any)[name](null, args, ctx)

  it('agentsHierarchy returns only the caller subtree, rooted at the caller', async () => {
    const res = await q('agentsHierarchy', {}, agentCtx())
    assert.equal(res.length, 1)
    assert.equal(res[0].id, SELF)
    assert.deepEqual(res[0].children.map((c: any) => c.id), [CHILD])
  })

  it('agentsHierarchy still returns the whole tenant tree to an admin', async () => {
    const res = await q('agentsHierarchy', {}, adminCtx())
    assert.equal(res.length, 1)
    assert.equal(res[0].id, ROOT)
    assert.equal(res[0].children.length, 2)
  })

  it('agentExclusionImpact refuses an agent outside the caller subtree', async () => {
    await assert.rejects(() => q('agentExclusionImpact', { agentId: SIBLING }, agentCtx()), /outside your hierarchy/)
    await assert.rejects(() => q('agentExclusionImpact', { agentId: ROOT }, agentCtx()), /outside your hierarchy/)
  })

  it('agentExclusionImpact answers for an agent inside the caller subtree', async () => {
    const res = await q('agentExclusionImpact', { agentId: CHILD }, agentCtx())
    assert.deepEqual(res.descendantAgentIds, [CHILD])
    assert.deepEqual(res.playerIds, [String(OWN_PLAYER), '102'])
  })
})
