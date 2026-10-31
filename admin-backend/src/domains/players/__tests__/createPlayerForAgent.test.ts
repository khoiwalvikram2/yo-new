/**
 * createPlayerForAgent: the player's type comes from the agent's scheme, and its
 * domain flags from the owning agent's allowedDomains (owner decision 4).
 *
 * Before: `input.playerType` was honoured alongside the derived type, so an
 * agent passing WHITELABEL_CREDIT had its new player's limit deducted from the
 * whitelabel credit pool; and every agent-created player got sports + casino on
 * and matka off, whatever the agent was allowed. The credit an agent gave its
 * own new player was deducted after the player was committed, with no lock.
 *
 * No test here reaches the database: the pg pool is a tripwire and the creation
 * transaction is a fake that records the player row instead of writing it.
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { pool, db } from '@src/db/client.js'
import { AgentsRepo } from '@/repos/agents/AgentsRepo.js'
import { WhitelabelCreditService } from '@src/domains/common/services/WhitelabelCreditService.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'
import { playersMutationResolvers } from '../resolvers/mutations.js'
import { playerTypeForAgentScheme, bettingFlagsFromAgentDomains } from '../resolvers/agentPlayerCreation.js'

const TENANT = 'w2-test-tenant'
const AGENT_ID = '33333333-3333-4333-8333-333333333333'

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

function fakeTx(inserts: any[], order: string[]) {
  return {
    select: () => chain([]),
    update: () => chain([]),
    execute: async () => ({ rows: [] }),
    insert: () => ({
      values: (values: any) => {
        order.push('insert')
        inserts.push(values)
        throw new Error('CAPTURED_INSERT')
      },
    }),
  }
}

function agentCtx(scheme: 'CREDIT' | 'SHARING' | 'COMMISSION', domains: string[]) {
  return {
    tenant: TENANT,
    user: { type: 'agent', agentId: AGENT_ID, sub: AGENT_ID, isReadOnly: false, agentSchemeType: scheme },
    permissions: deriveAgentPermissions(domains as any),
  }
}

const input = (over: Record<string, unknown> = {}) => ({
  agentId: 'self',
  name: 'W2 Agent Player',
  username: 'w2agentplayer',
  phone: '9000000002',
  password: 'longenough1',
  ...over,
})

let inserts: any[] = []
let order: string[] = []
let txSeen: unknown = null

function useAgent(scheme: 'CREDIT' | 'SHARING' | 'COMMISSION', domains: string[]) {
  mock.method(AgentsRepo.prototype, 'findById', async (id: string) =>
    ({ id, tenantId: TENANT, schemeType: scheme, status: 'ACTIVE', allowedDomains: domains }) as any,
  )
}

beforeEach(() => {
  inserts = []
  order = []
  mock.method(pool as any, 'query', async () => {
    throw new Error('DB_TOUCHED')
  })
  mock.method(pool as any, 'connect', async () => {
    throw new Error('DB_TOUCHED')
  })
  mock.method((db as any).query.appConfigs, 'findFirst', async () => null)
  mock.method(db as any, 'transaction', async (cb: (tx: any) => Promise<unknown>) => {
    const tx = fakeTx(inserts, order)
    txSeen = tx
    return cb(tx)
  })
  // Nothing on this path may touch the whitelabel credit pool.
  for (const m of ['validateCreditAvailable', 'deductCredit', 'getCreditAllocation'] as const) {
    mock.method(WhitelabelCreditService.prototype, m, async () => {
      throw new Error('WHITELABEL_POOL_TOUCHED')
    })
  }
})

afterEach(() => {
  mock.restoreAll()
})

const create = (args: any, ctx: any) => (playersMutationResolvers as any).createPlayerForAgent(null, { input: args }, ctx)

describe('agent player rules', () => {
  it('derives the type from the scheme', () => {
    assert.equal(playerTypeForAgentScheme('CREDIT'), 'AGENT_CREDIT')
    assert.equal(playerTypeForAgentScheme('SHARING'), 'SHARING_AGENT_PLAYER')
    assert.equal(playerTypeForAgentScheme('COMMISSION'), 'COMMISSION_AGENT_PLAYER')
  })

  it('derives domain flags from allowedDomains, visible and bettable together', () => {
    assert.deepEqual(bettingFlagsFromAgentDomains(['matka']), {
      sportsVisible: false, sportsBetAllowed: false,
      casinoVisible: false, casinoBetAllowed: false,
      matkaVisible: true, matkaBetAllowed: true,
    })
    assert.deepEqual(bettingFlagsFromAgentDomains(['sports', 'casino', 'matka']), {
      sportsVisible: true, sportsBetAllowed: true,
      casinoVisible: true, casinoBetAllowed: true,
      matkaVisible: true, matkaBetAllowed: true,
    })
    assert.equal(bettingFlagsFromAgentDomains(null).sportsBetAllowed, false)
  })
})

describe('createPlayerForAgent', () => {
  it('ignores input.playerType: WHITELABEL_CREDIT from a SHARING agent becomes a sharing player and never touches the pool', async () => {
    useAgent('SHARING', ['sports', 'casino'])
    await assert.rejects(
      () => create(input({ playerType: 'WHITELABEL_CREDIT', creditLimit: 500 }), agentCtx('SHARING', ['sports', 'casino'])),
      /CAPTURED_INSERT/,
    )
    assert.equal(inserts.length, 1)
    assert.equal(inserts[0].playerType, 'SHARING_AGENT_PLAYER')
    assert.equal(inserts[0].creditLimit, '0')
  })

  it('ignores input.playerType AGENT_CREDIT from a COMMISSION agent', async () => {
    useAgent('COMMISSION', ['sports'])
    await assert.rejects(
      () => create(input({ playerType: 'AGENT_CREDIT', creditLimit: 500 }), agentCtx('COMMISSION', ['sports'])),
      /CAPTURED_INSERT/,
    )
    assert.equal(inserts[0].playerType, 'COMMISSION_AGENT_PLAYER')
  })

  it("takes the player's domain flags from the owning agent's allowedDomains", async () => {
    useAgent('SHARING', ['matka'])
    await assert.rejects(() => create(input(), agentCtx('SHARING', ['matka'])), /CAPTURED_INSERT/)
    const row = inserts[0]
    assert.equal(row.matkaVisible, true)
    assert.equal(row.matkaBetAllowed, true)
    assert.equal(row.sportsVisible, false)
    assert.equal(row.sportsBetAllowed, false)
    assert.equal(row.casinoVisible, false)
    assert.equal(row.casinoBetAllowed, false)
  })

  it("a credit agent's own new player is funded by a locked delta on the creation transaction", async () => {
    useAgent('CREDIT', ['sports'])
    mock.method(AgentsRepo.prototype, 'getCreditFields', async () => ({
      creditLimit: 1000, creditUsed: 0, creditAvailable: 1000, creditAlertThreshold: 80,
      settlementBalance: 0, settlementBalanceSports: 0, settlementBalanceCasino: 0, settlementBalanceMatka: 0,
    }))
    const lock = mock.method(AgentsRepo.prototype, 'lockAndUpdateCredit', async (_id: string, _u: any, tx: unknown) => {
      order.push('lock')
      assert.equal(tx, txSeen, 'the credit lock must run on the creation transaction')
      return {} as any
    })
    await assert.rejects(
      () => create(input({ playerType: 'WHITELABEL_CREDIT', creditLimit: 300 }), agentCtx('CREDIT', ['sports'])),
      /CAPTURED_INSERT/,
    )
    assert.equal(lock.mock.callCount(), 1)
    const [agentId, update] = lock.mock.calls[0].arguments as [string, any]
    assert.equal(agentId, AGENT_ID)
    assert.deepEqual(update, { creditUsedDelta: 300, requireAvailableForDelta: true })
    assert.deepEqual(order, ['lock', 'insert'])
    assert.equal(inserts[0].playerType, 'AGENT_CREDIT')
    assert.equal(inserts[0].sportsBetAllowed, true)
    assert.equal(inserts[0].casinoBetAllowed, false)
  })
})
