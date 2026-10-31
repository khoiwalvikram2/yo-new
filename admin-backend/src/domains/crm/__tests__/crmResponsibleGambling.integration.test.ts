/**
 * Responsible gambling, where the record and the enforcement have to agree.
 *
 * A recorded self-exclusion that does not stop play is worse than no record: it
 * reads as protection and is not. Equally, an enforcement that stops the wrong
 * things — a login, a withdrawal — strands a player's money behind an account
 * they closed themselves. Both halves are asserted here.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-rg-${randomUUID().slice(0, 8)}`

let alice = 0
let bob = 0
let alicePhone = ''
let carol = 0

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
    INSERT INTO wallets (tenant, user_id, currency, cash) VALUES (${TENANT}, ${id}, 'INR', '8400.00')`)
  return { id, phone }
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const a = await makePlayer('Alice')
  alice = a.id
  alicePhone = a.phone
  bob = (await makePlayer('Bob')).id
  // Used only by the consent suite, so no RG episode has touched its rows.
  carol = (await makePlayer('Carol')).id
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

describe('a self-exclusion is recorded and enforced together', () => {
  it('blocks staking and funding', async () => {
    const { raiseRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const res = await raiseRgFlag({
      tenant: TENANT,
      playerId: alice,
      flagType: 'SELF_EXCLUSION',
      initiatedBy: 'player',
      reason: 'Player asked to be excluded',
      minTermEndsAt: new Date(Date.now() + 180 * 86_400_000),
      raisedBy: 'crm:raiser-1',
    })
    assert.equal(res.ok, true)
    assert.equal(res.ok && res.blocked, true)

    const { assertPlayerCanStake, assertPlayerCanFund } = await import(
      '@shared/services/rgEnforcement.js'
    )
    await assert.rejects(() => assertPlayerCanStake(TENANT, alice), /responsible gambling/i)
    await assert.rejects(() => assertPlayerCanFund(TENANT, alice), /responsible gambling/i)
  })

  it('records what they were holding, so nobody has to reconstruct it', async () => {
    const { listPlayerRgFlags } = await import('@src/repos/crm/CrmRgRepo.js')
    const [flag] = await listPlayerRgFlags(TENANT, alice)
    assert.equal(Number(flag.balanceAtBlock), 8400)
  })

  it('leaves users.status alone', async () => {
    // The whole point of a separate column: an admin re-activating an account
    // must not silently resume play for a player who excluded themselves.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const r = await db.execute(sql`SELECT status::text FROM users WHERE id = ${alice}`)
    assert.equal((r.rows[0] as { status: string }).status, 'active')
  })

  it('withdraws marketing consent on every channel, and leaves service alone', async () => {
    const { getPlayerConsents } = await import('@src/repos/crm/CrmConsentRepo.js')
    const rows = await getPlayerConsents(TENANT, alice)
    const marketing = rows.filter((r) => r.purpose === 'MARKETING')
    assert.equal(marketing.length, 5, 'every channel')
    assert.ok(marketing.every((r) => r.state === 'WITHDRAWN'))
    assert.ok(marketing.every((r) => r.source === 'RG_AUTO'))
    // Service messages are not marketing: an excluded player still gets told
    // about their own withdrawal.
    assert.equal(rows.filter((r) => r.purpose === 'SERVICE').length, 0)
  })

  it('adds their phone and email to the exclusion register', async () => {
    const { isIdentifierExcluded } = await import('@src/repos/crm/CrmRgRepo.js')
    assert.equal(await isIdentifierExcluded(TENANT, 'phone', alicePhone), true)
    assert.equal(await isIdentifierExcluded(TENANT, 'phone', '9' + '1'.repeat(9)), false)
  })

  it('refuses a second active episode of the same type', async () => {
    const { raiseRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const res = await raiseRgFlag({
      tenant: TENANT,
      playerId: alice,
      flagType: 'SELF_EXCLUSION',
      initiatedBy: 'operator',
      minTermEndsAt: new Date(Date.now() + 86_400_000),
      raisedBy: 'crm:raiser-2',
    })
    assert.equal(res.ok, false)
    assert.equal(res.ok === false && res.reason, 'already_active')
  })
})

describe('what a block must never stop', () => {
  it('does not touch the columns login and withdrawal depend on', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const r = await db.execute(sql`
      SELECT status::text, withdrawal_lock, rg_blocked_until IS NOT NULL AS blocked
      FROM users WHERE id = ${alice}`)
    const row = r.rows[0] as { status: string; withdrawal_lock: boolean; blocked: boolean }
    assert.equal(row.blocked, true, 'the player is blocked')
    assert.equal(row.status, 'active', 'but can still sign in')
    assert.equal(row.withdrawal_lock, false, 'and can still take their money out')
  })
})

describe('a cooling-off ends by itself', () => {
  it('blocks while it runs', async () => {
    const { raiseRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const res = await raiseRgFlag({
      tenant: TENANT,
      playerId: bob,
      flagType: 'COOLING_OFF',
      initiatedBy: 'player',
      endsAt: new Date(Date.now() + 86_400_000),
      raisedBy: 'crm:raiser-1',
    })
    assert.equal(res.ok, true)
    assert.equal((await blockState(bob)).blocked, true)
  })

  it('frees the player when it lapses, with nothing having run', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    // Move the end into the past. No sweep, no job — the block is a timestamp.
    await db.execute(sql`
      UPDATE users SET rg_blocked_until = now() - interval '1 minute' WHERE id = ${bob}`)
    assert.equal(
      (await blockState(bob)).blocked,
      false,
      'a missed sweep must never be able to trap someone'
    )
  })

  it('a self-exclusion past its minimum term stays blocked', async () => {
    // The minimum term is when it *may* be lifted, not when it lifts itself.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      UPDATE crm_player_rg_flags SET min_term_ends_at = now() - interval '1 day'
      WHERE tenant = ${TENANT} AND player_id = ${alice} AND flag_type = 'SELF_EXCLUSION'`)
    assert.equal((await blockState(alice)).blocked, true)
  })
})

describe('lifting is a different act by a different person', () => {
  it('refuses the principal who raised it', async () => {
    const { listPlayerRgFlags, liftRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const [flag] = await listPlayerRgFlags(TENANT, alice)
    const res = await liftRgFlag({
      tenant: TENANT,
      flagId: flag.id,
      liftedBy: 'crm:raiser-1',
      reason: 'Player called back',
    })
    assert.equal(res.ok, false)
    assert.equal(res.ok === false && res.reason, 'same_principal')
  })

  it('refuses without a reason', async () => {
    const { listPlayerRgFlags, liftRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const [flag] = await listPlayerRgFlags(TENANT, alice)
    const res = await liftRgFlag({ tenant: TENANT, flagId: flag.id, liftedBy: 'crm:other', reason: '  ' })
    assert.equal(res.ok, false)
    assert.equal(res.ok === false && res.reason, 'reason_required')
  })

  it('refuses before the minimum term', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { listPlayerRgFlags, liftRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    await db.execute(sql`
      UPDATE crm_player_rg_flags SET min_term_ends_at = now() + interval '30 days'
      WHERE tenant = ${TENANT} AND player_id = ${alice} AND flag_type = 'SELF_EXCLUSION'`)
    const [flag] = await listPlayerRgFlags(TENANT, alice)
    const res = await liftRgFlag({
      tenant: TENANT,
      flagId: flag.id,
      liftedBy: 'crm:other',
      reason: 'Player insists',
    })
    assert.equal(res.ok, false)
    assert.equal(res.ok === false && res.reason, 'before_min_term')
  })

  it('lifts, unblocks and releases the register once every condition is met', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { listPlayerRgFlags, liftRgFlag, isIdentifierExcluded } = await import(
      '@src/repos/crm/CrmRgRepo.js'
    )
    await db.execute(sql`
      UPDATE crm_player_rg_flags SET min_term_ends_at = now() - interval '1 day'
      WHERE tenant = ${TENANT} AND player_id = ${alice} AND flag_type = 'SELF_EXCLUSION'`)

    const [flag] = await listPlayerRgFlags(TENANT, alice)
    const res = await liftRgFlag({
      tenant: TENANT,
      flagId: flag.id,
      liftedBy: 'crm:other',
      reason: 'Minimum term served, player requested reinstatement',
    })
    assert.equal(res.ok, true)

    assert.equal((await blockState(alice)).blocked, false)
    assert.equal(
      await isIdentifierExcluded(TENANT, 'phone', alicePhone),
      false,
      'the register entry is released with the episode'
    )
  })

  it('keeps the marketing withdrawal after the block is lifted', async () => {
    // Being reinstated is not the same as asking to be marketed to again.
    const { getPlayerConsents } = await import('@src/repos/crm/CrmConsentRepo.js')
    const rows = await getPlayerConsents(TENANT, alice)
    assert.ok(rows.filter((r) => r.purpose === 'MARKETING').every((r) => r.state === 'WITHDRAWN'))
  })
})

describe('episodes are a history, not one slot', () => {
  it('a second exclusion after a lift produces a second episode', async () => {
    const { raiseRgFlag, listPlayerRgFlags } = await import('@src/repos/crm/CrmRgRepo.js')
    const res = await raiseRgFlag({
      tenant: TENANT,
      playerId: alice,
      flagType: 'SELF_EXCLUSION',
      initiatedBy: 'player',
      minTermEndsAt: new Date(Date.now() + 180 * 86_400_000),
      raisedBy: 'crm:raiser-1',
    })
    assert.equal(res.ok, true)

    const flags = await listPlayerRgFlags(TENANT, alice)
    const exclusions = flags.filter((f) => f.flagType === 'SELF_EXCLUSION')
    assert.equal(exclusions.length, 2, 'how many times has this player self-excluded')
    assert.equal(exclusions.filter((f) => f.status === 'ACTIVE').length, 1)
    assert.equal(exclusions.filter((f) => f.status === 'LIFTED').length, 1)
  })

  it('a concurrent double-raise yields one episode, not a silent overwrite', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { raiseRgFlag } = await import('@src/repos/crm/CrmRgRepo.js')
    const { pool } = await import('@src/db/client.js')

    // Warm the pool: cold connections stagger the transactions and the race
    // never happens, so the test would pass without proving anything.
    await Promise.all(Array.from({ length: 4 }, () => pool.query('SELECT pg_sleep(0.05)')))

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        raiseRgFlag({
          tenant: TENANT,
          playerId: bob,
          flagType: 'AFFORDABILITY_CONCERN',
          initiatedBy: 'operator',
          raisedBy: `crm:racer-${i}`,
        })
      )
    )
    assert.equal(results.filter((r) => r.ok).length, 1, 'exactly one should win')
    assert.ok(results.some((r) => !r.ok && r.reason === 'already_active'))

    const n = await db.execute(sql`
      SELECT count(*)::int AS n FROM crm_player_rg_flags
      WHERE tenant = ${TENANT} AND player_id = ${bob}
        AND flag_type = 'AFFORDABILITY_CONCERN' AND status = 'ACTIVE'`)
    assert.equal(Number((n.rows[0] as { n: number }).n), 1)
  })

  it('a non-blocking flag records a concern without stopping play', async () => {
    const { getRgBlockState } = await import('@shared/services/rgEnforcement.js')
    const s = await getRgBlockState(TENANT, bob)
    assert.equal(s.blocked, false, 'an affordability concern is an annotation, not a control')
  })
})

describe('consent', () => {
  it('derives the state from the event, and keeps every transition', async () => {
    const { recordConsent, getPlayerConsentHistory, getPlayerConsents } = await import(
      '@src/repos/crm/CrmConsentRepo.js'
    )
    for (const state of ['GRANTED', 'WITHDRAWN', 'GRANTED'] as const) {
      await recordConsent({
        tenant: TENANT,
        playerId: carol,
        channel: 'EMAIL',
        purpose: 'MARKETING',
        toState: state,
        source: 'PLAYER_PORTAL',
        actorKind: 'player',
      })
    }
    const history = await getPlayerConsentHistory(TENANT, carol)
    const emailEvents = history.filter((e) => e.channel === 'EMAIL' && e.purpose === 'MARKETING')
    assert.equal(emailEvents.length, 3, 'nothing is overwritten')
    // The first grant is remembered through a withdrawal and a re-grant.
    const rows = await getPlayerConsents(TENANT, carol)
    const email = rows.find((r) => r.channel === 'EMAIL' && r.purpose === 'MARKETING')
    assert.equal(email?.state, 'GRANTED')
    assert.ok(email?.grantedAt, 'when they first agreed survives the round trip')
  })

  it('never lets the state disagree with the newest event', async () => {
    const { findConsentDisagreements } = await import('@src/repos/crm/CrmConsentRepo.js')
    assert.deepEqual(await findConsentDisagreements(TENANT), [])
  })

  it('refuses a verbal grant with no evidence, at the database', async () => {
    const { recordConsent, getPlayerConsentHistory } = await import('@src/repos/crm/CrmConsentRepo.js')
    // A claim about something said off-system is unfalsifiable without a
    // pointer to the recording, so the constraint refuses it outright.
    await assert.rejects(() =>
      recordConsent({
        tenant: TENANT,
        playerId: carol,
        channel: 'CALL',
        purpose: 'MARKETING',
        toState: 'GRANTED',
        source: 'AGENT_VERBAL',
        actorKind: 'crm',
      })
    )
    const history = await getPlayerConsentHistory(TENANT, carol)
    assert.equal(
      history.some((e) => e.channel === 'CALL'),
      false,
      'and nothing was written'
    )
  })

  it('accepts the same grant once evidence is attached', async () => {
    const { recordConsent, canContact } = await import('@src/repos/crm/CrmConsentRepo.js')
    await recordConsent({
      tenant: TENANT,
      playerId: carol,
      channel: 'CALL',
      purpose: 'MARKETING',
      toState: 'GRANTED',
      source: 'AGENT_VERBAL',
      evidenceRef: 'call-recording-2026-08-27-114233',
      actorKind: 'crm',
    })
    assert.equal((await canContact(TENANT, carol, 'CALL', 'MARKETING')).allowed, true)
  })

  it('canContact refuses a blocked player who granted consent', async () => {
    const { recordConsent, canContact } = await import('@src/repos/crm/CrmConsentRepo.js')
    await recordConsent({
      tenant: TENANT,
      playerId: alice,
      channel: 'SMS',
      purpose: 'MARKETING',
      toState: 'GRANTED',
      source: 'SIGNUP_FORM',
      actorKind: 'player',
    })
    const res = await canContact(TENANT, alice, 'SMS', 'MARKETING')
    assert.equal(res.allowed, false)
    assert.equal(res.reason, 'rg_blocked', 'a block outranks consent')
  })

  it('canContact treats an absent row as never asked, not as permission', async () => {
    const { canContact } = await import('@src/repos/crm/CrmConsentRepo.js')
    const res = await canContact(TENANT, carol, 'WHATSAPP', 'SERVICE')
    assert.equal(res.allowed, false)
    assert.equal(res.reason, 'never_asked')
  })

  it('does not let a marketing withdrawal stop a service message', async () => {
    // One channel carries a login code, a service notice and an offer. Purpose
    // is in the key so withdrawing one does not silence the others.
    const { recordConsent, canContact } = await import('@src/repos/crm/CrmConsentRepo.js')
    await recordConsent({
      tenant: TENANT,
      playerId: carol,
      channel: 'SMS',
      purpose: 'SERVICE',
      toState: 'GRANTED',
      source: 'SIGNUP_FORM',
      actorKind: 'player',
    })
    await recordConsent({
      tenant: TENANT,
      playerId: carol,
      channel: 'SMS',
      purpose: 'MARKETING',
      toState: 'WITHDRAWN',
      source: 'PLAYER_PORTAL',
      actorKind: 'player',
    })
    assert.equal((await canContact(TENANT, carol, 'SMS', 'MARKETING')).allowed, false)
    assert.equal((await canContact(TENANT, carol, 'SMS', 'SERVICE')).allowed, true)
  })

  it('the suppression list covers both refusals and blocks', async () => {
    const { listSuppressed } = await import('@src/repos/crm/CrmConsentRepo.js')
    const suppressed = await listSuppressed(TENANT, 'EMAIL', 'MARKETING', [alice, bob, carol])
    assert.ok(suppressed.has(alice), 'blocked, whatever their consent says')
    assert.ok(suppressed.has(bob), 'marketing withdrawn when their flag went on')
    assert.equal(suppressed.has(carol), false, 'carol granted email marketing and is not blocked')
  })
})

describe('concurrent consent writes cannot leave the state disagreeing with the events', () => {
  // Finding #11: the pre-read, the event insert and the state upsert were three
  // unserialised steps. On a key with no row yet, two concurrent writers both
  // read "no row", both stamped `from_state = null`, and the loser of the
  // insert race overwrote the winner's state through the DO UPDATE — and,
  // because `created_at` defaulted to the *transaction* start time, could stamp
  // its event earlier than the one it overwrote. The result was a state row and
  // an event chain that disagreed, which is precisely the corruption
  // `findConsentDisagreements` exists to detect.
  let racer = 0

  it('a fresh player takes eight concurrent transitions on one key', async () => {
    const { db, pool } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { recordConsent } = await import('@src/repos/crm/CrmConsentRepo.js')

    const phone = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0')
    const r = await db.execute(sql`
      INSERT INTO users (tenant, name, username, phone, email, password_hash)
      VALUES (${TENANT}, 'Racer', ${'racer' + randomUUID().slice(0, 6)}, ${phone},
              ${'racer' + randomUUID().slice(0, 6) + '@example.test'}, 'x')
      RETURNING id`)
    racer = Number((r.rows[0] as { id: number }).id)

    // Warm the pool, or the writes stagger and never actually contend.
    await Promise.all(Array.from({ length: 8 }, () => pool.query('SELECT pg_sleep(0.05)')))

    const states = ['GRANTED', 'WITHDRAWN', 'GRANTED', 'WITHDRAWN', 'GRANTED', 'WITHDRAWN', 'GRANTED', 'WITHDRAWN'] as const
    const results = await Promise.allSettled(
      states.map((toState) =>
        recordConsent({
          tenant: TENANT,
          playerId: racer,
          channel: 'EMAIL',
          purpose: 'MARKETING',
          toState,
          source: 'PLAYER_PORTAL',
          actorKind: 'player',
        })
      )
    )
    assert.equal(
      results.filter((x) => x.status === 'rejected').length,
      0,
      'serialising must make every writer succeed in turn, not fail'
    )
  })

  it('every event records the state that actually preceded it', async () => {
    const { getPlayerConsentHistory } = await import('@src/repos/crm/CrmConsentRepo.js')
    const history = await getPlayerConsentHistory(TENANT, racer)
    const chain = history.filter((e) => e.channel === 'EMAIL' && e.purpose === 'MARKETING').reverse()
    assert.equal(chain.length, 8, 'every transition is kept')

    assert.equal(chain[0].fromState, null, 'only the first transition has no predecessor')
    for (let i = 1; i < chain.length; i++) {
      assert.equal(
        chain[i].fromState,
        chain[i - 1].toState,
        `event ${i} must name the state the one before it left behind`
      )
    }
  })

  it('the state row agrees with the newest event', async () => {
    const { getPlayerConsents, getPlayerConsentHistory, findConsentDisagreements } = await import(
      '@src/repos/crm/CrmConsentRepo.js'
    )
    const history = await getPlayerConsentHistory(TENANT, racer)
    const newest = history.find((e) => e.channel === 'EMAIL' && e.purpose === 'MARKETING')
    const rows = await getPlayerConsents(TENANT, racer)
    const state = rows.find((r) => r.channel === 'EMAIL' && r.purpose === 'MARKETING')

    assert.equal(state?.state, newest?.toState, 'the cache must match the record it derives from')
    assert.deepEqual(
      await findConsentDisagreements(TENANT),
      [],
      'and the check written to prove this impossible must find nothing'
    )
  })

  it('keeps the first grant date through every later transition', async () => {
    // `granted_at` is resolved against the live row now, not a value read
    // before the lock — a writer that lost the race used to write its own
    // stale `current?.grantedAt ?? null` over it, destroying the answer to
    // "since when have they been contactable".
    const { getPlayerConsents } = await import('@src/repos/crm/CrmConsentRepo.js')
    const rows = await getPlayerConsents(TENANT, racer)
    const state = rows.find((r) => r.channel === 'EMAIL' && r.purpose === 'MARKETING')
    if (state?.state === 'GRANTED') {
      assert.ok(state.grantedAt, 'a granted row must say when the grant began')
    }
  })
})
