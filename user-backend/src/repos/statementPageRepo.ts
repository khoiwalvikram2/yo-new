import { pool } from '../db/client.js'
import { getCasinoAndSportsBets, getLedgerItems } from './userAppRepo.js'

export type StatementPageInput = {
  domain: 'WALLET' | 'SPORTS' | 'CASINO' | 'MATKA'
  startDate: string
  endDate: string
  page?: number | null
  pageSize?: number | null
  search?: string | null
  status?: string | null
  type?: string | null
}

export function validateStatementPage(input: StatementPageInput) {
  const start = new Date(input.startDate), end = new Date(input.endDate)
  if (!['WALLET', 'SPORTS', 'CASINO', 'MATKA'].includes(input.domain)) throw new Error('Invalid statement domain')
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw new Error('Invalid statement date range')
  const page = Math.max(1, Math.trunc(input.page || 1))
  const pageSize = Math.max(1, Math.min(100, Math.trunc(input.pageSize || 10)))
  return { start, end, page, pageSize }
}

// These expressions mirror the existing TransactionItem mappers. Only IDs are
// paged here; the existing scoped mappers hydrate the selected financial rows.
const sportsProfit = `CASE WHEN status IN ('void','cancelled') THEN 0 WHEN pl IS NOT NULL THEN pl
 WHEN status <> 'void' AND (status = 'won' OR result = 'won') THEN
   CASE WHEN side = 'lay' THEN stake WHEN COALESCE(odds_size,0)>0 THEN stake*odds_size/100 ELSE stake*(price-1) END
 WHEN status <> 'void' AND (status = 'lost' OR result = 'lost') THEN
   CASE WHEN side = 'back' THEN -stake WHEN COALESCE(odds_size,0)>0 THEN -stake*odds_size/100 ELSE -liability END
 ELSE 0 END`
const walletType = `CASE
 WHEN meta_type IN ('matka_bet','matka_win','matka_refund','matka_result_reversal') THEN CASE meta_type WHEN 'matka_bet' THEN 'Matka Stake' WHEN 'matka_win' THEN 'Matka Settlement' WHEN 'matka_refund' THEN 'Matka Refund' WHEN 'matka_result_reversal' THEN 'Matka Result Reversal' END
 WHEN meta_type IN ('chip_deposit','chip_withdraw') THEN CASE meta_type WHEN 'chip_deposit' THEN 'Chip Deposit' ELSE 'Chip Withdrawal' END
 WHEN upper(trim(ledger_type)) IN ('CHIP_DEPOSIT','CHIP_WITHDRAW') THEN CASE upper(trim(ledger_type)) WHEN 'CHIP_DEPOSIT' THEN 'Chip Deposit' ELSE 'Chip Withdrawal' END
 WHEN meta_type = 'admin_adjustment' THEN CASE WHEN original_amount>=0 THEN 'Manual Deposit' ELSE 'Manual Withdrawal' END
 WHEN meta_type IN ('deposit','withdrawal','withdrawal_pending','withdrawal_refund','bonus','bonus_release','bonus_instant_cash','bonus_instant_cash_transfer','bonus_to_cash','bonus_forfeit','bonus_switch_debit','referral_earning','referral_balance_to_cash','referral_balance_backfill') THEN
  CASE meta_type WHEN 'deposit' THEN 'Deposit' WHEN 'withdrawal' THEN 'Withdrawal' WHEN 'withdrawal_pending' THEN 'Withdrawal' WHEN 'withdrawal_refund' THEN 'Withdrawal Refund'
   WHEN 'bonus' THEN 'Bonus Credit' WHEN 'bonus_release' THEN 'Bonus Release to Cash' WHEN 'bonus_instant_cash' THEN 'Instant Cash' WHEN 'bonus_instant_cash_transfer' THEN 'Bonus to Cash Transfer'
   WHEN 'bonus_to_cash' THEN 'Bonus to Cash' WHEN 'bonus_forfeit' THEN 'Bonus Forfeit' WHEN 'bonus_switch_debit' THEN 'Bonus Switch' WHEN 'referral_earning' THEN 'Referral Earning'
   WHEN 'referral_balance_to_cash' THEN 'Referral to Cash' WHEN 'referral_balance_backfill' THEN 'Referral' END
 WHEN lower(trim(ledger_type)) IN ('deposit','withdrawal','withdrawal_pending','withdrawal_refund','bonus','bonus_release','bonus_instant_cash','bonus_instant_cash_transfer','bonus_to_cash','bonus_forfeit','bonus_switch_debit','referral_earning','referral_balance_to_cash','referral_balance_backfill') THEN
  CASE lower(trim(ledger_type)) WHEN 'deposit' THEN 'Deposit' WHEN 'withdrawal' THEN 'Withdrawal' WHEN 'withdrawal_pending' THEN 'Withdrawal' WHEN 'withdrawal_refund' THEN 'Withdrawal Refund'
   WHEN 'bonus' THEN 'Bonus Credit' WHEN 'bonus_release' THEN 'Bonus Release to Cash' WHEN 'bonus_instant_cash' THEN 'Instant Cash' WHEN 'bonus_instant_cash_transfer' THEN 'Bonus to Cash Transfer'
   WHEN 'bonus_to_cash' THEN 'Bonus to Cash' WHEN 'bonus_forfeit' THEN 'Bonus Forfeit' WHEN 'bonus_switch_debit' THEN 'Bonus Switch' WHEN 'referral_earning' THEN 'Referral Earning'
   WHEN 'referral_balance_to_cash' THEN 'Referral to Cash' WHEN 'referral_balance_backfill' THEN 'Referral' END
 WHEN original_amount>=0 THEN CASE WHEN ledger_type='credit' THEN 'Credit' ELSE 'Deposit' END
 ELSE CASE WHEN ledger_type='debit' THEN 'Withdrawal' ELSE 'Debit' END END`

function statementBase(domain: StatementPageInput['domain']) {
  if (domain === 'MATKA') return `WITH base AS (
   SELECT b.id,b.created_at,COALESCE(b.market_session,lower(b.side::text),'open') AS display_type,
    CASE b.status WHEN 'won' THEN 'Win' WHEN 'lost' THEN 'Lose' WHEN 'void' THEN 'Void' WHEN 'cancelled' THEN 'Cancelled' ELSE 'Pending' END AS display_status,
    lower(concat_ws('|',b.id::text,COALESCE(m.name,b.market_name),b.matka_type::text,b.run_date::text,b.market_session,b.bid_type,b.bet_numbers,b.bet_amount::text,b.result)) AS search_text
   FROM matka_bets b LEFT JOIN matkas m ON m.id=b.matka_id AND m.tenant=$1
   WHERE b.tenant=$1 AND b.user_id=$2 AND b.created_at BETWEEN $3::timestamptz AND $4::timestamptz
  )`
  if (domain === 'SPORTS') return `WITH raw_rows AS (
   SELECT b.*, e.name AS event_name, l.name AS league_name, s.name AS sport_name, m.name AS market_name
   FROM sports_bets b LEFT JOIN sports_events e ON e.id=b.event_id LEFT JOIN sports_leagues l ON l.id=b.league_id
   LEFT JOIN sports s ON s.id=b.sport_id LEFT JOIN sports_markets m ON m.id=b.market_id
   WHERE b.tenant=$1 AND b.user_id=$2 AND b.created_at BETWEEN $3::timestamptz AND $4::timestamptz
  ), valued AS (SELECT *, ${sportsProfit} AS display_pl FROM raw_rows), base AS (
   SELECT id,created_at,side::text AS display_type,
    CASE WHEN status='void' THEN 'Void' WHEN status='cancelled' THEN 'Cancelled' WHEN status='won' OR result='won' THEN 'Win' WHEN status='lost' OR result='lost' THEN 'Lose'
     WHEN display_pl>0 THEN 'Win' WHEN display_pl<0 THEN 'Lose' WHEN status='matched' THEN 'Matched' WHEN status='unmatched' THEN 'Unmatched'
     WHEN status='settled' THEN 'Settled' WHEN status='cancelled' THEN 'Cancelled' ELSE 'Pending' END AS display_status,
    lower(concat_ws('|',id::text,COALESCE(sport_name,'Sport') || ' > ' || COALESCE(league_name,'League') || ' > ' || COALESCE(event_name,'Event'),COALESCE(market_name,'Market'),side::text)) AS search_text
   FROM valued
  )`
  if (domain === 'CASINO') return `WITH valued AS (
   SELECT id,created_at,game_name,vendor_name,status,
    CASE WHEN status IN ('pending','active','void','cancelled') THEN 0 WHEN COALESCE(net_amount,0)<>0 THEN net_amount ELSE COALESCE(win_amount,0)-stake END AS display_pl
   FROM casino_bets WHERE tenant=$1 AND user_id=$2 AND created_at BETWEEN $3::timestamptz AND $4::timestamptz
  ), base AS (
   SELECT id,created_at,''::text AS display_type,CASE WHEN status IN ('pending','active') THEN 'Pending' WHEN status='void' THEN 'Void' WHEN status='cancelled' THEN 'Cancelled' WHEN status='won' THEN 'Win' WHEN status='lost' THEN 'Lose' WHEN display_pl>0 THEN 'Win' WHEN display_pl<0 THEN 'Lose' ELSE 'Settled' END AS display_status,
    lower(concat_ws('|',id::text,COALESCE(game_name,'Casino Game'),COALESCE(vendor_name,'Game'))) AS search_text FROM valued
  )`
  return `WITH raw_rows AS (
   SELECT le.id,le.created_at,COALESCE(le.type,'ledger') AS ledger_type,lower(trim(COALESCE(le.meta->>'type',''))) AS meta_type,
    CASE WHEN le.meta ? 'originalAmount' THEN CASE WHEN trim(COALESCE(le.meta->>'originalAmount','')) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN (le.meta->>'originalAmount')::numeric ELSE 0 END ELSE COALESCE(le.amount,0) END AS original_amount,
    lower(trim(COALESCE(le.meta->>'status','completed'))) AS raw_status,le.meta->>'description' AS description,
    CASE WHEN COALESCE(le.meta->>'type','') ~ '^(bonus|referral)' THEN bc.name ELSE NULL END AS campaign_name
   FROM ledger_entries le JOIN wallets w ON w.id=le.wallet_id AND w.tenant=$1 AND w.user_id=$2
   LEFT JOIN bonus_campaigns bc ON bc.id::text=le.meta->>'campaignId' AND bc.tenant=$1
   WHERE le.tenant=$1 AND le.created_at BETWEEN $3::timestamptz AND $4::timestamptz
    AND (le.meta->>'type' IS NULL OR le.meta->>'type' NOT IN ('sports_bet_settlement','sports_bet_settlement_reversal','sports_bet_cancel','sports_bet_void','casino_bet','casino_win','casino_rollback','matka_bet','matka_win','matka_refund','matka_result_reversal'))
  ), displayed AS (SELECT *,${walletType} AS display_type,
   CASE WHEN raw_status IN ('approved','success','successful','settled','completed','done','1','approved_by_admin') THEN 'Success'
    WHEN raw_status IN ('failed','rejected','declined','cancelled','canceled','error','2','3') THEN 'Failed' ELSE 'Pending' END AS display_status
   FROM raw_rows
  ), base AS (SELECT id,created_at,display_type,display_status,
   lower(concat_ws('|',id::text,abs(original_amount)::float8::text,display_type,display_status,campaign_name,description)) AS search_text FROM displayed)
  `
}

export async function getStatementPage(userId: number, tenant: string, input: StatementPageInput) {
  const { start, end, page: requestedPage, pageSize } = validateStatementPage(input)
  const values: unknown[] = [tenant, userId, start, end]
  const filters: string[] = []
  const bind = (value: unknown) => { values.push(value); return '$' + values.length }
  if (input.search?.trim()) filters.push(`strpos(search_text,lower(${bind(input.search.trim())}::text))>0`)
  if (input.status && input.status !== 'all') filters.push(`display_status=${bind(input.status)}`)
  if (input.type && input.type !== 'all') filters.push(`lower(display_type)=lower(${bind(input.type)}::text)`)
  const where = filters.length ? ' WHERE ' + filters.join(' AND ') : ''
  const base = statementBase(input.domain)
  const [stats] = (await pool.query<{ total: number; wallet_types: string[] | null }>(`${base} SELECT
   (SELECT count(*)::int FROM base${where}) AS total,
   ${input.domain === 'WALLET' ? '(SELECT array_agg(DISTINCT display_type ORDER BY display_type) FROM base)' : 'NULL::text[]'} AS wallet_types`, values)).rows
  const total = Number(stats.total), page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
  if (!total) return { meta: { code: 200, message: 'ok', total, page, hasMore: false }, data: [], walletTypes: stats.wallet_types ?? [] }
  const ids = (await pool.query<{ id: string }>(`${base} SELECT id FROM base${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize])).rows.map(row => String(row.id))
  const data = input.domain === 'WALLET'
    ? await getLedgerItems(userId, tenant, start, end, ids)
    : input.domain === 'MATKA' ? await getMatkaStatementItems(userId, tenant, ids)
      : await getCasinoAndSportsBets(userId, tenant, start, end, { sportsIds: input.domain === 'SPORTS' ? ids : [], casinoIds: input.domain === 'CASINO' ? ids : [] })
  const order = new Map(ids.map((id, index) => [id, index]))
  data.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return { meta: { code: 200, message: 'ok', total, page, hasMore: page * pageSize < total }, data, walletTypes: stats.wallet_types ?? [] }
}

async function getMatkaStatementItems(userId: number, tenant: string, ids: string[]) {
  const { rows } = await pool.query(`SELECT b.*,COALESCE(m.name,b.market_name) AS current_market_name,m.timezone,
    COALESCE(b.run_date,(b.created_at AT TIME ZONE COALESCE(m.timezone,'Asia/Kolkata'))::date)::text AS trading_date
    FROM matka_bets b LEFT JOIN matkas m ON m.id=b.matka_id AND m.tenant=$1
    WHERE b.tenant=$1 AND b.user_id=$2 AND b.id=ANY($3::uuid[])`,[tenant,userId,ids])
  return rows.map(row => {
    const stake = Number(row.bet_amount), settled = ['won','lost','void','cancelled'].includes(row.status), refunded = ['void','cancelled'].includes(row.status)
    const payout = settled ? refunded ? stake : Number(row.actual_win || 0) : null
    return { id: row.id, amount: stake, stake, pl: payout == null ? null : payout - stake, payout, type: 'matka', status: row.status, result: row.status,
      description: row.current_market_name, createdAt: row.created_at.toISOString(), currency: row.currency, walletType: row.wallet_type,
      marketId: { id: row.matka_id, marketName: row.current_market_name, marketType: row.matka_type }, eventResult: row.result,
      runDate: row.trading_date, session: row.market_session || row.side?.toLowerCase() || (row.matka_type === 'jackpot' || row.matka_type === 'sattaMatka' ? 'close' : 'open'),
      bidType: row.bid_type, selectionName: row.bet_numbers, payoutMultiplier: Number(row.payout_multiplier), settledAt: row.settled_at?.toISOString() || null }
  })
}
