import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { appConfigs, auditLogs, userPayoutAccounts, users, wallets, whitelabels, withdrawalRequests } from '@shared/db/schema.js'
import { paymentsQueryResolvers } from '../resolvers/queries.js'
import { paymentsMutationResolvers } from '../resolvers/mutations.js'

// The withdrawal queue as a reviewer works it: the search box, the task link (one request by id), a change
// made from a stale drawer, and View History. On an isolated vfyfix tenant. Audit rows are never deleted
// (audit_logs.resource_id is shared by every resource type), so this file leaves its own behind.
const tenant = `vfyfix-wd-${randomUUID().slice(0, 12)}`
const VIEW = [{ domain: 'payments.withdrawals', actions: ['view'] }]
const REVIEW = [{ domain: 'payments.withdrawals', actions: ['view', 'approve', 'reject'] }]

let reviewerId = 0
/** accountId: the player's APPROVED payout account, which a request names unless a test says otherwise. */
const players: Record<'alpha' | 'beta', { id: number; walletId: number; username: string; accountId: number }> = {} as any
/** Random letters only, so a search for a request id can never match a username or e-mail. */
const letters = () => randomUUID().replace(/[^a-f]/g, '').slice(0, 8)

const ctx = (permissions = REVIEW) => ({ tenant, permissions, user: { type: 'admin', sub: String(reviewerId), roles: ['Admin'] } })
const list = (input: Record<string, unknown>) => paymentsQueryResolvers.adminWithdrawalRequests(null, { input }, ctx(VIEW))
const ids = (r: { items: Array<{ id: string }> }) => r.items.map(i => Number(i.id)).sort((a, b) => a - b)
const setStatus = (id: number, status: string, note?: string) =>
  paymentsMutationResolvers.setWithdrawalStatus(null, { input: { id: String(id), status, note } }, ctx()) as Promise<any>
const history = (id: number | string) => paymentsQueryResolvers.adminWithdrawalHistory(null, { id: String(id) }, ctx(VIEW)) as Promise<any[]>
const statusAudits = async (id: number) => db.select().from(auditLogs).where(and(
  eq(auditLogs.tenant, tenant), eq(auditLogs.domain, 'payments'), eq(auditLogs.action, 'withdrawal_status_update'),
  eq(auditLogs.resourceType, 'withdrawal_request'), eq(auditLogs.resourceId, String(id))))
const cash = async (walletId: number) => Number((await db.select().from(wallets).where(eq(wallets.id, walletId)))[0].cash)

async function request(player: 'alpha' | 'beta', amount = 100, status: 'PENDING' | 'COMPLETED' = 'PENDING', createdAt?: Date,
  payoutAccountId: number | null = players[player].accountId) {
  const p = players[player]
  const [row] = await db.insert(withdrawalRequests).values({
    tenant, userId: p.id, walletId: p.walletId, payoutAccountId, amount: String(amount), currency: 'INR', status,
    ...(createdAt ? { createdAt, updatedAt: createdAt } : {}),
  }).returning()
  return row.id
}

before(async () => {
  await db.insert(whitelabels).values({ id: tenant, name: 'vfyfix withdrawals', domain: `${tenant}.invalid`,
    creditLimit: '1000000', creditUsed: '50000', creditAvailable: '950000' })
  await db.insert(appConfigs).values({ whitelabelId: tenant, timeZone: 'Asia/Kolkata' })
  const [reviewer] = await db.insert(users).values({ tenant, name: 'vfyfix Reviewer', username: `vfyfix-reviewer-${letters()}`,
    passwordHash: 'test-not-login', playerType: 'REGULAR' }).returning()
  reviewerId = reviewer.id
  for (const [key, phone] of [['alpha', '9811100001'], ['beta', '9822200002']] as const) {
    const username = `vfyfix-${key}-${letters()}`
    const [user] = await db.insert(users).values({ tenant, name: `vfyfix ${key[0].toUpperCase()}${key.slice(1)}`, username, phone,
      email: `${username}@example.invalid`, passwordHash: 'test-not-login', playerType: 'REGULAR' }).returning()
    const [wallet] = await db.insert(wallets).values({ tenant, userId: user.id, currency: 'INR', cash: '5000' }).returning()
    const [account] = await db.insert(userPayoutAccounts).values({ tenant, userId: user.id, method: 'BANK', accountNumber: `555${phone}`,
      ifscCode: 'SBIN0000001', bankName: 'vfyfix Bank', accountHolderName: `vfyfix ${key}`, approvalStatus: 'APPROVED' }).returning()
    players[key] = { id: user.id, walletId: wallet.id, username, accountId: account.id }
  }
})

after(async () => {
  await new Promise(resolve => setTimeout(resolve, 100))
  await db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM wallet_ledger WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM ledger_entries WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM withdrawal_requests WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM user_payout_accounts WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM notifications WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM agent_credit_ledger WHERE tenant_id=${tenant}`)
    await tx.execute(sql`DELETE FROM wallets WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM users WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM app_configs WHERE whitelabel_id=${tenant}`)
    await tx.execute(sql`DELETE FROM whitelabels WHERE id=${tenant}`)
  })
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('the withdrawal search box and task links', () => {
  let alpha1 = 0
  let alpha2 = 0
  let beta1 = 0
  before(async () => {
    alpha1 = await request('alpha')
    alpha2 = await request('alpha', 250)
    beta1 = await request('beta', 400, 'COMPLETED', new Date('2026-07-30T16:09:00Z'))
  })

  it('finds a player by name, username, phone or email, case-insensitively', async () => {
    assert.deepEqual(ids(await list({ query: 'VFYFIX alpha' })), [alpha1, alpha2])
    assert.deepEqual(ids(await list({ query: players.beta.username.slice(0, 14) })), [beta1])
    assert.deepEqual(ids(await list({ query: '9822200002' })), [beta1])
    assert.deepEqual(ids(await list({ query: `${players.alpha.username}@example` })), [alpha1, alpha2])
    const both = await list({ query: 'vfyfix' })
    assert.equal(both.total, 3, 'the count follows the search, not the whole queue')
  })

  it('finds a request by its id, and ignores a one-character search as the page does', async () => {
    assert.deepEqual(ids(await list({ query: String(alpha2) })), [alpha2])
    assert.equal((await list({ query: 'v' })).total, 3)
  })

  it('takes LIKE wildcards literally', async () => {
    assert.equal((await list({ query: '%%' })).total, 0)
    assert.equal((await list({ query: 'vfyfix_alpha' })).total, 0, 'an underscore is not a one-character wildcard')
  })

  it('opens one request by id whatever its status or age, and an impossible id matches nothing', async () => {
    const one = await list({ id: String(beta1) })
    assert.deepEqual(ids(one), [beta1])
    assert.equal(one.items[0].status, 'COMPLETED')
    assert.equal((await list({ id: '99999999999' })).total, 0, 'beyond int4 is no match rather than an SQL error')
    assert.equal((await list({ id: 'abc' })).total, 0)
  })

  it('never reaches another tenant', async () => {
    const other = await list({ id: String(beta1) })
    assert.ok(other.items.every((i: any) => i.user?.name?.startsWith('vfyfix')))
    const foreign = await paymentsQueryResolvers.adminWithdrawalRequests(null, { input: { id: String(beta1) } },
      { ...ctx(VIEW), tenant: `${tenant}-other` })
    assert.equal(foreign.total, 0)
  })
})

describe('a change from a stale drawer', () => {
  it('refuses to change a request another reviewer already settled, and audits nothing', async () => {
    const id = await request('alpha', 300)
    const walletBefore = await cash(players.alpha.walletId)

    const first = await setStatus(id, 'COMPLETED', 'vfyfix paid')
    assert.equal(first.success, true)
    assert.equal(first.request.status, 'COMPLETED')
    assert.equal((await statusAudits(id)).length, 1)

    const stale = await setStatus(id, 'CANCELLED', 'vfyfix stale cancel')
    assert.equal(stale.success, false)
    assert.match(stale.message, /already COMPLETED/)
    assert.equal(stale.request.status, 'COMPLETED', 'the reply carries the status it really has')
    assert.equal((await statusAudits(id)).length, 1, 'no CANCELLED audit for a change that never happened')
    const playerAudits = await db.select().from(auditLogs).where(and(eq(auditLogs.tenant, tenant), eq(auditLogs.domain, 'players'),
      eq(auditLogs.resourceId, String(players.alpha.id)), sql`${auditLogs.after}->>'status' = 'CANCELLED'`))
    assert.equal(playerAudits.length, 0)
    assert.equal(await cash(players.alpha.walletId), walletBefore, 'no refund')
    const [row] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id))
    assert.equal(row.status, 'COMPLETED')
    assert.equal(row.note, 'vfyfix paid')
  })

  it('records the status it moved the request from', async () => {
    const id = await request('beta', 50)
    await setStatus(id, 'PROCESSING')
    await setStatus(id, 'FAILED', 'vfyfix bank refused')
    const audits = (await statusAudits(id)).sort((a, b) => a.id - b.id)
    assert.deepEqual(audits.map(a => [(a.before as any)?.status, (a.after as any)?.status]), [['PENDING', 'PROCESSING'], ['PROCESSING', 'FAILED']])
  })
})

describe('View History', () => {
  it('lists every review of a request oldest first, starting from its creation', async () => {
    // Created a minute back, as a real request is. created_at comes from the database clock and a review time
    // from this process's Date.now(), which on Windows can trail it by up to a timer tick (~16 ms): more than
    // the few ms between an insert and a review made right after it, so the creation row sometimes sorted last.
    const id = await request('alpha', 120, 'PENDING', new Date(Date.now() - 60_000))
    await setStatus(id, 'PROCESSING', 'vfyfix picked up')
    await setStatus(id, 'COMPLETED', 'vfyfix done')
    const rows = await history(id)
    assert.deepEqual(rows.map(r => r.status), ['PENDING', 'PROCESSING', 'COMPLETED'])
    assert.equal(rows[0].reviewerId, null)
    assert.deepEqual(rows.slice(1).map(r => r.reviewerId), ['vfyfix Reviewer', 'vfyfix Reviewer'])
    assert.equal(rows[2].note, 'vfyfix done')
  })

  it('keeps the reviews of a request reviewed before the tenant\'s 100 newest status changes', async () => {
    const createdAt = new Date('2026-07-30T16:09:00Z')
    const id = await request('beta', 400, 'COMPLETED', createdAt)
    await db.update(withdrawalRequests).set({ reviewerId, reviewedAt: new Date('2026-07-30T16:17:23Z'), note: 'vfyfix IOB' })
      .where(eq(withdrawalRequests.id, id))
    const audit = (at: string, from: string, to: string, note: string | null) => ({
      tenant, actorId: String(reviewerId), domain: 'payments', action: 'withdrawal_status_update', resourceType: 'withdrawal_request',
      resourceId: String(id), before: { status: from, note: null }, after: { status: to, note, reviewerId: String(reviewerId), reviewedAt: at },
      createdAt: new Date(at),
    })
    await db.insert(auditLogs).values([
      audit('2026-07-30T16:14:02.000Z', 'PENDING', 'PROCESSING', null),
      audit('2026-07-30T16:17:23.000Z', 'PROCESSING', 'COMPLETED', 'vfyfix IOB'),
    ])
    // 100 newer status changes of other requests: the old read never looked further back than these.
    await db.execute(sql`
      INSERT INTO audit_logs (tenant, actor_id, domain, action, resource_type, resource_id, before, after)
      SELECT ${tenant}, 'vfyfix-filler', 'payments', 'withdrawal_status_update', 'withdrawal_request', '0',
             '{"status":"PENDING"}'::jsonb, '{"status":"PROCESSING"}'::jsonb
      FROM generate_series(1, 100)`)

    const rows = await history(id)
    assert.deepEqual(rows.map(r => r.status), ['PENDING', 'PROCESSING', 'COMPLETED'])
    assert.equal(rows[0].reviewedAt, createdAt.toISOString(), 'the creation row is at the creation time')
    assert.deepEqual(rows.slice(1).map(r => [r.reviewerId, r.reviewedAt]), [
      ['vfyfix Reviewer', '2026-07-30T16:14:02.000Z'],
      ['vfyfix Reviewer', '2026-07-30T16:17:23.000Z'],
    ])
  })

  it('shows a request that was never reviewed as created, and a change made outside the queue from the row', async () => {
    const open = await request('alpha', 70)
    const rows = await history(open)
    assert.deepEqual(rows.map(r => [r.status, r.reviewerId]), [['PENDING', null]])

    // A WeLivePay settlement writes the row but no status audit.
    const settled = await request('alpha', 80)
    const reviewedAt = new Date(Date.now() + 60_000)
    await db.update(withdrawalRequests).set({ status: 'COMPLETED', reviewerId, reviewedAt, note: 'vfyfix gateway paid' })
      .where(eq(withdrawalRequests.id, settled))
    const settledRows = await history(settled)
    assert.deepEqual(settledRows.map(r => r.status), ['PENDING', 'COMPLETED'])
    assert.equal(settledRows[1].reviewedAt, reviewedAt.toISOString())
    assert.equal(settledRows[1].note, 'vfyfix gateway paid')
  })

  it('answers an id that cannot exist with an empty history', async () => {
    assert.deepEqual(await history('abc'), [])
    assert.deepEqual(await history(99999999999), [])
  })
})

describe('paying out needs the payout account to be approved at pay time (FIN-05)', () => {
  /** Another payout account of `player`, in the given review state. */
  async function account(player: 'alpha' | 'beta', approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const [row] = await db.insert(userPayoutAccounts).values({ tenant, userId: players[player].id, method: 'BANK',
      accountNumber: `5550${Date.now() % 1e8}`, ifscCode: 'SBIN0000002', bankName: 'vfyfix Other Bank',
      accountHolderName: 'vfyfix Someone Else', approvalStatus }).returning()
    return row.id
  }
  const creditUsed = async () => Number((await db.select().from(whitelabels).where(eq(whitelabels.id, tenant)))[0].creditUsed)
  /** Everything paying out or refunding a request moves: the row, the wallet, the ledgers, the whitelabel credit, the audit. */
  async function moneyState(id: number, player: 'alpha' | 'beta') {
    const [row] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id))
    const [whitelabel] = await db.select().from(whitelabels).where(eq(whitelabels.id, tenant))
    const counts = (await db.execute(sql`SELECT
      (SELECT count(*)::int FROM wallet_ledger WHERE tenant = ${tenant} AND reference_id = ${String(id)}) AS "walletLedger",
      (SELECT count(*)::int FROM ledger_entries WHERE tenant = ${tenant} AND meta->>'withdrawalId' = ${String(id)}) AS "ledgerEntries",
      (SELECT count(*)::int FROM agent_credit_ledger WHERE tenant_id = ${tenant}) AS "creditLedger"`)).rows[0]
    return {
      request: { status: row.status, reviewerId: row.reviewerId, reviewedAt: row.reviewedAt, note: row.note, updatedAt: row.updatedAt,
        payoutAccountId: row.payoutAccountId },
      cash: await cash(players[player].walletId),
      credit: { used: whitelabel.creditUsed, available: whitelabel.creditAvailable },
      counts,
      audits: (await statusAudits(id)).length,
    }
  }
  const refused = (id: number, status: string, reason: RegExp) => assert.rejects(() => setStatus(id, status, 'vfyfix refused'), reason)

  it('pays from an approved account as before', async () => {
    const id = await request('alpha', 90)
    const usedBefore = await creditUsed()
    assert.equal((await setStatus(id, 'PROCESSING', 'vfyfix paying')).success, true)
    const paid = await setStatus(id, 'COMPLETED', 'vfyfix paid out')
    assert.equal(paid.success, true)
    assert.equal(paid.request.status, 'COMPLETED')
    assert.equal(await creditUsed(), usedBefore - 90, 'the whitelabel credit is released as before')
  })

  it('refuses an account still waiting for review and moves nothing, then pays once the account is approved', async () => {
    const accountId = await account('alpha', 'PENDING')
    const id = await request('alpha', 110, 'PENDING', undefined, accountId)
    const before = await moneyState(id, 'alpha')
    await refused(id, 'PROCESSING', /payout account is waiting for approval, so it cannot be paid/)
    await refused(id, 'COMPLETED', /payout account is waiting for approval, so it cannot be paid/)
    assert.deepEqual(await moneyState(id, 'alpha'), before, 'a refused payout writes nothing')

    const approved = await paymentsMutationResolvers.approvePayoutAccount(null, { input: { id: String(accountId) } }, ctx())
    assert.equal(approved.success, true)
    const paid = await setStatus(id, 'COMPLETED', 'vfyfix paid after review')
    assert.equal(paid.request.status, 'COMPLETED')
  })

  it('refuses an account rejected after the request was stored, and still lets the request be cancelled with a refund', async () => {
    const accountId = await account('beta', 'APPROVED')
    const id = await request('beta', 130, 'PENDING', undefined, accountId)
    assert.equal((await setStatus(id, 'PROCESSING', 'vfyfix picked up')).success, true)
    const rejected = await paymentsMutationResolvers.rejectPayoutAccount(null,
      { input: { id: String(accountId), reason: 'vfyfix not the holder' } }, ctx())
    assert.equal(rejected.success, true)

    const before = await moneyState(id, 'beta')
    assert.equal(before.request.status, 'PROCESSING')
    await refused(id, 'COMPLETED', /payout account is rejected, so it cannot be paid/)
    await refused(id, 'PROCESSING', /payout account is rejected, so it cannot be paid/)
    assert.deepEqual(await moneyState(id, 'beta'), before, 'a refused payout writes nothing')

    const cancelled = await setStatus(id, 'CANCELLED', 'vfyfix refund')
    assert.equal(cancelled.success, true)
    assert.equal(await cash(players.beta.walletId), before.cash + 130, 'the refund is never refused')
  })

  it('refuses a request whose payout account no longer exists', async () => {
    const id = await request('alpha', 140, 'PENDING', undefined, null)
    const before = await moneyState(id, 'alpha')
    await refused(id, 'COMPLETED', /payout account no longer exists, so it cannot be paid/)
    await refused(id, 'PROCESSING', /payout account no longer exists, so it cannot be paid/)
    assert.deepEqual(await moneyState(id, 'alpha'), before, 'a refused payout writes nothing')
  })

  it("refuses another player's account named by the request as missing", async () => {
    const id = await request('alpha', 150, 'PENDING', undefined, players.beta.accountId)
    const before = await moneyState(id, 'alpha')
    await refused(id, 'COMPLETED', /payout account no longer exists/)
    assert.deepEqual(await moneyState(id, 'alpha'), before, 'a refused payout writes nothing')
  })
})
