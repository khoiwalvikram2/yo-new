/**
 * Who may read a whitelabel's own pool, sharing terms and receiving accounts (FIN-01, SCO-02).
 *
 * Measured before: myWhitelabelCredit, myWhitelabelCreditHistory, myWhitelabelSharing and myDepositMethods read
 * only the tenant named by the X-Whitelabel-ID header. A request with no session at all paged all 3,100 rows of
 * grandwinn's pool ledger (3,086 naming a player and a phone number) and got its bank account and six UPI ids;
 * every agent, sub-agents and commission agents included, read the same pool, and watched it live through
 * whitelabelCreditUpdated.
 *
 * Driven through the real guarded resolver maps (domains/index.ts). The refusals are decided before any read;
 * the callers who pass are stopped by a missing tenant where possible, so nothing here reads a real brand.
 * Requires DATABASE_URL (myDepositMethods reads a tenant that has no row).
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'

const TENANT = 'vfyfix-pool-none'

let Query: Record<string, any> = {}
let Subscription: Record<string, any> = {}
let Whitelabel: Record<string, any> = {}

const at = (fieldName: string, root = 'Query') => ({ parentType: { name: root }, fieldName })

const anonymous = () => ({ tenant: TENANT, whitelabel: { id: TENANT }, request: { headers: {} } })
const agent = (scheme: 'SHARING' | 'COMMISSION' | 'CREDIT') => ({
  user: { sub: 'a1a1a1a1-0000-4000-8000-000000000001', agentId: 'a1a1a1a1-0000-4000-8000-000000000001', type: 'agent', roles: [] },
  permissions: deriveAgentPermissions(['sports', 'casino', 'matka'] as never, scheme),
  tenant: TENANT,
  whitelabel: { id: TENANT },
  request: { headers: {} },
})
/** `tenant: null` leaves the context without one. */
const admin = (roles: string[], permissions: Array<{ domain: string; actions: string[] }>, tenant: string | null = TENANT) => ({
  user: { sub: '987654', name: 'vfyfix', roles, type: 'admin' },
  permissions,
  tenant: tenant ?? undefined,
  whitelabel: tenant ? { id: tenant } : undefined,
  request: { headers: {} },
})
/** The live Whitelabel Admin role's flat grants that matter here. */
const WL_ADMIN = [
  { domain: 'agents', actions: ['view', 'manage', 'read', 'write'] },
  { domain: 'deposits', actions: ['view', 'manage'] },
  { domain: 'config', actions: ['read', 'write'] },
  { domain: 'finance', actions: ['read', 'write'] },
]
/** The live Finance Manager role (grandwinn): nested grants only. */
const FINANCE_MANAGER = [
  { domain: 'credit.management', actions: ['view'] },
  { domain: 'credit.history', actions: ['view'] },
  { domain: 'payments.deposits', actions: ['view', 'approve', 'reject'] },
  { domain: 'settlements.center', actions: ['view'] },
]
const JACKPOTS_ONLY = [{ domain: 'jackpots', actions: ['read'] }]

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { domainResolvers } = await import('@src/domains/index.js')
  ;({ Query, Subscription, Whitelabel } = domainResolvers as any)
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
  await closeRedisEmitter().catch(() => {})
})

const call = (name: string, ctx: unknown, args: Record<string, unknown> = {}) => Query[name](undefined, args, ctx, at(name))

const POOL_READS = ['myWhitelabelCredit', 'myWhitelabelCreditHistory', 'myWhitelabelSharing', 'myDepositMethods']

describe('no session: refused, whatever tenant the header names', () => {
  for (const name of POOL_READS) {
    it(`${name}`, async () => {
      await assert.rejects(async () => call(name, anonymous()), /Unauthorized: authentication required/)
    })
  }
})

describe('agents: refused, sub-agents and commission agents included', () => {
  for (const scheme of ['SHARING', 'COMMISSION', 'CREDIT'] as const) {
    for (const name of ['myWhitelabelCredit', 'myWhitelabelCreditHistory', 'myWhitelabelSharing']) {
      it(`${name} as a ${scheme} agent (its flat agents:view grants the nested reads)`, async () => {
        await assert.rejects(async () => call(name, agent(scheme)), /not available to agents/)
      })
    }
    it(`myDepositMethods as a ${scheme} agent`, async () => {
      await assert.rejects(async () => call('myDepositMethods', agent(scheme)), /Forbidden|cannot access payment methods/)
    })
  }
})

describe('an admin without the standing: refused', () => {
  for (const name of POOL_READS) {
    it(`${name} for a support admin holding only jackpots:read`, async () => {
      await assert.rejects(async () => call(name, admin(['vfyfix support'], JACKPOTS_ONLY)), /Forbidden: insufficient permissions/)
    })
  }
})

describe("the brand's own operators still read them", () => {
  // No tenant in context: a caller who got past the gate stops at the tenant check, before any read.
  for (const name of ['myWhitelabelCredit', 'myWhitelabelCreditHistory']) {
    it(`${name}: Whitelabel Admin, Finance Manager and Super Admin pass the gate`, async () => {
      for (const ctx of [
        admin(['Whitelabel Admin'], WL_ADMIN, null),
        admin(['Finance Manager'], FINANCE_MANAGER, null),
        admin(['Super Admin'], [{ domain: 'all', actions: ['*'] }], null),
      ]) {
        await assert.rejects(async () => call(name, ctx), /Tenant not found in context/)
      }
    })
  }

  it('myWhitelabelSharing: Whitelabel Admin and Super Admin pass the gate (the sports book reads it for them)', async () => {
    for (const ctx of [admin(['Whitelabel Admin'], WL_ADMIN, 'default'), admin(['Super Admin'], [{ domain: 'all', actions: ['*'] }], 'default')]) {
      await assert.rejects(async () => call('myWhitelabelSharing', ctx), /Whitelabel ID is required/)
    }
  })

  it('myDepositMethods: an admin holding payments.methods:view reads them', async () => {
    const out = await call('myDepositMethods', admin(['Whitelabel Admin'], WL_ADMIN))
    assert.ok(out && typeof out === 'object', 'no answer for a permitted admin')
  })
})

describe("myWhitelabelSettlements asks what its siblings ask (SCO-09)", () => {
  // It needed a session and nothing else, and refused no agent: it lists the brand's root agents' settlements
  // (usernames, amounts) and the brand's own with the platform. No admin page calls it (measured 2026-11-03).
  it('no session: refused', async () => {
    await assert.rejects(async () => call('myWhitelabelSettlements', anonymous()), /Unauthorized: authentication required/)
  })

  for (const scheme of ['SHARING', 'COMMISSION', 'CREDIT'] as const) {
    it(`a ${scheme} agent is refused`, async () => {
      await assert.rejects(async () => call('myWhitelabelSettlements', agent(scheme)), /the whitelabel settlements is not available to agents/)
    })
  }

  it('an admin without the settlement centre read is refused', async () => {
    for (const perms of [JACKPOTS_ONLY, [{ domain: 'agents.sharing', actions: ['view'] }]]) {
      await assert.rejects(async () => call('myWhitelabelSettlements', admin(['vfyfix support'], perms)),
        /Forbidden: insufficient permissions to view the whitelabel settlements/)
    }
  })

  it('Whitelabel Admin, Finance Manager and Super Admin pass the gate', async () => {
    // No tenant in context: past the gate, each stops at the tenant check before any read.
    for (const ctx of [
      admin(['Whitelabel Admin'], WL_ADMIN, null),
      admin(['Finance Manager'], FINANCE_MANAGER, null),
      admin(['Super Admin'], [{ domain: 'all', actions: ['*'] }], null),
    ]) {
      await assert.rejects(async () => call('myWhitelabelSettlements', ctx), /Tenant not found in context/)
    }
  })

  it('the pool reads keep their own wording', async () => {
    await assert.rejects(async () => call('myWhitelabelCredit', agent('SHARING')), /Forbidden: the whitelabel pool is not available to agents/)
    await assert.rejects(async () => call('myWhitelabelCredit', admin(['vfyfix support'], JACKPOTS_ONLY)), /Forbidden: insufficient permissions to view the whitelabel pool/)
  })
})

describe('the live pool streams refuse agents too', () => {
  const pubsub = (topics: string[]) => ({
    subscribe: async (topic: string) => {
      topics.push(topic)
      return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }
    },
  })

  for (const name of ['whitelabelCreditUpdated', 'whitelabelSharingUpdated']) {
    it(`${name}: an agent is refused before it subscribes; the brand's admin still subscribes`, async () => {
      const topics: string[] = []
      await assert.rejects(
        async () => Subscription[name].subscribe(undefined, {}, { ...agent('SHARING'), pubsub: pubsub(topics) }, at(name, 'Subscription')),
        /not available to agents/
      )
      assert.deepEqual(topics, [], 'the agent reached the topic')

      await Subscription[name].subscribe(undefined, {}, { ...admin(['Whitelabel Admin'], WL_ADMIN), pubsub: pubsub(topics) }, at(name, 'Subscription'))
      assert.equal(topics.length, 1, 'the whitelabel admin could not subscribe')
    })
  }
})

describe('the Whitelabel type answers the same: whitelabelCurrent is no way round', () => {
  // whitelabelCurrent, whitelabels and whitelabel(id) return the brand's own row, and its money fields' gate passed an
  // agent on the flat agents:view; the settlement balances had no gate at all. The root carries the figures, so no
  // money field reads the database.
  const root = {
    id: TENANT, creditLimit: '100', creditUsed: '1', creditAvailable: '99', creditAlertThreshold: '75',
    settlementBalance: '7', settlementBalanceSports: '1', settlementBalanceCasino: '2', settlementBalanceMatka: '4',
  }
  const MONEY = [
    'creditLimit', 'creditUsed', 'creditAvailable', 'creditAlertThreshold',
    'settlementBalance', 'settlementBalanceSports', 'settlementBalanceCasino', 'settlementBalanceMatka',
  ]

  for (const scheme of ['SHARING', 'COMMISSION', 'CREDIT'] as const) {
    it(`a ${scheme} agent of the brand gets no pool figures and no sharing rates`, async () => {
      for (const field of MONEY) assert.equal(await Whitelabel[field](root, {}, agent(scheme)), null, field)
      assert.equal(await Whitelabel.sharingRates(root, {}, agent(scheme)), null, 'sharingRates')
    })
  }

  it('a caller with no session gets no figures, settlement balances included', async () => {
    for (const field of MONEY) assert.equal(await Whitelabel[field](root, {}, anonymous()), null, field)
  })

  it("the brand's admin and the platform still read them", async () => {
    for (const ctx of [admin(['Whitelabel Admin'], WL_ADMIN), admin(['Super Admin'], [{ domain: 'all', actions: ['*'] }])]) {
      assert.equal(await Whitelabel.creditLimit(root, {}, ctx), 100)
      assert.equal(Number(await Whitelabel.settlementBalance(root, {}, ctx)), 7)
      assert.equal(Number(await Whitelabel.settlementBalanceMatka(root, {}, ctx)), 4)
    }
  })
})
