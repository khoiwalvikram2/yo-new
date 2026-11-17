/**
 * What an agent is told when it tries to approve or reject a deposit request (FIN-10).
 *
 * Measured before: every agent got "User not authenticated". The reviewer id was derived first, as Number(sub),
 * and an agent's sub is its uuid, so the NaN tripped the session check before the commission-agent and
 * payments.deposits checks below it could run. The refusal was right; its reason was wrong, and the panel ends a
 * session on "user not authenticated".
 *
 * AgentsRepo.findById is stubbed on its prototype, so nothing here reads the database: every case is refused
 * before the deposit request is looked up.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/deposits/__tests__/depositReviewRefusals.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AgentsRepo } from '../../../repos/agents/AgentsRepo.js'
import { deriveAgentPermissions } from '../../agents/services/AgentPermissionsService.js'
import { depositsMutationResolvers } from '../resolvers/mutations.js'

const T = 'vfyfix-deposits'
const SHARING = '7c7c7c7c-0000-4000-8000-000000000007'
const CREDIT = '8d8d8d8d-0000-4000-8000-000000000008'
const COMMISSION = '9e9e9e9e-0000-4000-8000-000000000009'
const SCHEMES: Record<string, string> = { [SHARING]: 'SHARING', [CREDIT]: 'CREDIT', [COMMISSION]: 'COMMISSION' }

let originalFindById: AgentsRepo['findById']

const agent = (agentId: string) => ({
  user: { sub: agentId, type: 'agent', agentId, roles: [] },
  tenant: T,
  whitelabel: { id: T },
  permissions: deriveAgentPermissions(['sports'] as never, SCHEMES[agentId]),
})
const args = { input: { id: '987654321', note: 'vfyfix' } }
const review = (name: 'approveDepositRequest' | 'rejectDepositRequest', ctx: unknown) =>
  (depositsMutationResolvers as any)[name](null, args, ctx)

before(() => {
  originalFindById = AgentsRepo.prototype.findById
  ;(AgentsRepo.prototype as any).findById = async (id: string) =>
    SCHEMES[id] ? { id, tenantId: T, schemeType: SCHEMES[id], status: 'ACTIVE', parentAgentId: null } : null
})

after(() => {
  AgentsRepo.prototype.findById = originalFindById
})

for (const [name, verb] of [['approveDepositRequest', 'approve'], ['rejectDepositRequest', 'reject']] as const) {
  describe(`${name} refuses an agent for the right reason`, () => {
    it('a sharing or credit agent gets the permission refusal every other payments mutation gives', async () => {
      for (const id of [SHARING, CREDIT]) {
        await assert.rejects(review(name, agent(id)), new RegExp(`Forbidden: insufficient permissions to ${verb} deposit requests`))
      }
    })

    it('a commission agent gets its own refusal', async () => {
      await assert.rejects(review(name, agent(COMMISSION)), /Commission agents cannot access payment requests/)
    })

    it('a caller with no session is still told it is not authenticated', async () => {
      await assert.rejects(review(name, { tenant: T, whitelabel: { id: T } }), /User not authenticated/)
    })

    it('an admin holding the permission but no numeric id names no reviewer', async () => {
      const odd = { user: { sub: 'not-a-number', roles: [] }, tenant: T, whitelabel: { id: T }, permissions: [{ domain: 'payments.deposits', actions: [verb] }] }
      await assert.rejects(review(name, odd), new RegExp(`Forbidden: only an admin can ${verb} deposit requests`))
    })
  })
}
