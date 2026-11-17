/**
 * The referral totals read the tenant's referral data (MAR-09, MAR-10).
 *
 * Measured before, on grandwinn (78 clicks, 11 confirmed attributions from 7 referrers, no earnings):
 *   - referralStats returned hard-coded zeros, so all six /referrals cards read 0;
 *   - topReferrers started from referral_earnings, so it listed nobody, and referrerStats took
 *     "Total Referrals" from referees with earnings: referrer 234 read 0 referrals next to "2 active".
 *
 * Builds one throwaway `vfyfix-` tenant (and a second one that must not leak into it) out of
 * clicks, attributions, earnings and a settlement, and removes them afterwards. The ids are far
 * above any real user id because referral_attributions.referee_id is unique across tenants.
 * Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().replace(/-/g, '').slice(0, 6)
const T = `vfyfix-reft-${STAMP}`
const U = `vfyfix-reft-u-${STAMP}`
const BASE = 2_100_000_000 + Math.floor(Math.random() * 9_000_000)
const R1 = BASE + 1 // two confirmed players, one paid earning and one unpaid
const R2 = BASE + 2 // one pending player, one rejected
const R3 = BASE + 3 // clicks only
const R5 = BASE + 5 // the other tenant's referrer

let db: (typeof import('@src/db/client.js'))['db']
let repo: typeof import('@src/repos/referrals/referralEarningsRepo.js')
let Query: Record<string, any> = {}

const IN = '2030-01-10T10:00:00Z'
const JAN = { fromDate: new Date('2030-01-01T00:00:00Z'), toDate: new Date('2030-01-31T23:59:59Z') }

async function click(tenant: string, referrerId: number, at = IN) {
  await db.execute(sql`INSERT INTO referral_clicks (tenant, link_id, referrer_id, clicked_at) VALUES (${tenant}, 0, ${referrerId}, ${at})`)
}
async function attribute(tenant: string, referrerId: number, refereeId: number, status: string) {
  return Number(((await db.execute(sql`
    INSERT INTO referral_attributions (tenant, referrer_id, referee_id, status, attributed_at)
    VALUES (${tenant}, ${referrerId}, ${refereeId}, ${status}::referral_attribution_status, ${IN}) RETURNING id`)).rows[0] as any).id)
}
async function earn(tenant: string, attributionId: number, referrerId: number, refereeId: number, net: number) {
  return Number(((await db.execute(sql`
    INSERT INTO referral_earnings (tenant, attribution_id, rule_id, referrer_id, referee_id, tier, rule_type, gross_amount, net_amount, calculated_at)
    VALUES (${tenant}, ${attributionId}, 0, ${referrerId}, ${refereeId}, 1, 'FIRST_DEPOSIT_PCT', ${net}, ${net}, ${IN}) RETURNING id`)).rows[0] as any).id)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  repo = await import('@src/repos/referrals/referralEarningsRepo.js')
  const { referralsResolvers } = await import('@src/domains/referrals/resolvers/index.js')
  Query = referralsResolvers.Query as any

  for (let i = 0; i < 5; i++) await click(T, R1)
  await click(T, R1, '2029-06-01T10:00:00Z') // outside January
  await click(T, R2)
  await click(T, R3)
  await click(T, R3)
  const a1 = await attribute(T, R1, BASE + 11, 'confirmed')
  const a2 = await attribute(T, R1, BASE + 12, 'confirmed')
  await attribute(T, R2, BASE + 21, 'pending')
  await attribute(T, R2, BASE + 22, 'rejected')
  const paid = await earn(T, a1, R1, BASE + 11, 100)
  await earn(T, a2, R1, BASE + 12, 50)
  await db.execute(sql`
    INSERT INTO referral_settlements (tenant, earning_id, referrer_id, payout_type, cash_amount, bonus_amount, status, settled_at)
    VALUES (${T}, ${paid}, ${R1}, 'CASH', 100, 0, 'completed', ${IN})`)

  for (let i = 0; i < 3; i++) await click(U, R5)
  const u1 = await attribute(U, R5, BASE + 51, 'confirmed')
  await earn(U, u1, R5, BASE + 51, 999)
})

after(async () => {
  if (!db) return
  await db.execute(sql`DELETE FROM referral_settlements WHERE tenant IN (${T}, ${U})`)
  await db.execute(sql`DELETE FROM referral_earnings WHERE tenant IN (${T}, ${U})`)
  await db.execute(sql`DELETE FROM referral_attributions WHERE tenant IN (${T}, ${U})`)
  await db.execute(sql`DELETE FROM referral_clicks WHERE tenant IN (${T}, ${U})`)
})

describe('referral overview totals (MAR-09)', () => {
  it('counts the tenant clicks, signups, earnings, settled and pending', async () => {
    assert.deepEqual(await repo.getReferralOverviewStatsDb(T), {
      totalClicks: 9,
      totalSignups: 2,
      totalAttributions: 4,
      totalEarnings: 150,
      totalSettled: 100,
      totalPending: 50,
    })
  })

  it('takes each figure over its own date in the range', async () => {
    assert.equal((await repo.getReferralOverviewStatsDb(T, JAN)).totalClicks, 8)
    assert.deepEqual(await repo.getReferralOverviewStatsDb(T, { fromDate: new Date('2031-01-01T00:00:00Z') }), {
      totalClicks: 0, totalSignups: 0, totalAttributions: 0, totalEarnings: 0, totalSettled: 0, totalPending: 0,
    })
  })

  it('answers through the guarded resolver with the tenant currency and period', async () => {
    const ctx = {
      user: { sub: '987654', name: 'vfyfix ref', roles: ['Whitelabel Admin'], type: 'admin' },
      permissions: [{ domain: 'referrals.overview', actions: ['view'] }],
      tenant: T,
      whitelabel: { id: T },
      request: { headers: {} },
    }
    const stats = await Query.referralStats(undefined, { fromDate: '2030-01-01T00:00:00Z', toDate: '2030-01-31T23:59:59Z' }, ctx)
    assert.deepEqual(
      [stats.totalClicks, stats.totalSignups, stats.totalEarnings, stats.totalSettled, stats.totalPending, stats.periodStart],
      [8, 2, 150, 100, 50, '2030-01-01T00:00:00Z'],
    )
    assert.equal(typeof stats.currency, 'string')
    await assert.rejects(async () => Query.referralStats(undefined, {}, { ...ctx, permissions: [] }), /referrals\.overview:view/)
  })
})

describe('top referrers and referrer stats (MAR-10)', () => {
  it('lists every referrer with activity, counting referred players', async () => {
    const rows = await repo.getTopReferrersDb(T, { sortBy: 'referrals' })
    assert.deepEqual(rows.map((r) => [r.referrerId, r.totalReferrals, r.activeReferrals, r.totalEarnings, r.totalClicks]), [
      [R1, 2, 2, 150, 6],
      [R2, 1, 0, 0, 1],
      [R3, 0, 0, 0, 2],
    ])
    assert.ok(!rows.some((r) => r.referrerId === R5), 'another tenant stays out')
  })

  it('sorts by earnings and by conversion, ties going to more referrals', async () => {
    assert.deepEqual((await repo.getTopReferrersDb(T, { sortBy: 'earnings' })).map((r) => r.referrerId), [R1, R2, R3])
    const byConversion = await repo.getTopReferrersDb(T, { sortBy: 'conversion' })
    assert.deepEqual(byConversion.map((r) => [r.referrerId, r.conversionRate]), [[R2, 200], [R1, 33.33], [R3, 0]])
    assert.deepEqual((await repo.getTopReferrersDb(T, { sortBy: 'referrals', limit: 1 })).map((r) => r.referrerId), [R1])
  })

  it('gives a referrer its referred players as Total Referrals', async () => {
    const r1 = await repo.getReferrerStatsDb(R1, T)
    assert.deepEqual(
      [r1.totalReferrals, r1.activeReferrals, r1.totalClicks, r1.totalAttributions, r1.totalEarnings, r1.conversionRate],
      [2, 2, 6, 2, 150, 33.33],
    )
    const r2 = await repo.getReferrerStatsDb(R2, T)
    assert.deepEqual([r2.totalReferrals, r2.activeReferrals, r2.totalAttributions], [1, 0, 2])
    assert.equal((await repo.getReferrerStatsDb(R5, T)).totalReferrals, 0)
  })
})
