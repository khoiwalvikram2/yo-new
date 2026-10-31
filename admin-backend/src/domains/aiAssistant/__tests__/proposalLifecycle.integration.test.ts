/**
 * The proposal is what stands between a model and a configuration change.
 *
 * What has to hold:
 *   - proposing stores the change without applying it;
 *   - confirming applies it exactly once, even if two confirmations race;
 *   - a lapsed proposal cannot be confirmed;
 *   - one admin cannot confirm another admin's proposal, nor reach across tenants.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `ai-itest-${randomUUID().slice(0, 8)}`
const ADMIN_A = 900001
const ADMIN_B = 900002

let conversationId: string

/** Records that the tool ran, instead of touching real configuration. */
let executions: Array<Record<string, unknown>> = []

/** set_limit requires config:write; confirmation now checks it. */
const ALLOWED_CTX = { permissions: [{ domain: 'config', actions: ['write'] }] }

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')

  const { db } = await import('@src/db/client.js')
  const { aiConversations } = await import('@shared/db/schema.js')
  const [row] = await db
    .insert(aiConversations)
    .values({ tenant: TENANT, adminUserId: ADMIN_A })
    .returning({ id: aiConversations.id })
  conversationId = row.id

  // Swap the executor of one write tool so confirmation is observable without
  // changing real configuration.
  const registry = await import('../tools/registry.js')
  const tool: any = registry.getTool('set_limit')
  tool.execute = async (args: Record<string, unknown>) => {
    executions.push(args)
    return { ok: true }
  }
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { aiConversations, aiActionProposals, aiMessages } = await import('@shared/db/schema.js')
  const { eq } = await import('drizzle-orm')
  await db.delete(aiActionProposals).where(eq(aiActionProposals.tenant, TENANT))
  await db.delete(aiMessages).where(eq(aiMessages.tenant, TENANT))
  await db.delete(aiConversations).where(eq(aiConversations.tenant, TENANT))
})

async function propose(args: Record<string, unknown>, adminUserId = ADMIN_A) {
  const { createProposal } = await import('../proposals.js')
  const { getTool } = await import('../tools/registry.js')
  const tool: any = getTool('set_limit')
  const proposed = await tool.propose(args, {})
  return createProposal({
    tenant: TENANT,
    conversationId,
    adminUserId,
    toolName: 'set_limit',
    summary: proposed.summary,
    args: proposed.args,
  })
}

describe('proposal lifecycle', () => {
  it('stores a proposal as pending without executing anything', async () => {
    executions = []
    const proposal = await propose({ scope: 'deposit', minAmount: 10, maxAmount: 1000 })
    assert.equal(proposal.status, 'pending')
    assert.match(proposal.summary, /deposit/i)
    assert.equal(executions.length, 0, 'proposing must not run the change')
  })

  it('executes exactly once on confirmation', async () => {
    executions = []
    const proposal = await propose({ scope: 'withdrawal', minAmount: 5, maxAmount: 500 })

    const { confirmProposal } = await import('../proposals.js')
    const outcome = await confirmProposal({
      tenant: TENANT,
      proposalId: proposal.id,
      adminUserId: ADMIN_A,
      ctx: ALLOWED_CTX,
    })

    assert.equal(outcome.status, 'confirmed')
    assert.equal(executions.length, 1)
    assert.deepEqual(executions[0], { scope: 'withdrawal', minAmount: 5, maxAmount: 500 })
  })

  it('runs once when two confirmations race', async () => {
    executions = []
    const proposal = await propose({ scope: 'stake', minAmount: 1, maxAmount: 100 })

    const { confirmProposal } = await import('../proposals.js')
    const outcomes = await Promise.all([
      confirmProposal({ tenant: TENANT, proposalId: proposal.id, adminUserId: ADMIN_A, ctx: ALLOWED_CTX }),
      confirmProposal({ tenant: TENANT, proposalId: proposal.id, adminUserId: ADMIN_A, ctx: ALLOWED_CTX }),
    ])

    assert.equal(executions.length, 1, 'a double confirm must not apply the change twice')
    assert.equal(outcomes.filter((o) => o.status === 'confirmed').length, 1)
    assert.equal(outcomes.filter((o) => o.status === 'already_resolved').length, 1)
  })

  it('refuses to confirm a second time after success', async () => {
    executions = []
    const proposal = await propose({ scope: 'exposure', maxAmount: 9000 })
    const { confirmProposal } = await import('../proposals.js')

    const first = await confirmProposal({ tenant: TENANT, proposalId: proposal.id, adminUserId: ADMIN_A, ctx: ALLOWED_CTX })
    const second = await confirmProposal({ tenant: TENANT, proposalId: proposal.id, adminUserId: ADMIN_A, ctx: ALLOWED_CTX })

    assert.equal(first.status, 'confirmed')
    assert.equal(second.status, 'already_resolved')
    assert.equal(executions.length, 1)
  })

  it('does not let another admin confirm someone else’s proposal', async () => {
    executions = []
    const proposal = await propose({ scope: 'deposit', maxAmount: 777 }, ADMIN_A)

    const { confirmProposal } = await import('../proposals.js')
    const outcome = await confirmProposal({
      tenant: TENANT,
      proposalId: proposal.id,
      adminUserId: ADMIN_B,
      ctx: ALLOWED_CTX,
    })

    assert.equal(outcome.status, 'already_resolved', 'another admin must not be able to claim it')
    assert.equal(executions.length, 0)
  })

  it('does not let a different tenant confirm it', async () => {
    executions = []
    const proposal = await propose({ scope: 'deposit', maxAmount: 888 })

    const { confirmProposal } = await import('../proposals.js')
    const outcome = await confirmProposal({
      tenant: 'some-other-tenant',
      proposalId: proposal.id,
      adminUserId: ADMIN_A,
      ctx: ALLOWED_CTX,
    })

    assert.equal(outcome.status, 'already_resolved')
    assert.equal(executions.length, 0)
  })

  it('refuses a proposal that has lapsed', async () => {
    executions = []
    const proposal = await propose({ scope: 'deposit', maxAmount: 1234 })

    const { db } = await import('@src/db/client.js')
    const { aiActionProposals } = await import('@shared/db/schema.js')
    const { eq } = await import('drizzle-orm')
    await db
      .update(aiActionProposals)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(aiActionProposals.id, proposal.id))

    const { confirmProposal } = await import('../proposals.js')
    const outcome = await confirmProposal({ tenant: TENANT, proposalId: proposal.id, adminUserId: ADMIN_A, ctx: ALLOWED_CTX })

    assert.equal(outcome.status, 'expired')
    assert.equal(executions.length, 0, 'an expired change must not run')
  })

  it('marks a rejected proposal so it can never run', async () => {
    executions = []
    const proposal = await propose({ scope: 'deposit', maxAmount: 4321 })

    const { rejectProposal, confirmProposal } = await import('../proposals.js')
    const rejected = await rejectProposal({ tenant: TENANT, proposalId: proposal.id, adminUserId: ADMIN_A })
    assert.equal(rejected.status, 'rejected')

    const afterReject = await confirmProposal({ tenant: TENANT, proposalId: proposal.id, adminUserId: ADMIN_A, ctx: ALLOWED_CTX })
    assert.equal(afterReject.status, 'already_resolved')
    assert.equal(executions.length, 0)
  })

  it('lists only what is still pending', async () => {
    const { listPendingProposals, rejectProposal } = await import('../proposals.js')
    const keep = await propose({ scope: 'deposit', maxAmount: 111 })
    const drop = await propose({ scope: 'deposit', maxAmount: 222 })
    await rejectProposal({ tenant: TENANT, proposalId: drop.id, adminUserId: ADMIN_A })

    const pending = await listPendingProposals(TENANT, conversationId)
    const ids = pending.map((p) => p.id)
    assert.ok(ids.includes(keep.id))
    assert.ok(!ids.includes(drop.id))
  })
})
