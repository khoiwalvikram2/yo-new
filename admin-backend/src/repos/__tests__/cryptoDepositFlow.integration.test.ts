import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { appConfigs, depositRequests, ledgerEntries, users, vipTiersTable, walletLedger, wallets, whitelabelPaymentMethods, whitelabels } from '@shared/db/schema.js'
import { seedDefaultVipTiers } from '@shared/vip/defaultTiers.js'
import { createDepositRequest, getWhitelabelAccounts } from '../../../../user-backend/src/repos/userAppRepo.js'
import { approveDepositRequest, rejectDepositRequest } from '../deposits/depositRequestsRepo.js'

// Crypto (USDT) deposits end to end on an isolated UUID tenant: what a player is offered, the quote the
// server freezes on the request, the one-request-per-TxID rule, and approval with the bonus.
const tenant = `crypto-flow-${randomUUID().slice(0, 12)}`
const TRC20_WALLET = { id: 'wallet-trc', network: 'TRC20', walletAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', displayName: 'USDT (TRC20)', weight: 1, enabled: true }
const OFF_WALLET = { id: 'wallet-off', network: 'BEP20', walletAddress: '0x55d398326f99059fF775485246999027B3197955', weight: 0, enabled: false }
const previousAllowed = process.env.CRYPTO_DEPOSIT_ALLOWED_USER_IDS
let tiers: Array<typeof vipTiersTable.$inferSelect> = []

before(async () => {
  delete process.env.CRYPTO_DEPOSIT_ALLOWED_USER_IDS // isolated test process only
  await db.insert(whitelabels).values({ id: tenant, name: 'Crypto Flow Test', domain: `${tenant}.invalid`,
    vipStartedAt: new Date(Date.now() - 60_000), creditLimit: '1000000', creditAvailable: '1000000', creditUsed: '0' })
  await db.insert(appConfigs).values({ whitelabelId: tenant, timeZone: 'Asia/Kolkata' })
  await seedDefaultVipTiers(db, tenant)
  tiers = await db.select().from(vipTiersTable).where(eq(vipTiersTable.tenant, tenant)).orderBy(vipTiersTable.level)
  await db.insert(whitelabelPaymentMethods).values({ tenant, limits: { min: 10, max: 500000 }, bankDetails: [], upiDetails: [],
    cryptoDetails: [TRC20_WALLET, OFF_WALLET] })
})

after(async () => {
  if (previousAllowed === undefined) delete process.env.CRYPTO_DEPOSIT_ALLOWED_USER_IDS
  else process.env.CRYPTO_DEPOSIT_ALLOWED_USER_IDS = previousAllowed
  await new Promise(resolve => setTimeout(resolve, 100))
  // Every financial row in this suite belongs to this UUID tenant only.
  await db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM vip_transactions WHERE member_id IN (SELECT id FROM vip_members WHERE tenant=${tenant})`)
    await tx.execute(sql`DELETE FROM vip_member_history WHERE member_id IN (SELECT id FROM vip_members WHERE tenant=${tenant})`)
    await tx.execute(sql`DELETE FROM vip_members WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM vip_audit WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM wallet_ledger WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM ledger_entries WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM deposit_requests WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM notifications WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM agent_credit_ledger WHERE tenant_id=${tenant}`)
    await tx.execute(sql`DELETE FROM wallets WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM users WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM whitelabel_payment_methods WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM vip_tiers WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM app_configs WHERE whitelabel_id=${tenant}`)
    await tx.execute(sql`DELETE FROM whitelabels WHERE id=${tenant}`)
  })
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

async function player() {
  const [user] = await db.insert(users).values({ tenant, name: 'Crypto Fixture', username: `crypto-${randomUUID()}`,
    phone: '9999999912', passwordHash: 'test-not-login', playerType: 'REGULAR' }).returning()
  await db.insert(wallets).values({ tenant, userId: user.id, currency: 'INR', cash: '0' })
  return user
}
const hash = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '') // 64 hex characters
const cash = async (userId: number) => Number((await db.select().from(wallets).where(and(eq(wallets.tenant, tenant), eq(wallets.userId, userId))))[0].cash)
const setCrypto = (values: { cryptoRate?: string | null; cryptoBonusPercent?: string | null }) =>
  db.update(whitelabelPaymentMethods).set(values).where(eq(whitelabelPaymentMethods.tenant, tenant))
const cryptoRequest = (userId: number, amount: number, utr?: string, accountId = TRC20_WALLET.id) =>
  createDepositRequest({ tenant, userId, amount, accountId, method: 'CRYPTO', utr, referenceId: utr, proofKey: 'manual' })
const cryptoAccounts = async (userId: number, includeCrypto = true) =>
  (await getWhitelabelAccounts(tenant, userId, { includeCrypto })).filter(account => account.type === 'crypto')

test('a wallet reaches the player only once a rate is saved, only when asked for, and only while enabled', async () => {
  const user = await player()
  await setCrypto({ cryptoRate: null, cryptoBonusPercent: null })
  assert.deepEqual(await cryptoAccounts(user.id), [], 'no rate, no wallet')
  await assert.rejects(() => cryptoRequest(user.id, 900, hash()), /not available/)

  await setCrypto({ cryptoRate: '90', cryptoBonusPercent: '5' })
  const offered = await cryptoAccounts(user.id)
  assert.equal(offered.length, 1, 'the disabled BEP20 wallet stays hidden')
  assert.equal(offered[0].id, TRC20_WALLET.id)
  assert.equal(offered[0].walletAddress, TRC20_WALLET.walletAddress)
  assert.equal(offered[0].network, 'TRC20')
  assert.equal(offered[0].cryptoRate, 90)
  assert.equal(offered[0].cryptoBonusPercent, 5)
  assert.deepEqual(await cryptoAccounts(user.id, false), [], 'a client that did not ask never sees a wallet')
  await assert.rejects(() => cryptoRequest(user.id, 900, hash(), OFF_WALLET.id), /not available/)
})

test('a request freezes the server quote, needs a full TxID, and one TxID backs one live request', async () => {
  const user = await player()
  await setCrypto({ cryptoRate: '90', cryptoBonusPercent: '5' })
  await assert.rejects(() => cryptoRequest(user.id, 9000), /Transaction hash is required/)
  await assert.rejects(() => cryptoRequest(user.id, 9000, 'abc123'), /full transaction hash/)

  const txid = hash()
  const pending = await cryptoRequest(user.id, 9000, `  ${txid}  `)
  assert.equal(pending.method, 'CRYPTO')
  assert.equal(pending.utr, txid, 'stored without the pasted whitespace')
  assert.equal(Number(pending.cryptoAmount), 100)
  assert.equal(Number(pending.cryptoRate), 90)
  assert.equal(pending.cryptoNetwork, 'TRC20')
  assert.equal(Number(pending.cryptoBonusPercent), 5)
  assert.equal(Number(pending.cryptoBonusAmount), 450)
  assert.equal(pending.receivingAccountId, TRC20_WALLET.id)

  await assert.rejects(() => cryptoRequest(user.id, 500, txid.toUpperCase()), /already been submitted/)
  const other = await player()
  await assert.rejects(() => cryptoRequest(other.id, 500, txid), /already been submitted/, 'one hash, one live request, across players')

  await setCrypto({ cryptoRate: '100', cryptoBonusPercent: '10' })
  const [stored] = await db.select().from(depositRequests).where(eq(depositRequests.id, pending.id))
  assert.equal(Number(stored.cryptoAmount), 100, 'a later rate never changes the quote')
  assert.equal(Number(stored.cryptoBonusAmount), 450, 'nor the promised bonus')
})

test('two players racing with one TxID: exactly one request is created', async () => {
  await setCrypto({ cryptoRate: '90', cryptoBonusPercent: null })
  const [a, b] = [await player(), await player()]
  const txid = hash()
  const results = await Promise.allSettled([cryptoRequest(a.id, 900, txid), cryptoRequest(b.id, 900, txid)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  assert.match(String(failure.reason?.message), /already been submitted/)
})

test('approval credits the deposit and the bonus as two entries, charges whitelabel credit for both, and runs once', async () => {
  const user = await player()
  await setCrypto({ cryptoRate: '90', cryptoBonusPercent: '5' })
  const [before] = await db.select().from(whitelabels).where(eq(whitelabels.id, tenant))
  const pending = await cryptoRequest(user.id, 9000, hash())

  const approved = await approveDepositRequest(pending.id, tenant, 1)
  await assert.rejects(() => approveDepositRequest(pending.id, tenant, 1), /already processed/)

  assert.equal(await cash(user.id), 9450)
  assert.ok(approved.walletTxnId && approved.bonusWalletTxnId && approved.walletTxnId !== approved.bonusWalletTxnId)
  const [bonusEntry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, approved.bonusWalletTxnId!))
  // ledger_entries.amount is in the base currency; the wallet amount is kept in meta.
  assert.equal((bonusEntry.meta as any).originalAmount, 450)
  assert.equal((bonusEntry.meta as any).type, 'crypto_deposit_bonus')
  assert.equal(Number((bonusEntry.meta as any).depositRequestId), pending.id)
  const bonusLedger = await db.select().from(walletLedger).where(and(eq(walletLedger.tenant, tenant), eq(walletLedger.category, 'crypto_deposit_bonus')))
  assert.equal(bonusLedger.length, 1)
  assert.equal(Number(bonusLedger[0].amount), 450)
  const [after] = await db.select().from(whitelabels).where(eq(whitelabels.id, tenant))
  assert.equal(Number(after.creditUsed) - Number(before.creditUsed), 9450, 'the bonus is chips too')
})

test('a rejected request frees its TxID; a tier without CRYPTO hides wallets and refuses requests', async () => {
  const user = await player()
  await setCrypto({ cryptoRate: '90', cryptoBonusPercent: null })
  const txid = hash()
  const first = await cryptoRequest(user.id, 900, txid)
  await rejectDepositRequest(first.id, tenant, 1)
  const again = await cryptoRequest(user.id, 900, txid)
  assert.equal(again.utr, txid)
  assert.equal(again.cryptoBonusAmount, null, 'no bonus configured, none promised')

  const bronze = tiers[0]
  await db.update(vipTiersTable).set({ depositPolicy: { ...bronze.depositPolicy, methods: ['BANK_TRANSFER', 'UPI', 'GATEWAY'] } }).where(eq(vipTiersTable.id, bronze.id))
  try {
    const fresh = await player()
    assert.deepEqual(await cryptoAccounts(fresh.id), [])
    await assert.rejects(() => cryptoRequest(fresh.id, 900, hash()), /unavailable for your VIP tier/)
  } finally {
    await db.update(vipTiersTable).set({ depositPolicy: bronze.depositPolicy }).where(eq(vipTiersTable.id, bronze.id))
  }
})

test('the CRYPTO_DEPOSIT_ALLOWED_USER_IDS test gate hides wallets and refuses direct requests', async () => {
  const user = await player()
  await setCrypto({ cryptoRate: '90', cryptoBonusPercent: null })
  process.env.CRYPTO_DEPOSIT_ALLOWED_USER_IDS = String(user.id + 1_000_000)
  try {
    assert.deepEqual(await cryptoAccounts(user.id), [])
    await assert.rejects(() => cryptoRequest(user.id, 900, hash()), /not available/)
    process.env.CRYPTO_DEPOSIT_ALLOWED_USER_IDS = String(user.id)
    assert.equal((await cryptoAccounts(user.id)).length, 1)
  } finally {
    delete process.env.CRYPTO_DEPOSIT_ALLOWED_USER_IDS
  }
})
