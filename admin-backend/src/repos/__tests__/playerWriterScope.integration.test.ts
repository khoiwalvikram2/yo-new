/**
 * Player-control writers must not reach across a tenant boundary.
 *
 * Every writer in `usersRepo` updated the `users` table by numeric id alone. A
 * permission gate on the resolver stops a caller who holds nothing, but it says
 * nothing about WHICH player, so a whitelabel admin holding `players.profile:update`
 * for their own brand could suspend, unlock, force-logout, re-tier or change the
 * password of a player belonging to a different brand by naming their id. The
 * password writer was the sharpest: it set a login credential for any row.
 *
 * Ten writers had the shape. Each now takes a required tenant, which is how the
 * nineteen call sites were found — a required parameter fails the build, an
 * optional one would have let a new call site reintroduce the hole in silence.
 *
 * `updateUserPasswordDb` takes `string | null` rather than `string`, because a
 * self-change gets its id from the session and a platform Super Admin's own row
 * lives in the `default` tenant while `ctx.tenant` is whichever whitelabel they
 * are operating inside. The last test pins that so the nullable case cannot
 * quietly become the normal one.
 *
 * Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const TENANT_A = 'writer-scope-a'
const TENANT_B = 'writer-scope-b'

let db: (typeof import('@src/db/client.js'))['db']
let repo: typeof import('@src/repos/users/usersRepo.js')
let victim = 0

async function statusOf(id: number): Promise<string> {
  const r = await db.execute(sql`SELECT status FROM users WHERE id = ${id}`)
  return String((r.rows[0] as { status: string }).status)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  repo = await import('@src/repos/users/usersRepo.js')

  for (const t of [TENANT_A, TENANT_B]) {
    await db.execute(sql`
      INSERT INTO whitelabels (id, name, domain, status)
      VALUES (${t}, ${t}, ${t + '.test'}, 'active') ON CONFLICT (id) DO NOTHING`)
  }
  // The victim belongs to tenant B. Every call below names tenant A.
  const u = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash)
    VALUES (${TENANT_B}, 'Victim', ${'victim-' + Date.now()}, 'active', 'original-hash')
    RETURNING id`)
  victim = Number((u.rows[0] as { id: number }).id)
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM player_limits WHERE tenant IN (${TENANT_A}, ${TENANT_B})`)
    await db.execute(sql`DELETE FROM users WHERE tenant IN (${TENANT_A}, ${TENANT_B})`)
    await db.execute(sql`DELETE FROM whitelabels WHERE id IN (${TENANT_A}, ${TENANT_B})`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

describe('a writer named with the wrong tenant changes nothing', () => {
  it('cannot suspend another brand’s player', async () => {
    await repo.setUserStatusDb(victim, 'SUSPENDED', TENANT_A)
    assert.equal(await statusOf(victim), 'active', 'tenant A suspended a tenant B player')
  })

  it('cannot lock another brand’s withdrawals', async () => {
    await repo.setWithdrawalLockDb(victim, true, TENANT_A)
    const r = await db.execute(sql`SELECT withdrawal_lock FROM users WHERE id = ${victim}`)
    assert.notEqual(
      (r.rows[0] as { withdrawal_lock: boolean }).withdrawal_lock,
      true,
      'tenant A locked a tenant B player’s withdrawals'
    )
  })

  it('cannot force another brand’s player to reset their password', async () => {
    await repo.setRequirePasswordResetDb(victim, true, TENANT_A)
    const r = await db.execute(sql`SELECT require_password_reset FROM users WHERE id = ${victim}`)
    assert.notEqual(
      (r.rows[0] as { require_password_reset: boolean }).require_password_reset,
      true,
      'tenant A set a reset flag on a tenant B player'
    )
  })

  it('cannot force-logout another brand’s player', async () => {
    const before = await db.execute(sql`SELECT token_version FROM users WHERE id = ${victim}`)
    await repo.incrementTokenVersionDb(victim, TENANT_A)
    const after = await db.execute(sql`SELECT token_version FROM users WHERE id = ${victim}`)
    assert.equal(
      Number((after.rows[0] as { token_version: number }).token_version),
      Number((before.rows[0] as { token_version: number }).token_version),
      'tenant A invalidated a tenant B player’s sessions'
    )
  })

  it('cannot change another brand’s player’s password', async () => {
    const ok = await repo.updateUserPasswordDb(victim, 'attacker-hash', TENANT_A)
    assert.equal(ok, false, 'the write reported success across a tenant boundary')
    const r = await db.execute(sql`SELECT password_hash FROM users WHERE id = ${victim}`)
    assert.equal(
      (r.rows[0] as { password_hash: string }).password_hash,
      'original-hash',
      'tenant A rewrote a tenant B player’s password'
    )
  })

  it('cannot re-tier or re-permission another brand’s player', async () => {
    await repo.setUserBonusAllowedDb(victim, false, TENANT_A)
    await repo.updateUserDomainBetsDb(victim, { sportsBetAllowed: false }, TENANT_A)
    const r = await db.execute(
      sql`SELECT bonus_allowed, sports_bet_allowed FROM users WHERE id = ${victim}`
    )
    const row = r.rows[0] as { bonus_allowed: boolean; sports_bet_allowed: boolean }
    assert.notEqual(row.bonus_allowed, false, 'tenant A revoked a tenant B player’s bonuses')
    assert.notEqual(row.sports_bet_allowed, false, 'tenant A revoked a tenant B player’s betting')
  })
})

describe('the same writers still work for the owning tenant', () => {
  it('suspends and restores its own player', async () => {
    await repo.setUserStatusDb(victim, 'SUSPENDED', TENANT_B)
    assert.equal(await statusOf(victim), 'suspended', 'the owning tenant lost its own screen')
    await repo.setUserStatusDb(victim, 'ACTIVE', TENANT_B)
    assert.equal(await statusOf(victim), 'active')
  })

  it('changes its own player’s password', async () => {
    const ok = await repo.updateUserPasswordDb(victim, 'new-hash', TENANT_B)
    assert.equal(ok, true, 'the owning tenant could not set a password')
    const r = await db.execute(sql`SELECT password_hash FROM users WHERE id = ${victim}`)
    assert.equal((r.rows[0] as { password_hash: string }).password_hash, 'new-hash')
  })

  it('allows a self-change with an explicit null tenant', async () => {
    // A Super Admin's row lives in `default` while ctx.tenant is a whitelabel, so
    // a self-change cannot be scoped by the context tenant. The null is the
    // documented escape and must keep working.
    const ok = await repo.updateUserPasswordDb(victim, 'self-hash', null)
    assert.equal(ok, true, 'the self-change path stopped working')
  })
})
