/**
 * One-time script: backfill existing unsettled referral earnings into wallets.referral_balance.
 * Run after migration 0054_add_referral_wallet_columns.sql and before/after deploying new claim/transfer logic.
 *
 * Usage: from shared folder: npx tsx scripts/backfillReferralBalance.ts
 * Requires: DATABASE_URL in env (e.g. from .env or export).
 */

import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg

interface UnsettledRow {
  id: number
  referrer_id: number
  tenant: string
  net_amount: string
}

async function backfillReferralBalance() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const pool = new Pool({ connectionString })
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Unsettled earnings = no matching referral_settlements row
    const { rows: unsettled } = await client.query<UnsettledRow>(`
      SELECT e.id, e.referrer_id, e.tenant, e.net_amount
      FROM referral_earnings e
      LEFT JOIN referral_settlements s ON s.earning_id = e.id
      WHERE s.id IS NULL
    `)

    if (unsettled.length === 0) {
      console.log('No unsettled referral earnings found. Nothing to backfill.')
      await client.query('COMMIT')
      return
    }

    // Group by (referrer_id, tenant), sum net_amount, keep earning ids
    const byReferrer = new Map<string, { total: number; earningIds: number[] }>()
    for (const row of unsettled) {
      const key = `${row.referrer_id}:${row.tenant}`
      const amount = parseFloat(row.net_amount)
      const existing = byReferrer.get(key)
      if (!existing) {
        byReferrer.set(key, { total: amount, earningIds: [row.id] })
      } else {
        existing.total += amount
        existing.earningIds.push(row.id)
      }
    }

    let walletsUpdated = 0
    let settlementsInserted = 0

    for (const [key, { total, earningIds }] of byReferrer.entries()) {
      const [referrerId, tenant] = key.split(':')
      const referrerIdNum = parseInt(referrerId, 10)

      const { rows: wallets } = await client.query<{ id: number; referral_balance: string }>(
        `SELECT id, referral_balance FROM wallets WHERE user_id = $1 AND tenant = $2`,
        [referrerIdNum, tenant]
      )
      const wallet = wallets[0]
      if (!wallet) {
        console.warn(`No wallet for referrer_id=${referrerIdNum} tenant=${tenant}, skipping`)
        continue
      }

      if (total > 0) {
        const balanceBefore = parseFloat(wallet.referral_balance || '0')
        const balanceAfter = balanceBefore + total

        await client.query(
          `UPDATE wallets SET referral_balance = referral_balance + $1 WHERE id = $2`,
          [total, wallet.id]
        )
        walletsUpdated += 1

        await client.query(
          `INSERT INTO ledger_entries (tenant, wallet_id, type, amount, balance_before, balance_after, meta)
           VALUES ($1, $2, 'credit', $3, $4, $5, $6)`,
          [
            tenant,
            wallet.id,
            total,
            balanceBefore,
            balanceAfter,
            JSON.stringify({
              type: 'referral_balance_backfill',
              source: 'migration',
              referrerId: referrerIdNum,
              totalCredited: total,
              earningCount: earningIds.length,
            }),
          ]
        )
      }

      // Always create settlement rows so earnings are marked settled (no double-count later)
      for (const earningId of earningIds) {
        const row = unsettled.find((r) => r.id === earningId)!
        const netAmount = parseFloat(row.net_amount)
        await client.query(
          `INSERT INTO referral_settlements (tenant, earning_id, referrer_id, payout_type, cash_amount, bonus_amount, currency, status, settled_at)
           VALUES ($1, $2, $3, 'CASH', $4, 0, 'INR', 'completed', NOW())`,
          [tenant, earningId, referrerIdNum, netAmount]
        )
        settlementsInserted += 1
      }
    }

    await client.query('COMMIT')
    console.log(
      `Backfill complete: ${walletsUpdated} wallet(s) updated, ${settlementsInserted} settlement(s) created.`
    )
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('Backfill failed:', err.message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

backfillReferralBalance().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
