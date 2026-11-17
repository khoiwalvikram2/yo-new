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
import { ChipRepo } from '@/repos/agents/ChipRepo.js'
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

  it("a credit agent's own new player: the credit reference is only a figure, and opening chips lock the agent first on the creation transaction", async () => {
    useAgent('CREDIT', ['sports'])
    // The credit-limit model is gone (spec 2026-11-02 §4.4): no limit is drawn from the agent's credit line, and
    // AgentsRepo no longer has the credit-line writer (lockAndUpdateCredit) that did it.
    assert.equal((AgentsRepo.prototype as any).lockAndUpdateCredit, undefined)
    const lock = mock.method(ChipRepo.prototype, 'lockAgent', async (tx: unknown, agentId: string) => {
      order.push('lock')
      assert.equal(tx, txSeen, 'the parent lock must run on the creation transaction')
      return { id: agentId, tenantId: TENANT, schemeType: 'CREDIT', status: 'ACTIVE', parentAgentId: null, chipBalance: 1000, creditLimit: 0, username: 'agent' } as any
    })
    await assert.rejects(
      () => create(input({ playerType: 'WHITELABEL_CREDIT', creditLimit: 300, openingChips: 200 }), agentCtx('CREDIT', ['sports'])),
      /CAPTURED_INSERT/,
    )
    assert.equal(lock.mock.callCount(), 1)
    assert.equal(lock.mock.calls[0].arguments[1], AGENT_ID)
    assert.deepEqual(order, ['lock', 'insert'], 'the parent is locked before the player row is written')
    assert.equal(inserts[0].playerType, 'AGENT_CREDIT')
    assert.equal(inserts[0].creditLimit, '300', 'credit_limit holds the credit reference')
    assert.equal(inserts[0].creditAvailable, '0', 'credit_available is retired with the credit-limit model')
    assert.equal(inserts[0].sportsBetAllowed, true)
    assert.equal(inserts[0].casinoBetAllowed, false)
  })

  it('no opening chips: nothing is locked, and the player starts with its credit reference only', async () => {
    useAgent('CREDIT', ['sports'])
    const lock = mock.method(ChipRepo.prototype, 'lockAgent', async () => {
      throw new Error('LOCKED')
    })
    await assert.rejects(() => create(input({ creditLimit: 500 }), agentCtx('CREDIT', ['sports'])), /CAPTURED_INSERT/)
    assert.equal(lock.mock.callCount(), 0)
    assert.deepEqual(order, ['insert'])
    assert.equal(inserts[0].creditLimit, '500')
  })

  it("a sub-agent's player starts at 0: only that sub-agent sets its reference and deposits its chips", async () => {
    useAgent('CREDIT', ['sports'])
    const SUB = '44444444-4444-4444-8444-444444444444'
    mock.method(AgentsRepo.prototype, 'getDescendantIds', async () => [AGENT_ID, SUB])
    const ctx = agentCtx('CREDIT', ['sports'])
    await assert.rejects(() => create(input({ agentId: SUB, openingChips: 50 }), ctx), /Opening chips must be 0 when creating a player for a sub-agent/)
    await assert.rejects(() => create(input({ agentId: SUB, creditLimit: 50 }), ctx), /Credit reference must be 0 when creating a player for a sub-agent/)
    assert.equal(inserts.length, 0)
  })

  it('refuses opening chips for a player that is not a credit player, before anything is written', async () => {
    useAgent('SHARING', ['sports'])
    await assert.rejects(() => create(input({ openingChips: 10 }), agentCtx('SHARING', ['sports'])), /Opening chips can only be given to credit players/)
    assert.equal(inserts.length, 0)
  })
})
