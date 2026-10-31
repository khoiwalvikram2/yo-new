import { DateTime } from 'luxon'
import { requireReadPermission } from '@src/domains/common/auth.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { CreditStatementRepo } from '@src/repos/players/creditStatementRepo.js'
import { PlayerAuthService } from './PlayerAuthService.js'
import {
  buildCreditStatement,
  normalizeStatementPaging,
  roundMoney,
  type CreditStatementEntry,
  type CreditStatementRow,
  type CreditStatementTotals,
} from './creditStatement.js'
import { ledgerRowToEntry } from './creditStatementLedger.js'

/**
 * Query.playerCreditStatement (spec 2026-10-22 §1): a credit player's
 * statement for a date range.
 *
 * Access:
 *   - players.credit:view. Admins need it; agents hold it through flat
 *     players:view (deriveAgentPermissions), the same gate as
 *     playerCreditTransactions.
 *   - Agents are then held to their subtree's players plus CONFIRMED referral
 *     players (validateAgentPlayerAccess).
 *   - Admins are held to their tenant: the account read is tenant-scoped,
 *     and a Super Admin in whitelabel mode reads the chosen whitelabel.
 *   - A player who is not AGENT_CREDIT / WHITELABEL_CREDIT gets a clear error.
 */

export const CREDIT_PLAYER_TYPES: readonly string[] = ['AGENT_CREDIT', 'WHITELABEL_CREDIT']

export interface PlayerCreditStatementArgs {
  playerId?: string | number | null
  dateFrom?: string | null
  dateTo?: string | null
  limit?: number | null
  offset?: number | null
}

export interface PlayerCreditStatementRowPayload extends Omit<CreditStatementRow, 'occurredAt'> {
  occurredAt: string
}

export interface PlayerCreditStatementPayload {
  playerId: string
  playerType: string
  /** The instants the range covers, after the whitelabel timezone is applied. */
  dateFrom: string
  dateTo: string
  summary: {
    creditLimit: number
    creditUsed: number
    creditAvailable: number
    settlementBalance: number
    settlementBalanceSports: number
    settlementBalanceCasino: number
    settlementBalanceMatka: number
  }
  openingBalance: number
  closingBalance: number
  totals: CreditStatementTotals
  rows: PlayerCreditStatementRowPayload[]
  totalRows: number
  limit: number
  offset: number
}

function requireDateArg(value: unknown, name: 'dateFrom' | 'dateTo'): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || Number.isNaN(new Date(text).getTime())) {
    throw new Error(`${name} must be a date (yyyy-MM-dd)`)
  }
  // new Date() accepts an impossible day such as 2026-02-30, but luxon
  // (parseDateFrom/parseDateTo) turns it into Invalid Date. Refuse it here,
  // before anything is read.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !DateTime.fromISO(text).isValid) {
    throw new Error(`${name} is not a valid date`)
  }
  return text
}

export async function resolvePlayerCreditStatement(args: PlayerCreditStatementArgs, ctx: any): Promise<PlayerCreditStatementPayload> {
  // A read: requireReadPermission, so a read-only (INACTIVE) agent may still read its own players.
  requireReadPermission(ctx, 'players.credit', 'view')

  const playerId = Number(args?.playerId)
  if (!Number.isInteger(playerId) || playerId <= 0) throw new Error('Invalid player ID')
  const dateFrom = requireDateArg(args?.dateFrom, 'dateFrom')
  const dateTo = requireDateArg(args?.dateTo, 'dateTo')
  const paging = normalizeStatementPaging(args?.limit, args?.offset)

  const tenant: string = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

  // Agents: subtree players plus CONFIRMED referral players. A no-op for admins,
  // who are held to their tenant by the account read below.
  await new PlayerAuthService().validateAgentPlayerAccess(ctx, playerId, 'view the credit statement of')

  const repo = new CreditStatementRepo()
  const timezone = await repo.getTimezone(tenant)
  const from = parseDateFrom(dateFrom, timezone)
  const to = parseDateTo(dateTo, timezone)
  // Defensive: an unusable whitelabel timezone also yields Invalid Date.
  if (Number.isNaN(from.getTime())) throw new Error('dateFrom is not a valid date')
  if (Number.isNaN(to.getTime())) throw new Error('dateTo is not a valid date')
  if (from.getTime() > to.getTime()) throw new Error('dateFrom must not be after dateTo')

  const snapshot = await repo.readSnapshot(async (snap) => {
    const account = await snap.findCreditAccount(playerId, tenant)
    if (!account) throw new Error('Player not found')
    if (!CREDIT_PLAYER_TYPES.includes(account.playerType)) {
      throw new Error(
        `The credit statement is for credit players only (AGENT_CREDIT or WHITELABEL_CREDIT). This player is ${account.playerType}.`,
      )
    }
    const bets = await snap.listSettledBets(playerId, tenant, from, to)
    const ledger = await snap.listLedgerRows(playerId, tenant, from, to)
    const betNetAfter = await snap.sumSettledBetsAfter(playerId, tenant, to)
    const settlementsAfter = await snap.listSettlementRowsAfter(playerId, tenant, to)
    return { account, bets, ledger, betNetAfter, settlementsAfter }
  })

  const idText = String(playerId)
  const entries: CreditStatementEntry[] = [...snapshot.bets]
  for (const row of snapshot.ledger) {
    const entry = ledgerRowToEntry(row, idText)
    if (entry) entries.push(entry)
  }
  let movementAfterRange = snapshot.betNetAfter
  for (const row of snapshot.settlementsAfter) {
    const entry = ledgerRowToEntry(row, idText)
    if (entry && entry.type === 'SETTLEMENT') movementAfterRange += entry.amount
  }

  const { account } = snapshot
  const result = buildCreditStatement({
    entries,
    currentBalance: account.settlementBalance,
    movementAfterRange,
    dateFrom: from,
    dateTo: to,
    limit: paging.limit,
    offset: paging.offset,
  })

  return {
    playerId: idText,
    playerType: account.playerType,
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    summary: {
      creditLimit: roundMoney(account.creditLimit),
      creditUsed: roundMoney(account.creditUsed),
      creditAvailable: roundMoney(account.creditAvailable),
      settlementBalance: roundMoney(account.settlementBalance),
      settlementBalanceSports: roundMoney(account.settlementBalanceSports),
      settlementBalanceCasino: roundMoney(account.settlementBalanceCasino),
      settlementBalanceMatka: roundMoney(account.settlementBalanceMatka),
    },
    openingBalance: result.openingBalance,
    closingBalance: result.closingBalance,
    totals: result.totals,
    rows: result.rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
    totalRows: result.totalRows,
    limit: paging.limit,
    offset: paging.offset,
  }
}
