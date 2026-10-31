/**
 * Agent betting gate (owner decisions 1 and 4): a player's bet is refused while their agent
 * or any ancestor is not ACTIVE, or when the agent lacks the bet's domain.
 * No database: the db handle's methods are stubbed for the duration of each test.
 */
import assert from 'node:assert/strict'
import test, { afterEach, mock } from 'node:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { db } from '../../../db/client.js'
import {
  AGENT_BRANCH_INACTIVE_MESSAGE,
  agentDomainNotAllowedMessage,
  checkPlayerAgentBettingGate,
  evaluateAgentBettingGate,
  isAgentBranchActive,
  type AgentChainRow,
} from './agentBettingGate.js'
import { placeSportsBetForUser } from './sportsBetService.js'

const AGENT = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000a0'
const ROOT = '00000000-0000-0000-0000-00000000000f'

function chain(rows: Array<Partial<AgentChainRow> & { agent_id: string | null }>, playerAgentId: string | null = AGENT): AgentChainRow[] {
  return rows.map((r) => ({
    player_agent_id: playerAgentId,
    agent_id: r.agent_id,
    status: r.status ?? 'ACTIVE',
    allowed_domains: r.allowed_domains ?? ['sports', 'casino'],
  }))
}

afterEach(() => mock.restoreAll())

test('gate: player without an agent is not affected', () => {
  assert.deepEqual(evaluateAgentBettingGate(chain([{ agent_id: null }], null), 'sports'), { ok: true })
  assert.deepEqual(evaluateAgentBettingGate([], 'casino'), { ok: true })
})

test('gate: active agent and active ancestors with the domain -> allowed', () => {
  const rows = chain([{ agent_id: AGENT }, { agent_id: PARENT }, { agent_id: ROOT }])
  assert.deepEqual(evaluateAgentBettingGate(rows, 'sports'), { ok: true })
  assert.deepEqual(evaluateAgentBettingGate(rows, 'casino'), { ok: true })
})

test('gate: a suspended ANCESTOR blocks the bet (decision 1)', () => {
  const rows = chain([{ agent_id: AGENT }, { agent_id: PARENT, status: 'SUSPENDED' }, { agent_id: ROOT }])
  const res = evaluateAgentBettingGate(rows, 'sports')
  assert.equal(res.ok, false)
  assert.equal(!res.ok && res.reason, 'AGENT_BRANCH_INACTIVE')
  assert.equal(!res.ok && res.message, AGENT_BRANCH_INACTIVE_MESSAGE)
})

test('gate: the agent itself not ACTIVE (BLOCKED / INACTIVE) blocks the bet', () => {
  for (const status of ['BLOCKED', 'INACTIVE', 'SUSPENDED']) {
    const res = evaluateAgentBettingGate(chain([{ agent_id: AGENT, status }, { agent_id: ROOT }]), 'casino')
    assert.equal(!res.ok && res.reason, 'AGENT_BRANCH_INACTIVE', status)
  }
})

test('gate: status compare is case-safe, a missing agent row fails closed', () => {
  assert.deepEqual(evaluateAgentBettingGate(chain([{ agent_id: AGENT, status: 'active' }]), 'sports'), { ok: true })
  // users.agent_id points at no agent row (no FK): refused, not waved through.
  const dangling = evaluateAgentBettingGate(chain([{ agent_id: null }]), 'sports')
  assert.equal(!dangling.ok && dangling.reason, 'AGENT_BRANCH_INACTIVE')
  assert.equal(isAgentBranchActive([{ agent_id: PARENT, status: 'ACTIVE' }], AGENT), false)
})

test('gate: agent without the domain refuses that domain only (decision 4)', () => {
  const rows = chain([{ agent_id: AGENT, allowed_domains: ['sports'] }])
  assert.deepEqual(evaluateAgentBettingGate(rows, 'sports'), { ok: true })
  const casino = evaluateAgentBettingGate(rows, 'casino')
  assert.equal(!casino.ok && casino.reason, 'AGENT_DOMAIN_NOT_ALLOWED')
  assert.equal(!casino.ok && casino.message, agentDomainNotAllowedMessage('casino'))
  // Raw text[] literal and mixed case are understood.
  assert.deepEqual(evaluateAgentBettingGate(chain([{ agent_id: AGENT, allowed_domains: '{Sports,CASINO}' }]), 'casino'), { ok: true })
  const none = evaluateAgentBettingGate(chain([{ agent_id: AGENT, allowed_domains: [] }]), 'sports')
  assert.equal(!none.ok && none.reason, 'AGENT_DOMAIN_NOT_ALLOWED')
})

test('gate query: one statement over the closure table, keyed by player and tenant', async () => {
  const calls: any[] = []
  const executor = {
    execute: async (q: any) => {
      calls.push(q)
      return { rows: chain([{ agent_id: AGENT }, { agent_id: ROOT, status: 'SUSPENDED' }]) }
    },
  }
  const res = await checkPlayerAgentBettingGate(executor, { userId: 7, tenant: 'w5test' }, 'sports')
  assert.equal(!res.ok && res.reason, 'AGENT_BRANCH_INACTIVE')
  assert.equal(calls.length, 1)
  const query = new PgDialect().sqlToQuery(calls[0])
  assert.match(query.sql, /agent_hierarchy_closure/)
  assert.match(query.sql, /allowed_domains/)
  assert.deepEqual(query.params, [7, 'w5test'])
})

function stubPlayer(agentRows: AgentChainRow[]) {
  const player = {
    id: 4242,
    tenant: 'w5test',
    status: 'active',
    sportsVisible: true,
    sportsBetAllowed: true,
    playerType: 'SHARING_AGENT_PLAYER',
    agentId: AGENT,
    creditAvailable: '0',
  }
  mock.method(db as any, 'select', () => ({ from: () => ({ where: () => Promise.resolve([player]) }) }))
  mock.method(db as any, 'execute', async () => ({ rows: agentRows }))
  mock.method(db as any, 'transaction', async () => {
    throw new Error('no transaction may start for a refused bet')
  })
  return { auth: { userId: player.id, tenant: player.tenant, requestTenant: player.tenant } } as any
}

const legacyLeg = {
  eventId: 'e1',
  marketId: 'm1',
  selectionId: 's1',
  selectionType: 'back',
  odds: 2,
  stake: 100,
}

test('placeSportsBetForUser: blocked ancestor refuses the bet before anything is staked', async () => {
  const ctx = stubPlayer(chain([{ agent_id: AGENT }, { agent_id: ROOT, status: 'SUSPENDED' }]))
  await assert.rejects(placeSportsBetForUser(ctx, { legacy: legacyLeg }), {
    name: 'AgentBettingBlockedError',
    message: AGENT_BRANCH_INACTIVE_MESSAGE,
  })
})

test('placeSportsBetForUser: agent without the sports domain refuses the bet', async () => {
  const ctx = stubPlayer(chain([{ agent_id: AGENT, allowed_domains: ['casino'] }]))
  await assert.rejects(placeSportsBetForUser(ctx, { legacy: legacyLeg }), {
    name: 'AgentBettingBlockedError',
    message: agentDomainNotAllowedMessage('sports'),
  })
})
