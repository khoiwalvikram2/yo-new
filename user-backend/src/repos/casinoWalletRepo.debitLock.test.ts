/**
 * debitWalletForCasino re-checks free chips under the wallet row lock.
 *
 * A cash stake may take only cash minus the sports liability held as exposure. GAP and GMAG
 * check that figure on a wallet read taken before the lock, so the debit repeats it on the
 * locked row: a stake that no longer fits (another stake or a sports bet got in first) is
 * refused and nothing is written. Credit players (D/W chips) stake from cash on this path too.
 * Bonus and referral-bonus stakes keep their own balance check; exposure does not limit them.
 *
 * No database: the executor is a drizzle pg-proxy that answers wallet reads with one scripted
 * row and records every statement.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { debitWalletForCasino } from './casinoWalletRepo.js'

function resultColumns(sqlText: string): string[] {
  const list = /^\s*select (.+?) from /is.exec(sqlText)?.[1]
  if (!list) return []
  return list.split(/,\s*/).map((c) => {
    const ids = c.match(/"([^"]+)"/g)
    return ids ? ids[ids.length - 1].replace(/"/g, '') : c.trim()
  })
}

function walletExecutor(wallet: { cash: string; exposure: string; bonus?: string }) {
  const row: Record<string, unknown> = {
    id: 31, tenant: 'w-lock', user_id: 4242, currency: 'INR',
    cash: wallet.cash, bonus: wallet.bonus ?? '0', exposure: wallet.exposure, referral_bonus: '0', referral_balance: '0',
  }
  const log: { flat: string; params: unknown[] }[] = []
  const executor = drizzle(async (sqlText: string, params: unknown[], method: string) => {
    const flat = sqlText.replace(/\s+/g, ' ').trim().toLowerCase()
    log.push({ flat, params })
    const rows = flat.startsWith('select') && flat.includes('from "wallets"') ? [row] : []
    if (method === 'all') {
      const cols = resultColumns(sqlText)
      return { rows: rows.map((r) => cols.map((c) => r[c] ?? null)) }
    }
    return { rows }
  })
  const writes = () => log.filter((s) => /^(update|insert|delete)\b/.test(s.flat))
  return { executor: executor as any, log, writes }
}

const META = { type: 'casino_bet' as const, transactionId: 'tx-lock-1', roundId: 'r-1' }

test('a cash stake above cash - exposure on the locked row is refused and nothing is written', async () => {
  const f = walletExecutor({ cash: '100', exposure: '80' })
  await assert.rejects(
    () => debitWalletForCasino(f.executor, 4242, 'w-lock', 50, 'cash', META),
    /Insufficient balance for casino debit \(available 20\.00, required 50\.00\)/
  )
  assert.ok(f.log.some((s) => /for update/.test(s.flat)), 'the wallet row is locked before the check')
  assert.deepEqual(f.writes(), [])
})

test('a cash stake equal to the free chips is taken off cash', async () => {
  const f = walletExecutor({ cash: '100', exposure: '80' })
  assert.equal(await debitWalletForCasino(f.executor, 4242, 'w-lock', 20, 'cash', META), 80)
  const update = f.writes().find((s) => s.flat.startsWith('update "wallets"'))!
  assert.match(update.flat, /set "cash" = \$1/)
  assert.equal(update.params[0], '80')
})

test('free chips are compared in cents, so float noise does not refuse an exact stake', async () => {
  const f = walletExecutor({ cash: '100.10', exposure: '0.10' })
  assert.equal(await debitWalletForCasino(f.executor, 4242, 'w-lock', 100, 'cash', META), 100.1 - 100)
})

test('a bonus stake is checked against the bonus balance only', async () => {
  const f = walletExecutor({ cash: '0', exposure: '80', bonus: '50' })
  assert.equal(await debitWalletForCasino(f.executor, 4242, 'w-lock', 50, 'bonus', META), 0)
  const update = f.writes().find((s) => s.flat.startsWith('update "wallets"'))!
  assert.match(update.flat, /set "bonus" = \$1/)
})
