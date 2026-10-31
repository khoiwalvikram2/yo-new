/**
 * Where the responsible-gambling rail is wired, and — more importantly — where
 * it must never be.
 *
 * The behavioural test beside this one proves the guard works. This one proves
 * it is installed in the right doors, by reading the source. That sounds
 * indirect, and it is the only way to assert a *negative*: no unit test can
 * show that `createWithdrawalRequest` will never grow a funding check, but this
 * fails the moment someone adds one.
 *
 * The failure it exists to prevent: a blocked player who cannot withdraw. Their
 * balance is stranded behind an account they closed themselves, and the only
 * route they have to ask for it is the one that was just shut. Every other bug
 * in this area is recoverable; that one is not.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, '..', '..', '..', '..')

function read(rel: string): string {
  const p = join(REPO, rel)
  assert.ok(existsSync(p), `expected ${rel} to exist — the rail's wiring test is out of date`)
  return readFileSync(p, 'utf8')
}

/** The body of one function, from its declaration to the next top-level one. */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration)
  assert.notEqual(start, -1, `could not find "${declaration}" — this test needs updating`)
  const rest = source.slice(start + declaration.length)
  const next = rest.search(/\nexport (async )?function /)
  return next === -1 ? rest : rest.slice(0, next)
}

const GUARD = /assertPlayerCanFund|assertPlayerCanStake|getRgBlockState/

describe('money in is guarded', () => {
  it('a deposit the player starts', () => {
    const src = read('user-backend/src/repos/userAppRepo.ts')
    const body = functionBody(src, 'export async function createDepositRequest(')
    assert.match(body, /assertPlayerCanFund/, 'a blocked player must not be able to deposit')
  })

  it('a sports bet', () => {
    const src = read('user-backend/src/domains/userApp/services/sportsBetService.ts')
    const body = functionBody(src, 'export async function placeSportsBetForUser(')
    assert.match(body, /assertPlayerCanStake/, 'a blocked player must not be able to stake')
  })

  it('a casino debit', () => {
    const src = read('user-backend/src/domains/casino/gapCasinoService.ts')
    const body = functionBody(src, 'export async function handleDebit(')
    assert.match(body, GUARD, 'a blocked player must not be able to stake through a provider')
  })

  it('a gateway credit at least records what it did', () => {
    // This one deliberately does not refuse: the money has already left the
    // player's card, and rejecting the callback strands it at the provider.
    const src = read('user-backend/src/repos/welivepayOrdersRepo.ts')
    const body = functionBody(src, 'export async function creditOrderOnSuccess(')
    assert.match(body, /getRgBlockState/, 'a credit into a blocked account must be surfaced')
  })
})

describe('money out is never guarded', () => {
  const mustNotGuard: Array<[string, string, string]> = [
    [
      'a withdrawal the player requests',
      'user-backend/src/repos/userAppRepo.ts',
      'export async function createWithdrawalRequest(',
    ],
  ]

  for (const [label, file, decl] of mustNotGuard) {
    it(label, () => {
      const body = functionBody(read(file), decl)
      assert.doesNotMatch(
        body,
        GUARD,
        `${label} must never consult the block — an excluded player still owns their balance ` +
          'and this is their only route to it'
      )
    })
  }

  it('a casino credit or rollback', () => {
    const src = read('user-backend/src/domains/casino/gapCasinoService.ts')
    for (const decl of ['export async function handleCredit(', 'export async function handleRollback(']) {
      if (!src.includes(decl)) continue
      assert.doesNotMatch(
        functionBody(src, decl),
        GUARD,
        `${decl} must not consult the block — refusing a pay-up takes the stake and keeps the win`
      )
    }
  })
})

describe('the rail itself', () => {
  it('offers no way to gate money out', () => {
    const src = read('shared/src/services/rgEnforcement.ts')
    // The exported surface is deliberately narrow: two asserts, a state read and
    // a bulk lookup. An `assertPlayerCanWithdraw` would be a loaded gun.
    assert.doesNotMatch(src, /assertPlayerCanWithdraw|assertPlayerCanCashOut/)
    assert.match(src, /export type RgGuardedAction = 'stake' \| 'fund'/)
  })

  it('is not wired into any authentication path', () => {
    for (const rel of [
      'user-backend/src/domains/user/services/authService.ts',
      'admin-backend/src/domains/common/auth.ts',
    ]) {
      const p = join(REPO, rel)
      if (!existsSync(p)) continue
      assert.doesNotMatch(
        readFileSync(p, 'utf8'),
        GUARD,
        `${rel} must not consult the block — blocking sign-in blocks withdrawal`
      )
    }
  })
})
