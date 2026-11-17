import { sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'

export async function getPlayerTransactionsPage(tenant: string, userId: number, filter: any, includeCredit: boolean) {
  const limit = Math.min(500, Math.max(1, filter.limit || 50)), offset = Math.max(0, filter.offset || 0)
  const tz = await getWhitelabelTimezone(tenant)
  const from = filter.dateFrom ? parseDateFrom(filter.dateFrom, tz).toISOString() : null
  const to = filter.dateTo ? parseDateTo(filter.dateTo, tz).toISOString() : null
  const type = String(filter.type || '').toLowerCase(), status = String(filter.status || '').toLowerCase()
  const search = filter.search?.trim() ? `%${filter.search.trim()}%` : null
  // Merge before filtering/counting/paging. Foreign-key references, never amount/minute guesses,
  // identify requests already represented by a ledger entry.
  // A credit player's money moves only as chips (spec 2026-11-02, CREDIT on Deposit/Withdraw chips): its upline's
  // Deposit / Withdraw chips writes a CHIP_DEPOSIT / CHIP_WITHDRAW ledger row on its cash wallet, listed here as
  // chip_deposit / chip_withdrawal ("Chip deposit" / "Chip withdrawal"), with the remark (or who moved the chips) as
  // the reference. They are the wallet's own rows, like deposits, so includeCredit does not gate them.
  const result = await db.execute<{ total: number; items: any[] }>(sql`
    WITH ledger_base AS (
      SELECT l.*, w.currency,
        CASE WHEN l.type='CHIP_DEPOSIT' THEN 'chip_deposit' WHEN l.type='CHIP_WITHDRAW' THEN 'chip_withdrawal'
          WHEN l.type='withdrawal_pending' OR l.meta->>'type'='withdrawal' THEN 'withdrawal'
          WHEN l.meta->>'type'='admin_adjustment' THEN CASE WHEN l.type='credit' THEN 'manual_deposit' ELSE 'manual_withdrawal' END
          WHEN l.meta->>'type'='deposit' THEN 'deposit' ELSE 'transfer' END AS display_type
      FROM ledger_entries l JOIN wallets w ON w.id=l.wallet_id AND w.tenant=l.tenant
      WHERE l.tenant=${tenant} AND w.user_id=${userId}
        AND ((l.type='credit' AND l.meta->>'type' IN ('deposit','bonus_release','bonus_instant_cash','bonus_instant_cash_transfer','bonus_to_cash','referral_balance_to_cash'))
          OR (l.type='debit' AND l.meta->>'type'='withdrawal') OR l.type='withdrawal_pending'
          OR l.meta->>'type'='admin_adjustment' OR l.type IN ('CHIP_DEPOSIT','CHIP_WITHDRAW'))
    ), sources AS (
      SELECT 'ledger_'||l.id AS id, l.display_type AS type,
        coalesce(l.meta->>'method',CASE WHEN l.meta->>'type'='admin_adjustment' THEN 'Admin Adjustment'
          WHEN l.type='CHIP_DEPOSIT' THEN 'Chip deposit' WHEN l.type='CHIP_WITHDRAW' THEN 'Chip withdrawal' END) AS method,
        abs(coalesce(CASE WHEN l.meta->>'originalAmount' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (l.meta->>'originalAmount')::numeric END,l.amount)) AS amount,
        coalesce(CASE WHEN l.meta->>'fees' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (l.meta->>'fees')::numeric END,0) AS fees,
        coalesce(d.status::text,w.status::text,l.meta->>'status',CASE WHEN l.type='withdrawal_pending' THEN 'pending' ELSE 'completed' END) AS raw_status,
        coalesce(l.meta->>'reference',d.utr,d.reference_id,CASE WHEN l.meta->>'type'='admin_adjustment' THEN l.meta->>'reason'
          WHEN l.type IN ('CHIP_DEPOSIT','CHIP_WITHDRAW') THEN coalesce(nullif(l.meta->>'remark',''),l.meta->>'description') END) AS reference,
        l.meta->>'provider' AS provider,coalesce(l.meta->>'originalCurrency',l.currency) AS currency,
        l.created_at,l.meta,l.balance_before,l.balance_after
      FROM ledger_base l
      LEFT JOIN LATERAL (SELECT d.* FROM deposit_requests d WHERE d.tenant=${tenant} AND d.user_id=${userId}
        AND (d.wallet_txn_id=l.id OR l.meta->>'depositRequestId'=d.id::text) ORDER BY d.id LIMIT 1) d ON true
      LEFT JOIN LATERAL (SELECT w.* FROM withdrawal_requests w WHERE w.tenant=${tenant} AND w.user_id=${userId}
        AND (w.ledger_txn_id=l.id OR l.meta->>'withdrawalRequestId'=w.id::text) ORDER BY w.id LIMIT 1) w ON true
      UNION ALL
      SELECT 'deposit_'||d.id,'deposit',d.method::text,d.amount,0,d.status::text,coalesce(d.utr,d.reference_id),null,d.currency,
        d.created_at,jsonb_build_object('depositRequestId',d.id,'method',d.method,'utr',d.utr,'referenceId',d.reference_id),d.balance_before,d.balance_after
      FROM deposit_requests d WHERE d.tenant=${tenant} AND d.user_id=${userId}
        AND NOT EXISTS (SELECT 1 FROM ledger_base l WHERE d.wallet_txn_id=l.id OR l.meta->>'depositRequestId'=d.id::text)
      UNION ALL
      SELECT 'withdrawal_'||w.id,'withdrawal',null,w.amount,0,w.status::text,null,null,w.currency,
        w.created_at,jsonb_build_object('withdrawalRequestId',w.id,'payoutAccountId',w.payout_account_id),w.balance_before,w.balance_after
      FROM withdrawal_requests w WHERE w.tenant=${tenant} AND w.user_id=${userId}
        AND NOT EXISTS (SELECT 1 FROM ledger_base l WHERE w.ledger_txn_id=l.id OR l.meta->>'withdrawalRequestId'=w.id::text)
      UNION ALL
      SELECT 'credit_'||c.id,'adjustment','Credit Adjustment',abs(c.amount),0,'completed',c.reason,null,c.currency,c.created_at,
        coalesce(c.metadata,c.meta,'{}'::jsonb)||jsonb_build_object('transactionType',c.transaction_type,'reason',c.reason),c.balance_before,c.balance_after
      FROM agent_credit_ledger c WHERE ${includeCredit}::boolean AND c.tenant_id=${tenant}
        AND ((c.to_entity_type='player' AND c.to_entity_id=${String(userId)})
          OR (c.from_entity_type='player' AND c.from_entity_id=${String(userId)} AND c.transaction_type NOT IN ('CREDIT_LIMIT_ADJUSTMENT','RELEASE')))
        AND c.bet_id IS NULL AND c.transaction_type NOT IN ('USAGE','RELEASE','CREDIT_USED_INCREASE','CREDIT_USED_DECREASE')
    ), normalized AS (
      SELECT sources.*,CASE WHEN lower(raw_status) IN ('approved','success','completed') THEN 'completed'
        WHEN lower(raw_status) IN ('rejected','failed','cancelled','canceled') THEN 'failed' ELSE lower(raw_status) END AS status
      FROM sources
    ), filtered AS (
      SELECT * FROM normalized WHERE (${from}::timestamptz IS NULL OR created_at>=${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR created_at<=${to}::timestamptz)
        AND (${type}='' OR type=${type} OR (${type}='all_deposit' AND type IN ('deposit','manual_deposit','chip_deposit'))
          OR (${type}='all_withdrawal' AND type IN ('withdrawal','manual_withdrawal','chip_withdrawal')))
        AND (${status}='' OR status=${status})
        AND (${filter.method || null}::text IS NULL OR method ILIKE ${filter.method || null})
        AND (${filter.amountMin ?? null}::numeric IS NULL OR amount>=${filter.amountMin ?? null}::numeric)
        AND (${filter.amountMax ?? null}::numeric IS NULL OR amount<=${filter.amountMax ?? null}::numeric)
        AND (${search}::text IS NULL OR concat_ws(' ',id,type,method,reference,status,meta->>'reason') ILIKE ${search})
    )
    SELECT counts.total,coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC,page.id DESC)
      FILTER(WHERE page.id IS NOT NULL),'[]'::jsonb) AS items
    FROM (SELECT count(*)::int AS total FROM filtered) counts
    LEFT JOIN LATERAL (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}) page ON true
    GROUP BY counts.total
  `)
  const page = result.rows[0] ?? { total: 0, items: [] }
  const items = page.items.map(row => ({
    id: row.id, type: row.type, method: row.method, amount: Number(row.amount), fees: Number(row.fees),
    netAmount: Number(row.amount) - Number(row.fees), status: row.status, reference: row.reference,
    provider: row.provider, currency: row.currency, createdAt: new Date(row.created_at).toISOString(),
    metadata: row.meta == null ? null : JSON.stringify(row.meta),
    balanceBefore: row.balance_before == null ? null : Number(row.balance_before),
    balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
  }))
  return { items, total: page.total, hasMore: offset + limit < page.total }
}
