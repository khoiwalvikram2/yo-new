/**
 * An agent acts downward, never upward or sideways.
 *
 * The model authorises through `agent_hierarchy_closure`: an agent reaches
 * itself and everything beneath it, at arbitrary depth. `canAgentAccess`
 * enforces that for reads. Ten mutations that take an agent id enforced none of
 * it — measured, zero hierarchy checks across `setAgentCredentials`,
 * `setCommissionConfig`, `setSharingConfig`, `settleAgent`, `adjustAgentCredit`,
 * `allocateCreditToPlayer`, `depositCredit`, `withdrawCredit`,
 * `settleSharingAgent` and `adminResetAgentPassword`. An agent could name its
 * own parent or a sibling and overwrite their credentials, reset their password,
 * rewrite their commission or sharing rate, adjust their credit, or settle them.
 *
 * Three of them refuse the caller's own id as well, because there acting on
 * yourself IS the escalation: raising your own credit limit, and rewriting your
 * own commission or sharing rate.
 *
 * The hierarchy here is parent -> child -> grandchild plus a sibling of child,
 * so the tests cover upward, sideways, and the depth-2 case a direct-parent
 * comparison would have got wrong.
 *
 * Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const TENANT = 'subtree-test-tenant'

let db: (typeof import('@src/db/client.js'))['db']
let ensureAgentMayActOn: typeof import('@src/domains/agents/services/agentSubtree.js')['ensureAgentMayActOn']
let parent = ''
let child = ''
let grandchild = ''
let sibling = ''

const asAgent = (agentId: string) => ({
  user: { sub: '1', type: 'agent', agentId, isReadOnly: false },
  tenant: TENANT,
  whitelabel: { id: TENANT },
})
const asAdmin = () => ({
  user: { sub: '1', type: 'admin', roles: [] },
  tenant: TENANT,
  whitelabel: { id: TENANT },
})

async function mkAgent(_label: string, parentId: string | null): Promise<string> {
  // `agents` has no name column; allowed_domains is NOT NULL with no default.
  const r = await db.execute(sql`
    INSERT INTO agents (tenant_id, scheme_type, allowed_domains, parent_agent_id, status)
    VALUES (${TENANT}, 'CREDIT', ARRAY['sports']::text[], ${parentId}, 'ACTIVE')
    RETURNING id`)
  return String((r.rows[0] as { id: string }).id)
}

/** Mirrors what the application maintains: every ancestor -> descendant pair. */
async function link(ancestor: string, descendant: string, depth: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth)
    VALUES (${ancestor}, ${descendant}, ${depth})
    ON CONFLICT DO NOTHING`)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  ;({ ensureAgentMayActOn } = await import('@src/domains/agents/services/agentSubtree.js'))

  await db.execute(sql`
    INSERT INTO whitelabels (id, name, domain, status)
    VALUES (${TENANT}, 'Subtree Test', ${TENANT + '.test'}, 'active')
    ON CONFLICT (id) DO NOTHING`)

  parent = await mkAgent('P', null)
  child = await mkAgent('C', parent)
  grandchild = await mkAgent('G', child)
  sibling = await mkAgent('S', parent)

  await link(parent, child, 1)
  await link(parent, grandchild, 2)
  await link(parent, sibling, 1)
  await link(child, grandchild, 1)
})

after(async () => {
  if (db) {
    await db.execute(sql`
      DELETE FROM agent_hierarchy_closure
      WHERE ancestor_id IN (SELECT id FROM agents WHERE tenant_id = ${TENANT})
         OR descendant_id IN (SELECT id FROM agents WHERE tenant_id = ${TENANT})`)
    await db.execute(sql`DELETE FROM agents WHERE tenant_id = ${TENANT}`)
    await db.execute(sql`DELETE FROM whitelabels WHERE id = ${TENANT}`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

const anywhere = { allowSelf: true, action: 'act' }
const notSelf = { allowSelf: false, action: 'act' }

describe('an agent may act downward', () => {
  it('reaches its direct child', async () => {
    await assert.doesNotReject(() => ensureAgentMayActOn(asAgent(parent), child, anywhere))
  })

  it('reaches a grandchild, which a direct-parent comparison would have refused', async () => {
    await assert.doesNotReject(() => ensureAgentMayActOn(asAgent(parent), grandchild, anywhere))
  })

  it('reaches itself when the operation allows it', async () => {
    await assert.doesNotReject(() => ensureAgentMayActOn(asAgent(child), child, anywhere))
  })
})

describe('an agent may not act upward or sideways', () => {
  it('cannot reach its parent', async () => {
    await assert.rejects(
      () => ensureAgentMayActOn(asAgent(child), parent, anywhere),
      /not found/i,
      'a child acted on its parent'
    )
  })

  it('cannot reach its grandparent', async () => {
    await assert.rejects(
      () => ensureAgentMayActOn(asAgent(grandchild), parent, anywhere),
      /not found/i,
      'a grandchild acted on its grandparent'
    )
  })

  it('cannot reach a sibling', async () => {
    await assert.rejects(
      () => ensureAgentMayActOn(asAgent(child), sibling, anywhere),
      /not found/i,
      'a child acted on its sibling'
    )
  })

  it('says "not found" rather than confirming the id exists', async () => {
    // A forbidden answer would tell a caller that an agent id outside its
    // subtree is real, which is itself a disclosure.
    await assert.rejects(
      () => ensureAgentMayActOn(asAgent(child), parent, anywhere),
      (e: Error) => !/forbidden/i.test(e.message),
      'the refusal confirmed the target exists'
    )
  })
})

describe('the three self-escalations are refused', () => {
  it('refuses an agent acting on itself when allowSelf is false', async () => {
    await assert.rejects(
      () => ensureAgentMayActOn(asAgent(child), child, notSelf),
      /cannot act for itself/i,
      'an agent raised its own credit limit or rate'
    )
  })

  it('still lets it act on a descendant', async () => {
    await assert.doesNotReject(() => ensureAgentMayActOn(asAgent(child), grandchild, notSelf))
  })
})

describe('an admin is not constrained by the hierarchy', () => {
  it('reaches any agent, because tenant scoping is their boundary', async () => {
    for (const target of [parent, child, grandchild, sibling]) {
      await assert.doesNotReject(() => ensureAgentMayActOn(asAdmin(), target, notSelf))
    }
  })
})
