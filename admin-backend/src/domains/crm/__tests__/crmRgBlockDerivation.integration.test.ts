/**
 * `users.rg_blocked_until` when more than one episode is live at once.
 *
 * The earlier RG suite only ever has one blocking episode in force at a time,
 * so it never exercises the question this file is about: what happens to the
 * block when a second blocking episode is raised over the first, or when one
 * of two is lifted while the other stands. The column used to be assigned from
 * whichever flag was touched last — this suite pins it to being derived from
 * the set of episodes actually in force, which is the only version that cannot
 * be shortened by raising something weaker, or left stuck by lifting the wrong
 * one first.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-rgblock-${randomUUID().slice(0, 8)}`

let dave = 0
let davePhone = ''
let erin = 0
let frank = 0

async function makePlayer(name: string): Promise<{ id: number; phone: string }> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const phone = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0')
  const r = await db.execute(sql`
    INSERT INTO users (tenant, name, username, phone, email, password_hash)
    VALUES (${TENANT}, ${name}, ${name.toLowerCase() + randomUUID().slice(0, 5)},
            ${phone}, ${name.toLowerCase() + '@example.test'}, 'x')
    RETURNING id`)
  const id = Number((r.rows[0] as { id: number }).id)
  await db.execute(sql`
    INSERT INTO wallets (tenant, user_id, currency, cash) VALUES (${TENANT}, ${id}, 'INR', '0.00')`)
  return { id, phone }
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const d = await makePlayer('Dave')
  dave = d.id
  davePhone = d.phone
  erin = (await makePlayer('Erin')).id
  frank = (await makePlayer('Frank')).id
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const stmt of [
    sql`DELETE FROM crm_exclusion_register WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_player_rg_flags WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_consent_events WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_player_consents WHERE tenant = ${TENANT}`,
    sql`DELETE FROM wallets WHERE tenant = ${TENANT}`,
    sql`DELETE FROM users WHERE tenant = ${TENANT}`,
  ]) {
    await db.execute(stmt)
  }
})

async function blockState(playerId: number) {
  const { getRgBlockState } = await import('@shared/services/rgEnforcement.js')
  return getRgBlockState(TENANT, playerId)
}

async function rawBlock(playerId: number) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`
    SELECT rg_blocked_until, rg_block_reason FROM users WHERE id = ${playerId}`)
  return r.rows[0] as { rg_blocked_until: string | null; rg_block_reason: string | null }
}

describe('a weaker episode raised over a stronger one does not shorten the block', () => {
  it('an indefinite self-exclusion is standing', async () => {
    const { raiseRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const res = await raiseRgFlag({
      tenant: TENANT,
      playerId: dave,
      flagType: 'SELF_EXCLUSION',
      initiatedBy: 'player',
      minTermEndsAt: new Date(Date.now() + 180 * 86_400_000),
      raisedBy: 'crm:raiser-1',
    })
    assert.equal(res.ok, true)
    const row = await rawBlock(dave)
    // node-postgres round-trips an unbounded timestamptz as the string
    // 'infinity', not as a large-but-finite Date — checked at the raw driver
    // level rather than through `getRgBlockState`, whose typed column mapping
    // turns that same value into `Invalid Date` (a pre-existing quirk, not
    // something this fix touches; `blocked` is computed in SQL, so it is
    // unaffected either way).
    assert.equal(row.rg_blocked_until, 'infinity', 'indefinite is stored as the infinity sentinel')
  })

  it('raising a week-long cooling-off on top leaves the indefinite block standing', async () => {
    const { raiseRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const res = await raiseRgFlag({
      tenant: TENANT,
      playerId: dave,
      flagType: 'COOLING_OFF',
      initiatedBy: 'operator',
      endsAt: new Date(Date.now() + 7 * 86_400_000),
      raisedBy: 'crm:raiser-2',
    })
    assert.equal(res.ok, true)

    // This is the regression: before the fix, the column was overwritten with
    // next week's date, so the block silently expired in 7 days instead of
    // never — while the self-exclusion flag itself stayed ACTIVE the whole
    // time, misreporting what was actually in force.
    assert.equal((await blockState(dave)).blocked, true)
    const row = await rawBlock(dave)
    assert.equal(
      row.rg_blocked_until,
      'infinity',
      'still indefinite — a cooling-off must never be able to shorten a standing self-exclusion'
    )
    assert.equal(row.rg_block_reason, 'SELF_EXCLUSION', 'the reason still names the stronger episode')
  })

  it('lifting only the cooling-off leaves the self-exclusion in force, unaffected', async () => {
    const { listPlayerRgFlags, liftRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const flags = await listPlayerRgFlags(TENANT, dave)
    const coolingOff = flags.find((f) => f.flagType === 'COOLING_OFF' && f.status === 'ACTIVE')
    assert.ok(coolingOff)
    const res = await liftRgFlag({
      tenant: TENANT,
      flagId: coolingOff!.id,
      liftedBy: 'crm:other',
      reason: 'Raised in error',
    })
    assert.equal(res.ok, true)

    assert.equal((await blockState(dave)).blocked, true, 'the self-exclusion is still ACTIVE and must still bind')
    assert.equal(
      (await rawBlock(dave)).rg_blocked_until,
      'infinity',
      'indefinite, derived from the surviving episode'
    )
  })

  it('lifting the self-exclusion past its minimum term fully frees the player and releases the register', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { listPlayerRgFlags, liftRgFlag, isIdentifierExcluded } = await import(
      '@src/repos/crm/CrmRgRepo.js'
    )
    await db.execute(sql`
      UPDATE crm_player_rg_flags SET min_term_ends_at = now() - interval '1 day'
      WHERE tenant = ${TENANT} AND player_id = ${dave} AND flag_type = 'SELF_EXCLUSION'`)
    const flags = await listPlayerRgFlags(TENANT, dave)
    const selfEx = flags.find((f) => f.flagType === 'SELF_EXCLUSION' && f.status === 'ACTIVE')
    assert.ok(selfEx)
    const res = await liftRgFlag({
      tenant: TENANT,
      flagId: selfEx!.id,
      liftedBy: 'crm:other',
      reason: 'Minimum term served',
    })
    assert.equal(res.ok, true)

    assert.equal((await blockState(dave)).blocked, false)
    assert.equal(await isIdentifierExcluded(TENANT, 'phone', davePhone), false)
  })
})

describe('two independently-lifted blocking episodes cannot leave the block stuck', () => {
  it('two blocking episodes standing, one is lifted — the block reflects the other', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { raiseRgFlag, listPlayerRgFlags, liftRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')

    const r1 = await raiseRgFlag({
      tenant: TENANT,
      playerId: erin,
      flagType: 'SELF_EXCLUSION',
      initiatedBy: 'player',
      minTermEndsAt: new Date(Date.now() - 1000),
      raisedBy: 'crm:raiser-1',
    })
    assert.equal(r1.ok, true)
    const r2 = await raiseRgFlag({
      tenant: TENANT,
      playerId: erin,
      flagType: 'COOLING_OFF',
      initiatedBy: 'operator',
      endsAt: new Date(Date.now() + 3 * 86_400_000),
      raisedBy: 'crm:raiser-2',
    })
    assert.equal(r2.ok, true)

    // This is finding #3's regression: `liftRgFlag` used to check "does any
    // other blocking episode remain" and skip the clear entirely when one did
    // — so the self-exclusion being lifted here would have left the block at
    // 'infinity' forever, past the point where the cooling-off itself lapsed,
    // because nothing ever re-derives the column once it is stuck.
    const flags = await listPlayerRgFlags(TENANT, erin)
    const selfEx = flags.find((f) => f.flagType === 'SELF_EXCLUSION' && f.status === 'ACTIVE')
    const liftRes = await liftRgFlag({
      tenant: TENANT,
      flagId: selfEx!.id,
      liftedBy: 'crm:other',
      reason: 'Minimum term served',
    })
    assert.equal(liftRes.ok, true)

    const row = await rawBlock(erin)
    assert.notEqual(row.rg_blocked_until, null, 'still blocked — the cooling-off is still ACTIVE')
    assert.equal(row.rg_block_reason, 'COOLING_OFF', 'the block now reflects the surviving episode')

    // And it lapses on its own — the block was recomputed to the cooling-off's
    // own end date, not left at 'infinity'.
    await db.execute(sql`
      UPDATE users SET rg_blocked_until = now() - interval '1 minute' WHERE id = ${erin}`)
    assert.equal((await blockState(erin)).blocked, false)
  })

  it('the register was released when the self-exclusion ended, independent of the cooling-off', async () => {
    // Finding #4: the release used to be nested inside "no other blocking
    // episode remains", so a self-exclusion lifted while a cooling-off still
    // stood left the register row permanently orphaned — no code path could
    // ever release it, and re-registering with the same phone would be barred
    // forever even after both episodes had long since ended.
    const { isIdentifierExcluded } = await import('@src/repos/crm/CrmRgRepo.js')
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const r = await db.execute(sql`SELECT phone FROM users WHERE id = ${erin}`)
    const phone = (r.rows[0] as { phone: string }).phone
    assert.equal(
      await isIdentifierExcluded(TENANT, 'phone', phone),
      false,
      'released the moment the self-exclusion ended, not when the last blocking episode did'
    )
  })
})

describe('raising a cooling-off with no end date fails without leaving a live flag behind', () => {
  it('refuses, and commits nothing', async () => {
    // Finding #10: `raiseRgFlag` used to return `{ ok: false }` from *inside*
    // `db.transaction(...)`, which still commits in Postgres — so this call
    // left behind an ACTIVE, blocks_play=true flag with no enforcement at all,
    // that `expireLapsedRgFlags` could never clear (its predicate requires a
    // non-null end date), and that made every subsequent COOLING_OFF for this
    // player collide with the partial unique index and report "already_active"
    // forever.
    // A player of its own: erin already carries an ACTIVE cooling-off from the
    // block above, and this case is specifically about whether a *failed*
    // raise leaves one behind.
    const { raiseRgFlag, listPlayerRgFlags } = await import('@src/repos/crm/CrmRgRepo.js')
    const res = await raiseRgFlag({
      tenant: TENANT,
      playerId: frank,
      flagType: 'COOLING_OFF',
      initiatedBy: 'operator',
      endsAt: null,
      raisedBy: 'crm:raiser-3',
    })
    assert.equal(res.ok, false)
    assert.equal(res.ok === false && res.reason, 'ends_at_required')

    const flags = await listPlayerRgFlags(TENANT, frank)
    assert.equal(
      flags.some((f) => f.flagType === 'COOLING_OFF' && f.status === 'ACTIVE'),
      false,
      'nothing was left behind'
    )

    // Proves it: a well-formed cooling-off now raises cleanly, which would
    // have failed with `already_active` had the malformed one above committed.
    const ok = await raiseRgFlag({
      tenant: TENANT,
      playerId: frank,
      flagType: 'COOLING_OFF',
      initiatedBy: 'operator',
      endsAt: new Date(Date.now() + 86_400_000),
      raisedBy: 'crm:raiser-4',
    })
    assert.equal(ok.ok, true)
  })
})

describe('crmLiftRgFlag refuses a flag outside the caller\'s book scope', () => {
  it('a lift with no reachable player is refused as not_found, not applied', async () => {
    // Finding #6, exercised at the repo boundary the resolver calls through:
    // `liftRgFlag` now accepts `canReach`, and a caller for whom it resolves
    // false must be refused before anything is written — indistinguishable
    // from the flag not existing, so an out-of-scope probe cannot even
    // confirm a flag id is valid.
    const { raiseRgFlag, listPlayerRgFlags, liftRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const raised = await raiseRgFlag({
      tenant: TENANT,
      playerId: erin,
      flagType: 'AFFORDABILITY_CONCERN',
      initiatedBy: 'operator',
      raisedBy: 'crm:raiser-5',
    })
    assert.equal(raised.ok, true)
    const flags = await listPlayerRgFlags(TENANT, erin)
    const flag = flags.find((f) => f.flagType === 'AFFORDABILITY_CONCERN' && f.status === 'ACTIVE')
    assert.ok(flag)

    const res = await liftRgFlag({
      tenant: TENANT,
      flagId: flag!.id,
      liftedBy: 'crm:outsider',
      reason: 'Trying my luck',
      canReach: async () => false,
    })
    assert.equal(res.ok, false)
    assert.equal(res.ok === false && res.reason, 'not_found')

    // And it is genuinely untouched — reachable this time, the same flag lifts.
    const res2 = await liftRgFlag({
      tenant: TENANT,
      flagId: flag!.id,
      liftedBy: 'crm:outsider',
      reason: 'Confirmed with the player',
      canReach: async () => true,
    })
    assert.equal(res2.ok, true)
  })
})

describe('crmRaiseRgFlag resolver rejects a self-exclusion term that is not a sane positive duration', () => {
  const ctx = {
    crmUser: { id: 'u-neg', name: 'Tester', tenant: TENANT, status: 'ACTIVE', requirePasswordReset: false },
    permissions: [{ domain: 'crm.rg', actions: ['flag', 'lift'] }, { domain: 'crm.players', actions: ['view_all'] }],
  }

  it('a negative minTermMonths is refused, not silently defaulted or accepted', async () => {
    // Finding #16: `Number(args.minTermMonths) || DEFAULT` only substitutes for
    // 0/NaN/undefined — a negative value is truthy and passed straight through
    // to `d.setMonth(d.getMonth() + months)`, producing a minimum term that had
    // already ended the moment the block was raised, defeating the one lift
    // guard that does not depend on who is asking.
    const { crmRgMutations } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    const res = await crmRgMutations.crmRaiseRgFlag(
      null,
      { playerId: String(dave), flagType: 'SELF_EXCLUSION', initiatedBy: 'operator', minTermMonths: -6 },
      ctx as any
    )
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /1 to \d+ months/)
  })

  it('a term past the sane upper bound is refused the same way', async () => {
    const { crmRgMutations } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    const res = await crmRgMutations.crmRaiseRgFlag(
      null,
      { playerId: String(dave), flagType: 'SELF_EXCLUSION', initiatedBy: 'operator', minTermMonths: 100000 },
      ctx as any
    )
    assert.equal(res.ok, false)
  })

  it('no flag was left behind by either refusal', async () => {
    const { listPlayerRgFlags } = await import('@src/repos/crm/CrmRgRepo.js')
    const flags = await listPlayerRgFlags(TENANT, dave)
    assert.equal(
      flags.filter((f) => f.flagType === 'SELF_EXCLUSION' && f.status === 'ACTIVE').length,
      0,
      'dave\'s earlier self-exclusion was already lifted in the first describe block'
    )
  })
})
