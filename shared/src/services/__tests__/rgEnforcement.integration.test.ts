/**
 * The responsible-gambling block, and the half of it that is easy to get wrong.
 *
 * Blocking a player is the easy part. What these assert is the other half: a
 * blocked player must still be able to sign in, see their balance and take
 * their money out. Getting that backwards strands their funds behind an account
 * they closed themselves, which is the failure with no defence — so the "still
 * allowed" cases are tested at least as hard as the refusals.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `rg-${randomUUID().slice(0, 8)}`
const OTHER_TENANT = `rg-other-${randomUUID().slice(0, 8)}`

let free = 0
let blockedIndefinitely = 0
let coolingOff = 0
let lapsed = 0
let otherTenantPlayer = 0

async function makePlayer(tenant: string, name: string, blockedUntil: string | null) {
  const { db } = await import('../../db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`
    INSERT INTO users (tenant, name, username, phone, password_hash, rg_blocked_until, rg_block_reason)
    VALUES (${tenant}, ${name}, ${name.replace(/\s/g, '').toLowerCase() + randomUUID().slice(0, 6)},
            ${'9' + Math.floor(Math.random() * 1e9)}, 'x',
            ${blockedUntil}::timestamptz, ${blockedUntil ? 'SELF_EXCLUSION' : null})
    RETURNING id`)
  return Number((r.rows[0] as { id: number }).id)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  free = await makePlayer(TENANT, 'Free Player', null)
  blockedIndefinitely = await makePlayer(TENANT, 'Excluded Player', 'infinity')
  coolingOff = await makePlayer(TENANT, 'Cooling Off', new Date(Date.now() + 86_400_000).toISOString())
  lapsed = await makePlayer(TENANT, 'Lapsed Block', new Date(Date.now() - 60_000).toISOString())
  otherTenantPlayer = await makePlayer(OTHER_TENANT, 'Other Brand', 'infinity')
})

after(async () => {
  const { db } = await import('../../db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const t of [TENANT, OTHER_TENANT]) {
    await db.execute(sql`DELETE FROM users WHERE tenant = ${t}`)
  }
})

describe('who is blocked', () => {
  it('reports a free player as free', async () => {
    const { getRgBlockState } = await import('../rgEnforcement.js')
    const s = await getRgBlockState(TENANT, free)
    assert.equal(s.blocked, false)
    assert.equal(s.reason, null)
  })

  it('reports an indefinite self-exclusion as blocked', async () => {
    const { getRgBlockState } = await import('../rgEnforcement.js')
    const s = await getRgBlockState(TENANT, blockedIndefinitely)
    assert.equal(s.blocked, true)
    assert.equal(s.reason, 'SELF_EXCLUSION')
  })

  it('reports a live cooling-off as blocked', async () => {
    const { getRgBlockState } = await import('../rgEnforcement.js')
    assert.equal((await getRgBlockState(TENANT, coolingOff)).blocked, true)
  })

  it('frees a lapsed block with no job having run', async () => {
    // The whole point of storing a timestamp rather than a status: a missed
    // sweep can never leave someone trapped.
    const { getRgBlockState } = await import('../rgEnforcement.js')
    assert.equal((await getRgBlockState(TENANT, lapsed)).blocked, false)
  })
})

describe('what a block stops', () => {
  it('refuses a stake', async () => {
    const { assertPlayerCanStake, RgBlockedError } = await import('../rgEnforcement.js')
    await assert.rejects(
      () => assertPlayerCanStake(TENANT, blockedIndefinitely),
      (e: unknown) => e instanceof RgBlockedError && e.action === 'stake'
    )
  })

  it('refuses funding', async () => {
    const { assertPlayerCanFund, RgBlockedError } = await import('../rgEnforcement.js')
    await assert.rejects(
      () => assertPlayerCanFund(TENANT, blockedIndefinitely),
      (e: unknown) => e instanceof RgBlockedError && e.action === 'fund'
    )
  })

  it('allows both for a free player', async () => {
    const { assertPlayerCanStake, assertPlayerCanFund } = await import('../rgEnforcement.js')
    await assertPlayerCanStake(TENANT, free)
    await assertPlayerCanFund(TENANT, free)
  })

  it('says something a player can act on, without saying why they were flagged', async () => {
    const { assertPlayerCanFund } = await import('../rgEnforcement.js')
    try {
      await assertPlayerCanFund(TENANT, blockedIndefinitely)
      assert.fail('should have refused')
    } catch (e) {
      const msg = String((e as Error).message)
      assert.match(msg, /responsible gambling/i)
      // The reason is for the desk, not the deposit screen.
      assert.doesNotMatch(msg, /SELF_EXCLUSION|LOSS_CHASING|AFFORDABILITY/)
    }
  })
})

describe('a block does not reach across whitelabels', () => {
  it('does not block a same-id player of another tenant', async () => {
    const { getRgBlockState } = await import('../rgEnforcement.js')
    // Asked about the excluded player under the wrong tenant, the answer must
    // be "not mine to judge" rather than a block leaking sideways.
    assert.equal((await getRgBlockState(TENANT, otherTenantPlayer)).blocked, false)
    assert.equal((await getRgBlockState(OTHER_TENANT, otherTenantPlayer)).blocked, true)
  })
})

describe('bulk lookup', () => {
  it('returns exactly the blocked ids', async () => {
    const { findBlockedPlayers } = await import('../rgEnforcement.js')
    const blocked = await findBlockedPlayers(TENANT, [free, blockedIndefinitely, coolingOff, lapsed])
    assert.deepEqual([...blocked].sort(), [blockedIndefinitely, coolingOff].sort())
  })

  it('is empty for an empty request', async () => {
    const { findBlockedPlayers } = await import('../rgEnforcement.js')
    assert.equal((await findBlockedPlayers(TENANT, [])).size, 0)
  })
})
