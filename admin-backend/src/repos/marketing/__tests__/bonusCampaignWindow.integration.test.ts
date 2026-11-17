/**
 * A bonus campaign starts and ends at the instant the admin typed (MAR-04).
 *
 * Measured before: Start 2030-01-01 10:00 IST / End 2030-01-31 18:30 IST were stored as
 * 2029-12-31T18:30:00Z (01 Jan 00:00 IST) and 2030-01-31T18:29:59.999Z (31 Jan 23:59:59 IST):
 * create and update ran the form's instant through the date-FILTER helpers parseDateFrom /
 * parseDateTo, which round any timestamp to its IST day. The player side gates on these columns,
 * so the campaign went live hours early and ran past its end.
 *
 * Driven through the real guarded marketing mutations against one throwaway `vfyfix-` tenant,
 * whose bonus_campaigns rows are removed afterwards. Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const T = `vfyfix-bonus-${randomUUID().replace(/-/g, '').slice(0, 6)}`

let db: (typeof import('@src/db/client.js'))['db']
let Mutation: Record<string, any> = {}

const ctx = {
  user: { sub: '987655', name: 'vfyfix bonus', roles: ['Whitelabel Admin'], type: 'admin' },
  permissions: [{ domain: 'bonuses.create', actions: ['create'] }, { domain: 'bonuses.detail', actions: ['update'] }],
  tenant: T,
  whitelabel: { id: T },
  request: { headers: {} },
}
const m = async (field: string, input: Record<string, unknown>) => Mutation[field](undefined, { input }, ctx, {})

const base = { domain: 'global', type: 'deposit', status: 'draft', currency: 'INR', amountType: 'percentage', percentage: 10 }

async function stored(id: string) {
  const rows = (await db.execute(sql`SELECT start_date, end_date, valid_from FROM bonus_campaigns WHERE id = ${Number(id)} AND tenant = ${T}`)).rows as any[]
  const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString())
  return { start: iso(rows[0]?.start_date), end: iso(rows[0]?.end_date), validFrom: iso(rows[0]?.valid_from) }
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { marketingResolvers } = await import('@src/domains/marketing/resolvers/index.js')
  Mutation = marketingResolvers.Mutation as any
})

after(async () => {
  if (db) await db.execute(sql`DELETE FROM bonus_campaigns WHERE tenant = ${T}`)
})

describe('bonus campaign start and end', () => {
  let id = ''

  it('keeps the typed time on create', async () => {
    // What the form sends for 01 Jan 2030 10:00 IST and 31 Jan 2030 18:30 IST.
    const res = await m('createBonusCampaignV2', { ...base, name: 'vfyfix Time', startDate: '2030-01-01T04:30:00.000Z', endDate: '2030-01-31T13:00:00.000Z' })
    assert.equal(res.success, true, res.message)
    id = res.campaign.id
    assert.equal(res.campaign.startDate, '2030-01-01T04:30:00.000Z')
    assert.equal(res.campaign.endDate, '2030-01-31T13:00:00.000Z')
    assert.deepEqual(await stored(id), { start: '2030-01-01T04:30:00.000Z', end: '2030-01-31T13:00:00.000Z', validFrom: null })
  })

  it('keeps the typed time on update, and an unchanged instant stays put', async () => {
    // 02 Jan 2030 21:15 IST; the end is re-sent unchanged, as the edit page does.
    const res = await m('updateBonusCampaign', { id, startDate: '2030-01-02T15:45:00.000Z', endDate: '2030-01-31T13:00:00.000Z' })
    assert.equal(res.success, true, res.message)
    assert.deepEqual(await stored(id), { start: '2030-01-02T15:45:00.000Z', end: '2030-01-31T13:00:00.000Z', validFrom: null })
  })

  it('still reads a bare date as the whole IST day', async () => {
    const res = await m('createBonusCampaignV2', { ...base, name: 'vfyfix Days', startDate: '2030-03-01', endDate: '2030-03-31', validFrom: '2030-03-01' })
    assert.equal(res.success, true, res.message)
    assert.deepEqual(await stored(res.campaign.id), {
      start: '2030-02-28T18:30:00.000Z',
      end: '2030-03-31T18:29:59.999Z',
      validFrom: '2030-02-28T18:30:00.000Z',
    })
  })

  it('refuses an end before the start, and a date that is not one', async () => {
    const backwards = await m('createBonusCampaignV2', { ...base, name: 'vfyfix Backwards', startDate: '2030-02-01T00:00:00.000Z', endDate: '2030-01-01T00:00:00.000Z' })
    assert.deepEqual([backwards.success, backwards.message], [false, 'End date must be after start date'])

    // Only the end moves: it is checked against the stored start (02 Jan 15:45Z).
    const early = await m('updateBonusCampaign', { id, endDate: '2030-01-02T10:00:00.000Z' })
    assert.deepEqual([early.success, early.message], [false, 'End date must be after start date'])
    assert.equal((await stored(id)).end, '2030-01-31T13:00:00.000Z')

    const garbage = await m('updateBonusCampaign', { id, startDate: 'next week' })
    assert.deepEqual([garbage.success, garbage.message], [false, 'Start date is not a valid date'])

    const count = (await db.execute(sql`SELECT count(*)::int AS n FROM bonus_campaigns WHERE tenant = ${T}`)).rows as any[]
    assert.equal(count[0].n, 2)
  })
})
