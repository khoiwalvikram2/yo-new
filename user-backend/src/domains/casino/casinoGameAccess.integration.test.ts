import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../db/client.js')
const gap = await import('./gapCasinoService.js'), gmag = await import('./gmagCasinoService.js')
const { checkCasinoGameAccess, CASINO_GAME_ACCESS_MESSAGES } = await import('./casinoGameAccess.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

// The four per-game rules of Casino Management > Edit game settings, on both providers' stake
// callbacks. Before the fix only min and max stake were read: "Betting enabled" off, a daily
// Max Win, "Premium Game" and "VIP Tier Access" were saved and never applied to a player.

async function setup(tx: any, provider: 'gapcasino' | 'gmagcasino') {
  const f = await fixture(tx)
  const player = await f.player('REGULAR')
  const [apiProvider] = await tx.insert(t.casinoApiProviders).values({ key: provider, name: 'Isolated access QA' }).onConflictDoUpdate({ target: t.casinoApiProviders.key, set: { name: 'Isolated access QA' } }).returning()
  const code = randomUUID(), [vendor] = await tx.insert(t.casinoVendors).values({ name: 'Access QA Vendor', slug: code }).returning()
  const [game] = await tx.insert(t.casinoGames).values({ apiProviderId: apiProvider.id, vendorId: vendor.id, mainCategory: 'casino', externalId: code, slug: code, name: 'Access QA Game' }).returning()
  const token = randomUUID()
  await tx.insert(t.userCasinoSessions).values({ tenant: f.tenant, userId: player.id, token, providerKey: provider, walletType: 'cash', expiresAt: new Date(Date.now() + 3600000) })
  routeDbToTransaction(mock, db, tx)
  const send = async (kind: 'bet' | 'win', id: string, amount: number): Promise<any> => {
    if (provider === 'gapcasino') {
      const body = { userId: player.id, token, gameId: code, transactionId: id, roundId: 'round-' + id }
      return kind === 'bet' ? gap.handleDebit({ ...body, debitAmount: amount }) : gap.handleCredit({ ...body, creditAmount: amount, reqId: 'win-' + id })
    }
    return gmag.handleGmagTransaction({ brandId: 'isolated', requestId: randomUUID(), playerId: `${player.id}_0000`, playerSessionId: token, gameCode: code, trans: [{ seq: 1, transId: kind === 'bet' ? id : 'win-' + id, referenceId: id, roundId: 'round-' + id, transType: kind, amount, transTime: new Date().toISOString(), endRound: kind === 'win' ? 1 : 0 }] })
  }
  const code_ = (response: any) => provider === 'gapcasino' ? response.status : response.error
  const ok = provider === 'gapcasino' ? 'OP_SUCCESS' : '0'
  const refusedCode = provider === 'gapcasino' ? 'OP_USER_DISABLED' : 'P_07'
  const limitCode = provider === 'gapcasino' ? 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT' : 'T_04'
  const cash = async () => Number((await tx.select().from(t.wallets).where(eq(t.wallets.userId, player.id)))[0].cash)
  const bets = async () => tx.select().from(t.casinoBets).where(eq(t.casinoBets.tenant, f.tenant))
  const rule = (values: Record<string, unknown>) => tx.insert(t.casinoGameBetSettings).values({ tenantId: f.tenant, gameId: game.id, ...values })
  return { f, player, game, send, code: code_, ok, refusedCode, limitCode, cash, bets, rule }
}

for (const provider of ['gapcasino', 'gmagcasino'] as const) {
  test(`${provider}: "Betting enabled" off refuses the stake with no debit; a player's own row overrides the all-players row`, async () => {
    await rollback(db, async tx => {
      const s = await setup(tx, provider)
      await s.rule({ playerId: null, betEnabled: false })
      const refused = await s.send('bet', 'off-1', 100)
      assert.equal(s.code(refused), s.refusedCode, JSON.stringify(refused))
      if (provider === 'gmagcasino') assert.equal(refused.message, CASINO_GAME_ACCESS_MESSAGES.bet_disabled)
      assert.equal(await s.cash(), 10000, 'nothing was debited')
      assert.equal((await s.bets()).length, 0, 'no bet row')
      // The player's own row is the rule for that player (today's precedence), and it allows betting.
      await s.rule({ playerId: String(s.player.id), betEnabled: true })
      assert.equal(s.code(await s.send('bet', 'on-1', 100)), s.ok)
      assert.equal(await s.cash(), 9900)
      mock.restoreAll()
    })
  })

  test(`${provider}: Max Win (daily) refuses further stakes once the day's net win reaches the cap`, async () => {
    await rollback(db, async tx => {
      const s = await setup(tx, provider)
      await s.rule({ playerId: null, betEnabled: true, maxWin: '100' })
      assert.equal(s.code(await s.send('bet', 'cap-1', 50)), s.ok)
      assert.equal(s.code(await s.send('win', 'cap-1', 120)), s.ok, 'a win is paid in full: the cap never cuts a payout')
      // Net +70 so far: still under the cap.
      assert.equal(s.code(await s.send('bet', 'cap-2', 50)), s.ok)
      assert.equal(s.code(await s.send('win', 'cap-2', 90)), s.ok)
      // Net +110: the cap is reached.
      const before = await s.cash()
      const refused = await s.send('bet', 'cap-3', 10)
      assert.equal(s.code(refused), s.limitCode, JSON.stringify(refused))
      assert.equal(await s.cash(), before, 'nothing was debited')
      mock.restoreAll()
    })
  })

  test(`${provider}: a premium game takes stakes from active VIP members only`, async () => {
    await rollback(db, async tx => {
      const s = await setup(tx, provider)
      const [tier] = await tx.insert(t.vipTiersTable).values({ tenant: s.f.tenant, name: 'QA Bronze', level: 1, minMonthlyDeposit: 0, color: '#aa7744' }).returning()
      await tx.insert(t.whitelabelCasinoGameSettings).values({ tenantId: s.f.tenant, gameId: s.game.id, enabled: true, premiumOnly: true })
      const refused = await s.send('bet', 'premium-1', 100)
      assert.equal(s.code(refused), s.refusedCode, JSON.stringify(refused))
      assert.equal(await s.cash(), 10000)
      await tx.insert(t.vipMembersTable).values({ tenant: s.f.tenant, userId: String(s.player.id), userName: 'QA', tierId: tier.id, status: 'active' })
      assert.equal(s.code(await s.send('bet', 'premium-2', 100)), s.ok)
      assert.equal(await s.cash(), 9900)
      mock.restoreAll()
    })
  })

  test(`${provider}: a tier-restricted game admits the selected tiers of this whitelabel only`, async () => {
    await rollback(db, async tx => {
      const s = await setup(tx, provider)
      // Bronze is every player's automatic tier here; Gold needs a manual assignment.
      await tx.insert(t.vipTiersTable).values({ tenant: s.f.tenant, name: 'QA Bronze', level: 1, minMonthlyDeposit: 0, color: '#aa7744' })
      const [gold] = await tx.insert(t.vipTiersTable).values({ tenant: s.f.tenant, name: 'QA Gold', level: 2, minMonthlyDeposit: 1000000, color: '#ddaa00' }).returning()
      // Another whitelabel restricting the same game changes nothing here.
      const other = 'domain-qa-other-' + randomUUID().slice(0, 8)
      await tx.insert(t.whitelabels).values({ id: other, name: 'Other QA', domain: other + '.invalid' })
      const [foreign] = await tx.insert(t.vipTiersTable).values({ tenant: other, name: 'Other Gold', level: 2, minMonthlyDeposit: 0, color: '#000000' }).returning()
      await tx.insert(t.vipTierCasinoGames).values({ tierId: foreign.id, gameId: s.game.id, enabled: true })
      assert.equal(s.code(await s.send('bet', 'tier-0', 10)), s.ok, "another whitelabel's tier does not restrict this one")
      // Restricted to Gold: the player's automatic tier is Bronze.
      await tx.insert(t.vipTierCasinoGames).values({ tierId: gold.id, gameId: s.game.id, enabled: true })
      const refused = await s.send('bet', 'tier-1', 10)
      assert.equal(s.code(refused), s.refusedCode, JSON.stringify(refused))
      await tx.update(t.users).set({ vipTierMode: 'MANUAL', vipTierId: gold.id }).where(eq(t.users.id, s.player.id))
      assert.equal(s.code(await s.send('bet', 'tier-2', 10)), s.ok, 'a Gold player may play')
      mock.restoreAll()
    })
  })
}

test('gmagcasino: a bet that was accepted is still acknowledged on retry after betting is switched off', async () => {
  await rollback(db, async tx => {
    const s = await setup(tx, 'gmagcasino')
    assert.equal(s.code(await s.send('bet', 'retry-1', 100)), '0')
    await s.rule({ playerId: null, betEnabled: false })
    const retry = await s.send('bet', 'retry-1', 100)
    assert.equal(s.code(retry), '0', 'the provider is told the stake it already has stands')
    assert.equal(await s.cash(), 9900, 'and it is not taken twice')
    mock.restoreAll()
  })
})

test('the launch check gives the player the reason before the game opens', async () => {
  await rollback(db, async tx => {
    const s = await setup(tx, 'gapcasino')
    assert.equal(await checkCasinoGameAccess(db, { tenant: s.f.tenant, userId: s.player.id, gameId: s.game.id }), null)
    await s.rule({ playerId: String(s.player.id), betEnabled: false })
    const refusal = await checkCasinoGameAccess(db, { tenant: s.f.tenant, userId: s.player.id, gameId: s.game.id })
    assert.equal(refusal?.message, CASINO_GAME_ACCESS_MESSAGES.bet_disabled)
    mock.restoreAll()
  })
})

// The launch refuses before the provider is contacted, with a typed refusal the launch resolver can
// answer as a 403 (the player sees the reason) rather than as a provider failure.
for (const provider of ['gapcasino', 'gmagcasino'] as const) {
  test(`${provider}: a refused launch throws the typed refusal with the player's reason`, async (t) => {
    await rollback(db, async tx => {
      const s = await setup(tx, provider)
      await s.rule({ playerId: String(s.player.id), betEnabled: false })
      const { CasinoGameAccessError } = await import('./casinoGameAccess.js')
      const params = { userId: s.player.id, tenant: s.f.tenant, gameId: s.game.externalId, username: 'QA' }
      const launch = provider === 'gapcasino'
        ? (await import('./gapCasinoLaunchService.js')).getGapCasinoRedirectUrl(params)
        : (await import('./gmagCasinoLaunchService.js')).getGmagCasinoRedirectUrl(params)
      const error = await launch.then(() => null, (e: unknown) => e)
      mock.restoreAll()
      if (error instanceof Error && /not configured/.test(error.message)) return t.skip(`${provider} launch env is not configured here`)
      assert.ok(error instanceof CasinoGameAccessError, String(error))
      assert.equal(error.reason, 'bet_disabled')
      assert.equal(error.message, CASINO_GAME_ACCESS_MESSAGES.bet_disabled)
    })
  })
}

// The launch resolvers answer that refusal as a 403 with the reason: the player UI (useLaunchGame) shows the server's
// reason only for 403, and used to get a 502 here, i.e. the generic "game unavailable". fetch is stubbed so a test
// can never reach a provider.
const launches = [['casinoUrl', 'gapcasino'], ['casinoUrl', 'gmagcasino'], ['gapCasinoUrl', 'gapcasino']] as const
for (const [resolver, provider] of launches) {
  test(`${resolver} (${provider}): a refused launch is answered 403 with the player's reason`, async (t) => {
    await rollback(db, async tx => {
      const s = await setup(tx, provider)
      await s.rule({ playerId: String(s.player.id), betEnabled: false })
      mock.method(globalThis, 'fetch', async () => { throw new Error('no provider call from a test') })
      const { userAppQueryResolvers } = await import('../userApp/resolvers/queries.js')
      const ctx = { auth: { userId: s.player.id, tenant: s.f.tenant, requestTenant: s.f.tenant } } as any
      const res = await (userAppQueryResolvers as any)[resolver](null, { gameId: s.game.externalId }, ctx)
      mock.restoreAll()
      if (/not configured/.test(res.meta.message)) return t.skip(`${provider} launch env is not configured here`)
      assert.deepEqual([res.meta.code, res.meta.message, res.data], [403, CASINO_GAME_ACCESS_MESSAGES.bet_disabled, null])
    })
  })
}
