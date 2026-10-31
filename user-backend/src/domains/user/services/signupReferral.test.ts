/**
 * Signup through an agent's link (plan W5, D5 + owner decision 1).
 * No database: db.select answers the referral-link lookup, db.execute the agent chain.
 */
import assert from 'node:assert/strict'
import test, { afterEach, mock } from 'node:test'
import { db } from '../../../db/client.js'
import { INACTIVE_AGENT_LINK_MESSAGE, resolveSignupReferral } from './authService.js'

const TENANT = 'w5test'
const AGENT = '00000000-0000-0000-0000-0000000000a1'
const ROOT = '00000000-0000-0000-0000-00000000000f'

function stubLink(link: Record<string, unknown> | null | Error, chain: Array<Record<string, unknown>> = []) {
  mock.method(db as any, 'select', () => ({
    from: () => ({
      where: () => ({
        limit: () => (link instanceof Error ? Promise.reject(link) : Promise.resolve(link ? [link] : [])),
      }),
    }),
  }))
  mock.method(db as any, 'execute', async () => ({ rows: chain }))
}

afterEach(() => mock.restoreAll())

const agentLink = { code: 'AGT1', tenant: TENANT, isActive: true, agentId: AGENT, userId: null }

test('no code / unknown code: plain signup', async () => {
  assert.deepEqual(await resolveSignupReferral(undefined, TENANT), { kind: 'none' })
  stubLink(null)
  assert.deepEqual(await resolveSignupReferral('NOPE', TENANT), { kind: 'none' })
})

test('active SHARING agent: attribution written with the account', async () => {
  stubLink(agentLink, [
    { agent_id: AGENT, status: 'ACTIVE', scheme_type: 'SHARING', tenant_id: TENANT },
    { agent_id: ROOT, status: 'ACTIVE', scheme_type: 'SHARING', tenant_id: TENANT },
  ])
  assert.deepEqual(await resolveSignupReferral('agt1', TENANT), {
    kind: 'agent',
    agentId: AGENT,
    playerType: 'SHARING_AGENT_PLAYER',
  })
})

test('agent with a suspended ancestor: signup refused, not a silent REGULAR player', async () => {
  stubLink(agentLink, [
    { agent_id: AGENT, status: 'ACTIVE', scheme_type: 'COMMISSION', tenant_id: TENANT },
    { agent_id: ROOT, status: 'SUSPENDED', scheme_type: 'COMMISSION', tenant_id: TENANT },
  ])
  await assert.rejects(resolveSignupReferral('AGT1', TENANT), { message: INACTIVE_AGENT_LINK_MESSAGE })
})

test('suspended agent or missing agent row: signup refused', async () => {
  stubLink(agentLink, [{ agent_id: AGENT, status: 'SUSPENDED', scheme_type: 'SHARING', tenant_id: TENANT }])
  await assert.rejects(resolveSignupReferral('AGT1', TENANT), { message: INACTIVE_AGENT_LINK_MESSAGE })
  mock.restoreAll()
  stubLink(agentLink, [])
  await assert.rejects(resolveSignupReferral('AGT1', TENANT), { message: INACTIVE_AGENT_LINK_MESSAGE })
})

test('lookup failure refuses the signup instead of dropping the attribution', async () => {
  stubLink(new Error('connection reset'))
  await assert.rejects(resolveSignupReferral('AGT1', TENANT), { message: /Could not verify the referral code/ })
})

test('player-owned link: user-to-user referral', async () => {
  stubLink({ code: 'USR1', tenant: TENANT, isActive: true, agentId: null, userId: 77 })
  assert.deepEqual(await resolveSignupReferral('USR1', TENANT), { kind: 'user', userReferrerId: 77 })
})
