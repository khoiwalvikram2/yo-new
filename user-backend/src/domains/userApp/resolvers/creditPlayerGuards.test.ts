/**
 * Credit-player guards on player resolvers (plan W5, D1 and D7).
 *
 *  - myReferralLink / claimReferralBonus / transferReferralBalanceToCash refuse credit
 *    players: they cannot withdraw, so referral cash minted for them could never leave.
 *  - recalculateExposure treats credit players like cash players (D/W chips): it rewrites
 *    wallets.exposure from the open sports bets and nothing from the old credit model.
 *
 * No database: db.execute answers the player-type lookup; every other db entry point
 * throws, so reaching the repo layer fails the test. The recalculateExposure test routes
 * the db handle to a drizzle pg-proxy that answers from a scripted router instead.
 */
import assert from 'node:assert/strict'
import test, { afterEach, mock } from 'node:test'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { db } from '../../../db/client.js'
import { userAppMutationResolvers } from './mutations.js'
import { userAppQueryResolvers } from './queries.js'
import { userMutationResolvers } from '../../user/resolvers/mutations.js'
import { CREDIT_PLAYER_REFERRAL_MESSAGE, isCreditPlayerUser } from '../services/playerCreditState.js'

const ctx = { auth: { userId: 4242, tenant: 'w5test', requestTenant: 'w5test' } } as any

function stubPlayer(playerType: string) {
  const statements: string[] = []
  mock.method(db as any, 'execute', async (q: any) => {
    statements.push(JSON.stringify(q?.queryChunks ?? q))
    return { rows: [{ player_type: playerType }] }
  })
  for (const name of ['select', 'insert', 'update', 'delete', 'transaction']) {
    mock.method(db as any, name, () => {
      throw new Error(`db.${name} must not be reached`)
    })
  }
  return statements
}

afterEach(() => mock.restoreAll())

for (const playerType of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) {
  test(`myReferralLink refuses ${playerType}`, async () => {
    stubPlayer(playerType)
    const res = await userAppQueryResolvers.myReferralLink(null, null, ctx)
    assert.equal(res.meta.code, 403)
    assert.equal(res.meta.message, CREDIT_PLAYER_REFERRAL_MESSAGE)
    assert.equal(res.data, null)
  })

  test(`claimReferralBonus refuses ${playerType}`, async () => {
    stubPlayer(playerType)
    const res = await userAppMutationResolvers.claimReferralBonus(null, { amount: 100 }, ctx)
    assert.equal(res.meta.code, 403)
    assert.equal(res.meta.message, CREDIT_PLAYER_REFERRAL_MESSAGE)
    assert.equal(res.data, null)
  })

  test(`transferReferralBalanceToCash refuses ${playerType}`, async () => {
    stubPlayer(playerType)
    const res = await userMutationResolvers.transferReferralBalanceToCash(null, { amount: 100 }, ctx)
    assert.equal(res.success, false)
    assert.equal(res.message, CREDIT_PLAYER_REFERRAL_MESSAGE)
  })

  test(`recalculateExposure rewrites only wallets.exposure for ${playerType}, like a cash player`, async () => {
    const log = routeDbToBook(playerType)
    const res = await userAppMutationResolvers.recalculateExposure(null, null, ctx)
    assert.equal(res.success, true, res.message)
    assert.equal(res.exposure, 300, 'the sports book exposure, not a stored credit_used')
    const writes = log.filter((s) => /^\s*(update|insert|delete)\b/i.test(s))
    assert.equal(writes.length, 1)
    assert.match(writes[0], /^update "wallets" set "exposure"/i)
    assert.deepEqual(
      log.filter((s) => /player_type|credit_used|credit_available|agent_player_credits|casino_bets|for update/i.test(s)),
      [],
      'no credit-model statement runs'
    )
  })
}

/**
 * Route the shared db handle to a pg-proxy holding one open fancy BACK bet of 300 for the
 * player (cash 1000, exposure 0). Returns the SQL of every statement sent.
 */
function routeDbToBook(playerType: string): string[] {
  const log: string[] = []
  const rowsFor = (flat: string): Record<string, unknown>[] => {
    if (flat.includes('from "users"')) return [{ agent_id: null, name: 'p', username: 'p', phone: '1', player_type: playerType }]
    if (flat.includes('from "sports_bets"')) {
      return [{ id: 'b1', market_id: 'm1', selection_id: 's1', side: 'back', price: '50', stake: '300', odds_size: '100' }]
    }
    if (flat.includes('from "sports_markets"')) return [{ id: 'm1', type: 'fancy', event_id: 'e1' }]
    if (flat.startsWith('select') && flat.includes('from "wallets"')) return [{ cash: '1000', bonus: '0', currency: 'INR', exposure: '0' }]
    return []
  }
  const fake = drizzle(async (sqlText: string, _params: unknown[], method: string) => {
    log.push(sqlText)
    const flat = sqlText.replace(/\s+/g, ' ').trim().toLowerCase()
    const rows = rowsFor(flat)
    if (method !== 'all') return { rows }
    const cols = (/^select (.+?) from /is.exec(flat)?.[1] ?? '').split(/,\s*/).map((c) => {
      const ids = c.match(/"([^"]+)"/g)
      return ids ? ids[ids.length - 1].replace(/"/g, '') : c.trim()
    })
    return { rows: rows.map((r) => cols.map((c) => r[c])) }
  })
  for (const name of ['select', 'insert', 'update', 'delete', 'execute', 'transaction']) {
    mock.method(db as any, name, (fake as any)[name].bind(fake))
  }
  return log
}

test('isCreditPlayerUser: cash and agent-cash players are not credit players', async () => {
  for (const playerType of ['REGULAR', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER']) {
    stubPlayer(playerType)
    assert.equal(await isCreditPlayerUser(4242, 'w5test'), false, playerType)
    mock.restoreAll()
  }
  const statements = stubPlayer('AGENT_CREDIT')
  assert.equal(await isCreditPlayerUser(4242, 'w5test'), true)
  assert.equal(statements.length, 1)
  assert.doesNotMatch(statements[0], /credit_used|credit_available|settlement_balance/, 'only the player type is read (D/W chips)')
})

test('isCreditPlayerUser: a missing user is not a credit player', async () => {
  mock.method(db as any, 'execute', async () => ({ rows: [] }))
  assert.equal(await isCreditPlayerUser(4242, 'w5test'), false)
})
