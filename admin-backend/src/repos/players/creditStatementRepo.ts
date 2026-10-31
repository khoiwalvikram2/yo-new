import { sql, type SQL } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import type { CreditStatementDomain, CreditStatementEntry } from '@src/domains/players/services/creditStatement.js'
import {
  SETTLEMENT_REASON_PREFIX,
  STATEMENT_LEDGER_TYPES,
  type CreditLedgerSourceRow,
} from '@src/domains/players/services/creditStatementLedger.js'

/**
 * Reads for the credit player statement (Query.playerCreditStatement).
 *
 * Every read is scoped by player id AND tenant. Which bets count is decided
 * here, in SQL, so voids and cancels never become rows (the spec: they appear
 * only through their final settled state):
 *   sports  status won/lost/settled, pl set        amount = pl
 *   casino  status won/lost, wallet_type 'cash'    amount = net_amount
 *   matka   status won/lost                        amount = actual_win − bet_amount
 * All three are in the player's P&L sign, the sign settlement_balance uses.
 * These are the definitions of the player-overview aggregates
 * (sportsBetsRepo / matkaBetsRepo getPlayerOverviewSettledAggregates).
 */

/**
 * The most settled bets one statement range may hold. A longer range is
 * refused with a message rather than truncated: a truncated range would give a
 * wrong opening balance. (2026-10-22: the busiest casino player settles about
 * 20,000 rounds a month.)
 */
export const STATEMENT_ROW_CAP = 50000

export interface CreditAccountRow {
  playerId: number
  playerType: string
  creditLimit: number
  creditUsed: number
  creditAvailable: number
  settlementBalance: number
  settlementBalanceSports: number
  settlementBalanceCasino: number
  settlementBalanceMatka: number
}

type Executor = { execute(query: SQL): Promise<unknown> }

function rowsOf(result: unknown): Array<Record<string, any>> {
  if (Array.isArray(result)) return result
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? rows : []
}

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

function ts(value: Date): SQL {
  return sql`${value.toISOString()}::timestamptz`
}

function toLedgerRow(r: Record<string, any>): CreditLedgerSourceRow {
  return {
    id: String(r.id),
    transactionType: String(r.transaction_type),
    fromEntityType: String(r.from_entity_type),
    fromEntityId: String(r.from_entity_id),
    toEntityType: String(r.to_entity_type),
    toEntityId: String(r.to_entity_id),
    amount: num(r.amount),
    balanceBefore: num(r.balance_before),
    balanceAfter: num(r.balance_after),
    reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
    metadata: r.metadata ?? null,
    createdAt: asDate(r.created_at),
  }
}

const LEDGER_COLUMNS = sql`id::text AS id, transaction_type::text AS transaction_type,
  from_entity_type::text AS from_entity_type, from_entity_id,
  to_entity_type::text AS to_entity_type, to_entity_id,
  amount, balance_before, balance_after, reason, metadata, created_at`

export class CreditStatementRepo {
  private readonly exec: Executor

  constructor(exec: Executor = db) {
    this.exec = exec
  }

  /** The whitelabel's timezone; the statement's yyyy-MM-dd days are days in that zone. */
  async getTimezone(tenant: string): Promise<string> {
    return getWhitelabelTimezone(tenant)
  }

  /**
   * Runs `fn` against one REPEATABLE READ, READ ONLY transaction, so the
   * current balance and every row are read at the same instant: a bet settling
   * mid-read cannot skew the opening balance, and nothing here can write.
   */
  async readSnapshot<T>(fn: (repo: CreditStatementRepo) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => fn(new CreditStatementRepo(tx)), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
  }

  async findCreditAccount(playerId: number, tenant: string): Promise<CreditAccountRow | null> {
    const result = await this.exec.execute(sql`
      SELECT id, player_type::text AS player_type,
             credit_limit, credit_used, credit_available,
             settlement_balance, settlement_balance_sports, settlement_balance_casino, settlement_balance_matka
      FROM users
      WHERE id = ${playerId} AND tenant = ${tenant}
      LIMIT 1`)
    const r = rowsOf(result)[0]
    if (!r) return null
    return {
      playerId: Number(r.id),
      playerType: String(r.player_type),
      creditLimit: num(r.credit_limit),
      creditUsed: num(r.credit_used),
      creditAvailable: num(r.credit_available),
      settlementBalance: num(r.settlement_balance),
      settlementBalanceSports: num(r.settlement_balance_sports),
      settlementBalanceCasino: num(r.settlement_balance_casino),
      settlementBalanceMatka: num(r.settlement_balance_matka),
    }
  }

  /** Settled bets in [from, to], oldest first. */
  async listSettledBets(playerId: number, tenant: string, from: Date, to: Date): Promise<CreditStatementEntry[]> {
    const result = await this.exec.execute(sql`
      SELECT id, domain, occurred_at, amount, reference, details FROM (
        (SELECT 'sports:' || b.id::text AS id, 'sports' AS domain, b.settled_at AS occurred_at,
                b.pl AS amount, e.name AS reference, m.name AS details
           FROM sports_bets b
           LEFT JOIN sports_events e ON e.id = b.event_id
           LEFT JOIN sports_markets m ON m.id = b.market_id
          WHERE b.user_id = ${playerId} AND b.tenant = ${tenant}
            AND b.status IN ('won', 'lost', 'settled') AND b.pl IS NOT NULL
            AND b.settled_at >= ${ts(from)} AND b.settled_at <= ${ts(to)})
        UNION ALL
        (SELECT 'casino:' || c.id::text, 'casino', c.settled_at,
                c.net_amount, c.game_name, c.vendor_name
           FROM casino_bets c
          WHERE c.user_id = ${playerId} AND c.tenant = ${tenant}
            AND c.status IN ('won', 'lost') AND c.wallet_type = 'cash' AND c.net_amount IS NOT NULL
            AND c.settled_at >= ${ts(from)} AND c.settled_at <= ${ts(to)})
        UNION ALL
        (SELECT 'matka:' || k.id::text, 'matka', k.settled_at,
                COALESCE(k.actual_win, 0) - k.bet_amount, k.market_name, k.bid_type || ' ' || k.bet_numbers
           FROM matka_bets k
          WHERE k.user_id = ${playerId} AND k.tenant = ${tenant}
            AND k.status IN ('won', 'lost')
            AND k.settled_at >= ${ts(from)} AND k.settled_at <= ${ts(to)})
      ) settled
      ORDER BY occurred_at ASC, id ASC
      LIMIT ${STATEMENT_ROW_CAP + 1}`)
    const rows = rowsOf(result)
    if (rows.length > STATEMENT_ROW_CAP) {
      throw new Error(`More than ${STATEMENT_ROW_CAP} settled bets fall in this date range. Choose a shorter range.`)
    }
    return rows.map((r) => ({
      id: String(r.id),
      type: 'BET_SETTLED' as const,
      occurredAt: asDate(r.occurred_at),
      domain: String(r.domain) as CreditStatementDomain,
      reference: r.reference === null || r.reference === undefined ? null : String(r.reference),
      details: r.details === null || r.details === undefined ? null : String(r.details),
      amount: num(r.amount),
      valueBefore: null,
      valueAfter: null,
    }))
  }

  /** Σ settled-bet P&L after `after` up to now, with the same filters as listSettledBets. */
  async sumSettledBetsAfter(playerId: number, tenant: string, after: Date): Promise<number> {
    const result = await this.exec.execute(sql`
      SELECT
          COALESCE((SELECT SUM(pl) FROM sports_bets
                     WHERE user_id = ${playerId} AND tenant = ${tenant}
                       AND status IN ('won', 'lost', 'settled') AND pl IS NOT NULL
                       AND settled_at > ${ts(after)}), 0)
        + COALESCE((SELECT SUM(net_amount) FROM casino_bets
                     WHERE user_id = ${playerId} AND tenant = ${tenant}
                       AND status IN ('won', 'lost') AND wallet_type = 'cash' AND net_amount IS NOT NULL
                       AND settled_at > ${ts(after)}), 0)
        + COALESCE((SELECT SUM(COALESCE(actual_win, 0) - bet_amount) FROM matka_bets
                     WHERE user_id = ${playerId} AND tenant = ${tenant}
                       AND status IN ('won', 'lost')
                       AND settled_at > ${ts(after)}), 0)
        AS total`)
    return num(rowsOf(result)[0]?.total)
  }

  /** The player's ledger rows of the statement types in [from, to], either side of the row. */
  async listLedgerRows(playerId: number, tenant: string, from: Date, to: Date): Promise<CreditLedgerSourceRow[]> {
    const id = String(playerId)
    const types = sql.join(STATEMENT_LEDGER_TYPES.map((type) => sql`${type}`), sql`, `)
    const result = await this.exec.execute(sql`
      SELECT ${LEDGER_COLUMNS}
        FROM agent_credit_ledger
       WHERE tenant_id = ${tenant}
         AND ((to_entity_type = 'player' AND to_entity_id = ${id})
           OR (from_entity_type = 'player' AND from_entity_id = ${id}))
         AND transaction_type::text IN (${types})
         AND created_at >= ${ts(from)} AND created_at <= ${ts(to)}
       ORDER BY created_at ASC, id ASC`)
    return rowsOf(result).map(toLedgerRow)
  }

  /** Settlement rows (SETTLE's ADJUSTMENT to the player) after `after` up to now. */
  async listSettlementRowsAfter(playerId: number, tenant: string, after: Date): Promise<CreditLedgerSourceRow[]> {
    const result = await this.exec.execute(sql`
      SELECT ${LEDGER_COLUMNS}
        FROM agent_credit_ledger
       WHERE tenant_id = ${tenant}
         AND to_entity_type = 'player' AND to_entity_id = ${String(playerId)}
         AND transaction_type = 'ADJUSTMENT'
         AND reason LIKE ${SETTLEMENT_REASON_PREFIX + '%'}
         AND created_at > ${ts(after)}
       ORDER BY created_at ASC, id ASC`)
    return rowsOf(result).map(toLedgerRow)
  }
}
