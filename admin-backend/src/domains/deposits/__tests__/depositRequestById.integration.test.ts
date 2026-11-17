/**
 * A deposit task link finds its request whatever its age (FIN-04).
 *
 * Measured before: a task notification links to /payments/deposits?depositId=<id>, and the page could only look the
 * request up among the 100 newest, because ListDepositRequestsInput had no id (withdrawals already had one). An
 * older request was reported as not found. adminDepositRequests now takes `id`, with the same tenant and permission
 * checks as the list; an id that cannot be a request id matches nothing instead of reaching the driver.
 *
 * Driven through the real guarded Query map. Two throwaway `vfyho-` tenants with their users and requests are created
 * and removed. Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().slice(0, 8)
const T = `vfyho-dep-${STAMP}`
const U = `vfyho-dep-u-${STAMP}`

let db: (typeof import('@src/db/client.js'))['db']
let Query: Record<string, any> = {}
const ids = { old: 0, recent: [] as number[], foreign: 0 }

const at = (fieldName: string) => ({ parentType: { name: 'Query' }, fieldName })
const reviewer = (tenant: string) => ({
  user: { sub: '987001', name: 'vfyho reviewer', roles: ['vfyho reviewer'], type: 'admin' },
  permissions: [{ domain: 'payments.deposits', actions: ['view'] }],
  tenant,
  whitelabel: { id: tenant },
  request: { headers: {} },
})
const list = (input: Record<string, unknown>, tenant = T) =>
  Query.adminDepositRequests(undefined, { input }, reviewer(tenant), at('adminDepositRequests'))

/** A credited-gateway-style row (proof_key 'welivepay'), so no proof URL is signed for it. */
async function insertRequest(tenant: string, userId: number, status: string, ageDays: number): Promise<number> {
  const rows = (await db.execute(sql`
    INSERT INTO deposit_requests (tenant, user_id, amount, currency, method, proof_key, status, created_at, updated_at)
    VALUES (${tenant}, ${userId}, '100.00', 'INR', 'UPI', 'welivepay', ${status}::deposit_status,
            now() - make_interval(days => ${ageDays}), now() - make_interval(days => ${ageDays}))
    RETURNING id`)).rows as Array<{ id: number }>
  return Number(rows[0].id)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { domainResolvers } = await import('@src/domains/index.js')
  Query = (domainResolvers as any).Query
  const userIn = async (tenant: string) =>
    Number(((await db.execute(sql`INSERT INTO users (tenant, name, password_hash) VALUES (${tenant}, 'vfyho depositor', 'x') RETURNING id`)).rows[0] as any).id)
  const player = await userIn(T)
  const foreigner = await userIn(U)
  ids.old = await insertRequest(T, player, 'APPROVED', 400)
  for (const age of [0, 1, 2]) ids.recent.push(await insertRequest(T, player, 'PENDING', age))
  ids.foreign = await insertRequest(U, foreigner, 'PENDING', 0)
  // One uncredited pay-in of T, which includeGatewayOrders lists beside the requests. 'invalid' is terminal: the
  // reconciliation job polls only pending and expired orders, so nothing ever calls the provider about it.
  await db.execute(sql`
    INSERT INTO welivepay_orders (tenant, user_id, orderid, amount, status, next_check_at, created_at, updated_at)
    VALUES (${T}, ${player}, ${'vfyho-inv-' + STAMP}, '100.00', 'invalid',
            now() + interval '365 days', now() - interval '30 days', now() - interval '30 days')`)
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM welivepay_orders WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM deposit_requests WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM users WHERE tenant IN (${T}, ${U})`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
  await closeRedisEmitter().catch(() => {})
})

describe('adminDepositRequests by id', () => {
  it('finds a request whatever its age or status, as a task link needs', async () => {
    const page = await list({ id: String(ids.old), offset: 0, limit: 1 })
    assert.equal(page.total, 1)
    assert.deepEqual(page.items.map((item: any) => [item.id, item.status]), [[String(ids.old), 'APPROVED']])
  })

  it('without an id, lists the tenant as before', async () => {
    const page = await list({ offset: 0, limit: 100 })
    assert.equal(page.total, 4)
  })

  it("does not find another tenant's request", async () => {
    const page = await list({ id: String(ids.foreign), offset: 0, limit: 1 })
    assert.equal(page.total, 0)
    assert.deepEqual(page.items, [])
  })

  it('matches nothing for an id that cannot be a request id, rather than failing in the driver', async () => {
    for (const id of ['abc', '0', '-5', '1.5', '99999999999']) {
      const page = await list({ id, offset: 0, limit: 1 })
      assert.equal(page.total, 0, `id ${id}`)
    }
  })

  it('names only deposit requests when gateway pay-ins are listed too', async () => {
    // Control: without an id the tenant's uncredited pay-in is listed beside its four requests, so the case below
    // would see it if an id did not leave the pay-ins out.
    const all = await list({ includeGatewayOrders: true, offset: 0, limit: 10 })
    assert.equal(all.total, 5)
    assert.ok(all.items.some((item: any) => String(item.id).startsWith('GW-')), 'the seeded pay-in was not listed')
    const page = await list({ id: String(ids.recent[0]), includeGatewayOrders: true, offset: 0, limit: 5 })
    assert.equal(page.total, 1)
    assert.deepEqual(page.items.map((item: any) => item.id), [String(ids.recent[0])])
  })

  it('still asks for the deposits permission', async () => {
    await assert.rejects(
      async () => Query.adminDepositRequests(undefined, { input: { id: String(ids.old) } }, { ...reviewer(T), permissions: [] }, at('adminDepositRequests')),
      /Forbidden/
    )
  })
})
