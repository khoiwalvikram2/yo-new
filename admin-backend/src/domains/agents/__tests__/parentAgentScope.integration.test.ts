/**
 * `AgentAccount.parentAgent` walks UP the hierarchy. The model authorises DOWN.
 *
 * An agent sees its own subtree, resolved through `agent_hierarchy_closure`. Its
 * upline is by definition outside that subtree — yet this field resolver took no
 * `ctx` at all (measured arity 1, so it could not have been authorising
 * anything) and returned the parent's whole row: creditLimit, creditUsed,
 * creditAvailable and every settlement balance. A sub-agent was reading its
 * master's total credit position. Because `parentAgent` returns an
 * `AgentAccount`, the query recursed up the chain until the depth limit of 6
 * stopped it.
 *
 * The redaction has to set the money fields rather than omit them:
 * `settlementBalanceByDomain` re-reads from the database when its three inputs
 * are `undefined`, so a partial object would have leaked exactly what the
 * redaction removes. That is what the last test here pins.
 *
 * Requires DATABASE_URL. Writes nothing.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

const MONEY = ['creditLimit', 'creditUsed', 'creditAvailable', 'settlementBalance']

let AgentAccount: Record<string, any>
let child = ''
let parent = ''
let tenant = ''

const ctxOf = (type: string, t: string) => ({
  user: { sub: '1', type, agentId: child, isReadOnly: false, roles: [] },
  tenant: t,
  whitelabel: { id: t },
})

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { pool } = await import('@src/db/client.js')
  const r = await pool.query(
    `SELECT c.id AS child, c.tenant_id AS tenant, c.parent_agent_id AS parent
     FROM agents c JOIN agents p ON p.id = c.parent_agent_id LIMIT 1`
  )
  if (r.rows.length) {
    child = String(r.rows[0].child)
    parent = String(r.rows[0].parent)
    tenant = String(r.rows[0].tenant)
  }
  const { domainResolvers } = await import('@src/domains/index.js')
  AgentAccount = (domainResolvers as Record<string, any>).AgentAccount
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

describe('AgentAccount.parentAgent', () => {
  it('takes a context, so it is able to authorise at all', () => {
    assert.ok(
      AgentAccount.parentAgent.length >= 3,
      `arity is ${AgentAccount.parentAgent.length}; a resolver without ctx cannot be scoping anything`
    )
  })

  it('gives an agent its upline identity without any money', async (t) => {
    if (!child) return t.skip('no parent/child agent pair in this database')
    const out = await AgentAccount.parentAgent(
      { id: child, parentAgentId: parent },
      {},
      ctxOf('agent', tenant)
    )
    assert.ok(out, 'the upline vanished entirely; identity should survive')
    const leaked = MONEY.filter((k) => out[k] !== null && out[k] !== undefined)
    assert.deepEqual(leaked, [], `an agent read its upline's ${leaked.join(', ')}`)
    assert.equal(out.parentAgentId, null, 'the walk should stop, not climb to the root')
  })

  it('does not let a nested resolver re-read what was redacted', async (t) => {
    if (!child) return t.skip('no parent/child agent pair in this database')
    const out = await AgentAccount.parentAgent(
      { id: child, parentAgentId: parent },
      {},
      ctxOf('agent', tenant)
    )
    const byDomain = await AgentAccount.settlementBalanceByDomain(out)
    for (const row of byDomain) {
      assert.equal(
        row.settlementBalance,
        0,
        `settlementBalanceByDomain re-read ${row.domain} from the database for a redacted upline`
      )
    }
  })

  it('still gives an admin the full row in their own tenant', async (t) => {
    if (!child) return t.skip('no parent/child agent pair in this database')
    const out = await AgentAccount.parentAgent(
      { id: child, parentAgentId: parent },
      {},
      ctxOf('admin', tenant)
    )
    assert.ok(out, 'an admin lost the hierarchy view this field exists to serve')
    assert.equal(String(out.id), parent)
  })

  it('refuses an admin from another tenant', async (t) => {
    if (!child) return t.skip('no parent/child agent pair in this database')
    const other = tenant === 'default' ? 'grandwinn-com' : 'default'
    const out = await AgentAccount.parentAgent(
      { id: child, parentAgentId: parent },
      {},
      ctxOf('admin', other)
    )
    assert.equal(out, null, 'an agent row crossed a tenant boundary')
  })
})
