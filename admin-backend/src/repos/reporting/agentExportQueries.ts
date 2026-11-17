import { and, asc, desc, eq, getTableColumns, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '@src/db/client.js'
import {
  agentCredentials,
  agents,
  agentSettlementTransactions,
  casinoBets,
  casinoBetStatusEnum,
  depositRequests,
  depositStatusEnum,
  matkaBets,
  matkaBetStatusEnum,
  matkas,
  matkaTypeEnum,
  payoutStatusEnum,
  sportsBets,
  sportsBetStatusEnum,
  sportsEventsTable,
  sportsLeaguesTable,
  sportsMarketsTable,
  sportsRunnersTable,
  sportsTable,
  users,
  userStatusEnum,
  withdrawalRequests,
} from '@shared/db/schema.js'
import { inAgentPlayers } from './agentPlayerScope.js'

/**
 * The rows of an agent's export, as SQL (agent features spec §4, 2026-10-22).
 *
 * ExportJobProcessor used to read the whitelabel's latest 10,000 bets, deposits or withdrawals and
 * then keep the agent's in memory. Once the whitelabel had more rows than the cap, an agent's file
 * was silently short. It also took an agent's players from users.agent_id alone, missing the
 * referral-linked ones.
 *
 * Here the agent's players are `inAgentPlayers` (the agent_hierarchy_closure subtree plus CONFIRMED
 * referrals, the reporting definition). That filter sits inside the WHERE of the same statement
 * that carries the cap, so the cap counts only the agent's rows.
 *
 * Each export has three builders:
 *   - a conditions builder (rendered by the unit tests);
 *   - a query: the file's rows, a drizzle builder (`.toSQL()` renders it, `await` runs it);
 *   - a count: the Export Center's estimate, capped like the file.
 */

/** The most rows one export file holds (the processor's long-standing cap). */
export const AGENT_EXPORT_ROW_CAP = 10_000

export interface AgentExportQueryScope {
  /** The agent whose subtree the rows belong to: the caller, or a sub-agent it named. */
  agentId: string
  tenant: string
  whitelabelId: string
}

/** A period on a row's creation time; either end may be open. */
export interface ExportWindow {
  from?: Date
  to?: Date
}

/**
 * A status filter against a Postgres enum:
 *   - `undefined` = no filter ("all", or nothing chosen);
 *   - `null` = a value the column cannot hold, which matches nothing (the raw value used to fail
 *     the whole export with "invalid input value for enum");
 *   - otherwise the enum's own spelling.
 */
export function pickEnumValue(raw: unknown, allowed: readonly string[]): string | null | undefined {
  if (raw === undefined || raw === null) return undefined
  const text = String(raw).trim()
  if (!text || text.toLowerCase() === 'all') return undefined
  return allowed.find((value) => value.toLowerCase() === text.toLowerCase()) ?? null
}

function enumCondition(column: AnyPgColumn, raw: unknown, allowed: readonly string[]): SQL | undefined {
  const value = pickEnumValue(raw, allowed)
  if (value === undefined) return undefined
  return value === null ? sql`false` : sql`${column} = ${value}`
}

function windowConditions(column: AnyPgColumn, window: ExportWindow): SQL[] {
  const out: SQL[] = []
  if (window.from) out.push(gte(column, window.from))
  if (window.to) out.push(lte(column, window.to))
  return out
}

function compact(parts: ReadonlyArray<SQL | undefined>): SQL[] {
  return parts.filter((part): part is SQL => part !== undefined)
}

async function countRows(table: PgTable, conditions: SQL[]): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(and(...conditions))
  return Math.min(Number(row?.n ?? 0), AGENT_EXPORT_ROW_CAP)
}

// ---- players -----------------------------------------------------------------

export function agentPlayersConditions(scope: AgentExportQueryScope, status?: unknown): SQL[] {
  return compact([
    eq(users.tenant, scope.tenant),
    inAgentPlayers(users.id, scope.agentId, scope.tenant),
    enumCondition(users.status, status, userStatusEnum.enumValues),
  ])
}

/**
 * Only the users columns the PLAYERS export writes (ExportJobProcessor.fetchPlayersData). Never
 * select() the whole row: users carries password_hash and token_version.
 */
const AGENT_PLAYER_EXPORT_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  username: users.username,
  status: users.status,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
  vipTierId: users.vipTierId,
  playerType: users.playerType,
  agentId: users.agentId,
  // The credit reference. A credit player's chips are its wallet (ExportJobProcessor reads them through
  // ChipService); the retired credit_used / credit_available are not exported.
  creditLimit: users.creditLimit,
}

export function agentPlayersQuery(scope: AgentExportQueryScope, status?: unknown) {
  return db
    .select(AGENT_PLAYER_EXPORT_COLUMNS)
    .from(users)
    .where(and(...agentPlayersConditions(scope, status)))
    .orderBy(asc(users.id))
    .limit(AGENT_EXPORT_ROW_CAP)
}

export function agentPlayersCount(scope: AgentExportQueryScope, status?: unknown): Promise<number> {
  return countRows(users, agentPlayersConditions(scope, status))
}

// ---- sports bets --------------------------------------------------------------

export function agentSportsBetConditions(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown): SQL[] {
  return compact([
    eq(sportsBets.tenant, scope.tenant),
    eq(sportsBets.whitelabelId, scope.whitelabelId),
    inAgentPlayers(sportsBets.userId, scope.agentId, scope.tenant),
    enumCondition(sportsBets.status, status, sportsBetStatusEnum.enumValues),
    ...windowConditions(sportsBets.createdAt, window),
  ])
}

/** Every bet column plus the names getSportsBets joins in (left joins: a bet is never dropped). */
export function agentSportsBetsQuery(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown) {
  return db
    .select({
      ...getTableColumns(sportsBets),
      sportName: sportsTable.name,
      leagueName: sportsLeaguesTable.name,
      eventName: sportsEventsTable.name,
      marketName: sportsMarketsTable.name,
      selectionName: sportsRunnersTable.name,
    })
    .from(sportsBets)
    .leftJoin(sportsEventsTable, eq(sportsBets.eventId, sportsEventsTable.id))
    .leftJoin(sportsLeaguesTable, eq(sportsBets.leagueId, sportsLeaguesTable.id))
    .leftJoin(sportsTable, eq(sportsBets.sportId, sportsTable.id))
    .leftJoin(sportsMarketsTable, eq(sportsBets.marketId, sportsMarketsTable.id))
    .leftJoin(sportsRunnersTable, eq(sportsBets.runnerId, sportsRunnersTable.id))
    .where(and(...agentSportsBetConditions(scope, window, status)))
    .orderBy(desc(sportsBets.createdAt), desc(sportsBets.id))
    .limit(AGENT_EXPORT_ROW_CAP)
}

export function agentSportsBetsCount(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown): Promise<number> {
  return countRows(sportsBets, agentSportsBetConditions(scope, window, status))
}

// ---- casino bets --------------------------------------------------------------

export function agentCasinoBetConditions(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown): SQL[] {
  return compact([
    eq(casinoBets.tenant, scope.tenant),
    eq(casinoBets.whitelabelId, scope.whitelabelId),
    inAgentPlayers(casinoBets.userId, scope.agentId, scope.tenant),
    enumCondition(casinoBets.status, status, casinoBetStatusEnum.enumValues),
    ...windowConditions(casinoBets.createdAt, window),
  ])
}

export function agentCasinoBetsQuery(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown) {
  return db
    .select()
    .from(casinoBets)
    .where(and(...agentCasinoBetConditions(scope, window, status)))
    .orderBy(desc(casinoBets.createdAt), desc(casinoBets.id))
    .limit(AGENT_EXPORT_ROW_CAP)
}

export function agentCasinoBetsCount(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown): Promise<number> {
  return countRows(casinoBets, agentCasinoBetConditions(scope, window, status))
}

// ---- matka bets ---------------------------------------------------------------

export function agentMatkaBetConditions(
  scope: AgentExportQueryScope,
  window: ExportWindow,
  status?: unknown,
  matkaType?: unknown,
): SQL[] {
  return compact([
    eq(matkaBets.tenant, scope.tenant),
    eq(matkaBets.whitelabelId, scope.whitelabelId),
    inAgentPlayers(matkaBets.userId, scope.agentId, scope.tenant),
    enumCondition(matkaBets.status, status, matkaBetStatusEnum.enumValues),
    enumCondition(matkaBets.matkaType, matkaType, matkaTypeEnum.enumValues),
    ...windowConditions(matkaBets.createdAt, window),
  ])
}

/** Every bet column plus the matka's name, as getMatkaBets returns them. */
export function agentMatkaBetsQuery(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown, matkaType?: unknown) {
  return db
    .select({ ...getTableColumns(matkaBets), matkaName: matkas.name })
    .from(matkaBets)
    .leftJoin(matkas, eq(matkas.id, matkaBets.matkaId))
    .where(and(...agentMatkaBetConditions(scope, window, status, matkaType)))
    .orderBy(desc(matkaBets.createdAt), desc(matkaBets.id))
    .limit(AGENT_EXPORT_ROW_CAP)
}

export function agentMatkaBetsCount(
  scope: AgentExportQueryScope,
  window: ExportWindow,
  status?: unknown,
  matkaType?: unknown,
): Promise<number> {
  return countRows(matkaBets, agentMatkaBetConditions(scope, window, status, matkaType))
}

// ---- deposit requests ----------------------------------------------------------

export function agentDepositConditions(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown): SQL[] {
  return compact([
    eq(depositRequests.tenant, scope.tenant),
    inAgentPlayers(depositRequests.userId, scope.agentId, scope.tenant),
    enumCondition(depositRequests.status, status, depositStatusEnum.enumValues),
    ...windowConditions(depositRequests.createdAt, window),
  ])
}

/** Every deposit_requests column but proof_data: an export never carries the screenshots (up to 2 MB each). */
const { proofData: _depositScreenshot, ...depositExportColumns } = getTableColumns(depositRequests)

export function agentDepositsQuery(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown) {
  return db
    .select(depositExportColumns)
    .from(depositRequests)
    .where(and(...agentDepositConditions(scope, window, status)))
    .orderBy(desc(depositRequests.createdAt), desc(depositRequests.id))
    .limit(AGENT_EXPORT_ROW_CAP)
}

export function agentDepositsCount(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown): Promise<number> {
  return countRows(depositRequests, agentDepositConditions(scope, window, status))
}

// ---- withdrawal requests --------------------------------------------------------

export function agentWithdrawalConditions(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown): SQL[] {
  return compact([
    eq(withdrawalRequests.tenant, scope.tenant),
    inAgentPlayers(withdrawalRequests.userId, scope.agentId, scope.tenant),
    enumCondition(withdrawalRequests.status, status, payoutStatusEnum.enumValues),
    ...windowConditions(withdrawalRequests.createdAt, window),
  ])
}

export function agentWithdrawalsQuery(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown) {
  return db
    .select()
    .from(withdrawalRequests)
    .where(and(...agentWithdrawalConditions(scope, window, status)))
    .orderBy(desc(withdrawalRequests.createdAt), desc(withdrawalRequests.id))
    .limit(AGENT_EXPORT_ROW_CAP)
}

export function agentWithdrawalsCount(scope: AgentExportQueryScope, window: ExportWindow, status?: unknown): Promise<number> {
  return countRows(withdrawalRequests, agentWithdrawalConditions(scope, window, status))
}

// ---- agent settlements ----------------------------------------------------------

export function agentSettlementConditions(tenant: string, agentIds: readonly string[], window: ExportWindow): SQL[] {
  return compact([
    eq(agentSettlementTransactions.tenant, tenant),
    agentIds.length > 0 ? inArray(agentSettlementTransactions.agentId, [...agentIds]) : sql`false`,
    ...windowConditions(agentSettlementTransactions.createdAt, window),
  ])
}

export function agentSettlementsQuery(tenant: string, agentIds: readonly string[], window: ExportWindow) {
  return db
    .select()
    .from(agentSettlementTransactions)
    .where(and(...agentSettlementConditions(tenant, agentIds, window)))
    .orderBy(desc(agentSettlementTransactions.createdAt), desc(agentSettlementTransactions.id))
    .limit(AGENT_EXPORT_ROW_CAP)
}

export function agentSettlementsCount(tenant: string, agentIds: readonly string[], window: ExportWindow): Promise<number> {
  return countRows(agentSettlementTransactions, agentSettlementConditions(tenant, agentIds, window))
}

// ---- the agents of a scope --------------------------------------------------------

/** Name, scheme, parent and creation time of the given agents, in the tenant, oldest first. */
export function agentsInScopeQuery(tenant: string, agentIds: readonly string[]) {
  return db
    .select({
      id: agents.id,
      username: agentCredentials.username,
      schemeType: agents.schemeType,
      parentAgentId: agents.parentAgentId,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
    .where(and(eq(agents.tenantId, tenant), agentIds.length > 0 ? inArray(agents.id, [...agentIds]) : sql`false`))
    .orderBy(asc(agents.createdAt), asc(agents.id))
}
