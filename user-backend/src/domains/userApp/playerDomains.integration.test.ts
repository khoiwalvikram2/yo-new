import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, types, domains, t, eq } from '../../../../tmp/domain-visibility-integration-fixtures.js'
import { loadPlayerDomains, assertPlayerDomainBetting } from '@shared/access/playerDomains.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../db/client.js')
const { getAppSettings, getWhitelabelFeatureFlags } = await import('../../repos/userAppRepo.js')
const { userAppQueryResolvers } = await import('./resolvers/queries.js')
const { placeSportsBetForUser } = await import('./services/sportsBetService.js')
const { playerMatkaResolvers } = await import('../matka/resolvers.js')
const gap = await import('../casino/gapCasinoService.js')
const gmag = await import('../casino/gmagCasinoService.js')
test.before(() => guard(pool))
test.after(() => pool.end())
test.afterEach(() => mock.restoreAll())

for (const type of types) test(`${type}: actual SQL enforces each visibility/betting combination and settings version`, async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), owner = type.includes('AGENT') ? await f.agent(type === 'AGENT_CREDIT' ? 'CREDIT' : type.startsWith('SHARING') ? 'SHARING' : 'COMMISSION') : undefined
    const player = await f.player(type, owner)
    routeDbToTransaction(mock, db, tx)
    const ctx: any = { auth: { userId: player.id, tenant: f.tenant, requestTenant: f.tenant } }
    for (const domain of domains) {
      const before = await userAppQueryResolvers.appSettingsVersion(null, {}, ctx)
      for (const visible of [false, true]) for (const allowed of [false, true]) {
        await f.flags(player.id, { [`${domain}Visible`]: visible, [`${domain}BetAllowed`]: allowed })
        const access = (await loadPlayerDomains(tx, f.tenant, player.id))[domain]
        assert.equal(access.visible, visible); assert.equal(access.canBet, visible && allowed)
        const settings = Object.fromEntries((await getAppSettings(f.tenant, player.id)).map(row => [row.key, row.value]))
        assert.equal(settings[`${domain}Enabled`], String(visible))
        if (!visible) assert.notEqual(await userAppQueryResolvers.appSettingsVersion(null, {}, ctx), before)
        if (visible && allowed) await assertPlayerDomainBetting(tx, f.tenant, player.id, domain)
        else await assert.rejects(assertPlayerDomainBetting(tx, f.tenant, player.id, domain))
        if (domain !== 'matka') assert.equal((await getWhitelabelFeatureFlags(f.tenant, player.id))[`${domain}Enabled`], visible)
        if (!visible) {
          if (domain === 'sports') {
            assert.deepEqual((await userAppQueryResolvers.sportsList(null, {}, ctx)).data, [])
            assert.equal((await userAppQueryResolvers.sportsEventDetail(null, { eventId: 'private' }, ctx)).data, null)
          } else if (domain === 'casino') assert.deepEqual((await userAppQueryResolvers.casinoGames(null, {}, ctx)).data, [])
          else {
            assert.deepEqual((await playerMatkaResolvers.Query.matkaMarkets(null, {}, ctx)).data, [])
            assert.equal((await playerMatkaResolvers.Query.matkaMarket(null, { id: 'private' }, ctx)).meta.code, 403)
          }
        }
        if (domain === 'sports' && !(visible && allowed)) await assert.rejects(placeSportsBetForUser(ctx, {}), /disabled/)
      }
    }
    assert.equal((await loadPlayerDomains(tx, f.tenant + '-foreign', player.id)).sports.visible, false)
    mock.restoreAll()
  })
})

for (const scheme of ['CREDIT', 'SHARING', 'COMMISSION']) test(`${scheme}: ancestor domains, suspension and confirmed referral owner are applied`, async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), root = await f.agent(scheme), child = await f.agent(scheme, root), owner = await f.player('REGULAR', child), referred = await f.player()
    await tx.insert(t.referralAttributions).values({ tenant: f.tenant, referrerId: owner.id, refereeId: referred.id, status: 'confirmed' })
    for (const domain of domains) {
      await tx.update(t.agents).set({ allowedDomains: domains.filter(d => d !== domain) }).where(eq(t.agents.id, root.id))
      assert.equal((await loadPlayerDomains(tx, f.tenant, referred.id))[domain].visible, false)
      await tx.update(t.agents).set({ allowedDomains: [...domains], status: 'SUSPENDED' }).where(eq(t.agents.id, root.id))
      const access = (await loadPlayerDomains(tx, f.tenant, referred.id))[domain]
      assert.equal(access.visible, true); assert.equal(access.canBet, false)
      await tx.update(t.agents).set({ status: 'ACTIVE' }).where(eq(t.agents.id, root.id))
    }
    await tx.update(t.agents).set({ tenantId: 'default' }).where(eq(t.agents.id, root.id))
    assert.equal((await loadPlayerDomains(tx, f.tenant, referred.id)).casino.agentAllowed, false)
  })
})

for (const type of ['REGULAR', 'WHITELABEL_CREDIT', 'AGENT_CREDIT', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER']) {
  for (const provider of ['gapcasino', 'gmagcasino']) test(`${provider}/${type}: hiding blocks new debits, accepted replay and payouts/refunds still work`, async () => {
    await rollback(db, async tx => {
      const f = await fixture(tx), owner = type.includes('AGENT') ? await f.agent(type === 'AGENT_CREDIT' ? 'CREDIT' : type.startsWith('SHARING') ? 'SHARING' : 'COMMISSION') : undefined, player = await f.player(type, owner)
      const [apiProvider] = await tx.insert(t.casinoApiProviders).values({ key: provider, name: 'Isolated provider' }).onConflictDoUpdate({ target: t.casinoApiProviders.key, set: { name: 'Isolated provider' } }).returning()
      const code = randomUUID(), [vendor] = await tx.insert(t.casinoVendors).values({ name: 'QA', slug: code }).returning()
      await tx.insert(t.casinoGames).values({ apiProviderId: apiProvider.id, vendorId: vendor.id, mainCategory: 'casino', externalId: code, slug: code, name: 'Visibility QA' })
      const token = randomUUID()
      await tx.insert(t.userCasinoSessions).values({ tenant: f.tenant, userId: player.id, token, providerKey: provider, walletType: 'cash', expiresAt: new Date(Date.now() + 3600000) })
      routeDbToTransaction(mock, db, tx)
      const send = async (kind: string, id: string, round: string, amount = 100) => {
        if (provider === 'gapcasino') {
          const common = { userId: player.id, token, gameId: code, transactionId: id, roundId: round }
          return kind === 'bet' ? gap.handleDebit({ ...common, debitAmount: amount }) : kind === 'win' ? gap.handleCredit({ ...common, creditAmount: amount, reqId: 'win-' + id }) : gap.handleRollback({ ...common, reqId: 'refund-' + id })
        }
        return gmag.handleGmagTransaction({ brandId: 'isolated', requestId: randomUUID(), playerId: `${player.id}_0000`, playerSessionId: token, gameCode: code, trans: [{ seq: 1, transId: kind === 'bet' ? id : kind + '-' + id, referenceId: id, roundId: round, transType: kind as 'bet'|'win'|'cancel', amount, transTime: new Date().toISOString(), endRound: kind === 'win' ? 1 : 0 }] })
      }
      const okay = (response: any) => assert.equal(provider === 'gapcasino' ? response.status : response.error, provider === 'gapcasino' ? 'OP_SUCCESS' : '0', JSON.stringify(response))
      okay(await send('bet', 'stake-a', 'round-a')); okay(await send('bet', 'stake-b', 'round-b'))
      for (const flags of [{ casinoVisible: false, casinoBetAllowed: true }, { casinoVisible: true, casinoBetAllowed: false }]) {
        await f.flags(player.id, flags)
        const denied: any = await send('bet', 'separate-gate-' + String(flags.casinoVisible), 'no-stake-round')
        assert.equal(provider === 'gapcasino' ? denied.status : denied.error, provider === 'gapcasino' ? 'OP_USER_DISABLED' : 'P_07', JSON.stringify(denied))
        if (provider === 'gmagcasino') assert.equal((await send('bet', 'zero-gate-' + String(flags.casinoVisible), 'zero-stake-round', 0) as any).error, 'P_07')
      }
      await f.flags(player.id, { casinoVisible: false, casinoBetAllowed: false })
      const replay: any = await send('bet', 'stake-a', 'round-a')
      if (provider === 'gapcasino') assert.equal(replay.status, 'OP_DUPLICATE_TRANSACTION'); else okay(replay)
      const blocked: any = await send('bet', 'stake-new', 'new-round')
      assert.equal(provider === 'gapcasino' ? blocked.status : blocked.error, provider === 'gapcasino' ? 'OP_USER_DISABLED' : 'P_07', JSON.stringify(blocked))
      okay(await send('win', 'stake-a', 'round-a', 200)); okay(await send(provider === 'gapcasino' ? 'refund' : 'cancel', 'stake-b', 'round-b'))
      const bets = await tx.select().from(t.casinoBets).where(eq(t.casinoBets.tenant, f.tenant))
      assert.equal(bets.length, 2); assert.equal(bets.filter((bet: any) => bet.status === 'won').length, 1); assert.equal(bets.filter((bet: any) => bet.status === 'void').length, 1)
      mock.restoreAll()
    })
  })
}
