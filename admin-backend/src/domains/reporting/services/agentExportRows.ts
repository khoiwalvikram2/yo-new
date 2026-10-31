import { cycleBoundsFromKey, cycleKeyIST, cycleKeysInRange } from '@src/domains/agents/services/commissionCycleMath.js'
import type { CommissionCycleInfo } from '@src/domains/agents/services/CommissionCycleService.js'
import type { ExportWindow } from '@src/repos/reporting/agentExportQueries.js'

/**
 * The rows of the two agent exports that are not raw table rows (agent features spec §4).
 *
 * COMMISSION: one row per agent per IST week, for the agent and every sub-agent below it, from the
 * commission engine's own cycle list (CommissionCycleService.listCyclesForAgent). The columns are
 * gross, adjustments, payable, paid and status, plus the loss carry-forward once the engine reports
 * it (feature 3 adds the optional carriedLoss / carryApplied / lossThisCycle; read only if present).
 * SETTLEMENTS: the scope agent's own settlements and those of its direct children.
 *
 * Pure: no I/O. countCommissionCycleRows mirrors listCyclePayables' week list (creation week to
 * the current week), so the Export Center's estimate equals the file's row count.
 */

export interface CommissionExportRow {
  id: string
  agentId: string
  name: string
  relation: 'SELF' | 'SUB_AGENT'
  cycleFrom: string
  cycleTo: string
  status: string
  /** The cycle's GROSS as the engine reports it (calculatedTotal). */
  gross: number
  /** Loss carried in from last week; blank until the engine reports carry-forward. */
  carriedLoss: number | ''
  /** The part of carriedLoss taken off this week's gross; blank until the engine reports it. */
  carryApplied: number | ''
  /** This week's loss, which carries to next week; blank until the engine reports it. */
  lossThisCycle: number | ''
  adjustments: number
  /** Blank while the week is OPEN (nothing is payable yet). */
  payable: number | ''
  paid: number
  currency: string
}

/** Half-open weeks [from, to) against a period whose ends may be open. */
export function cycleOverlapsWindow(cycle: { from: Date; to: Date }, window: ExportWindow): boolean {
  if (window.from && !(cycle.to.getTime() > window.from.getTime())) return false
  if (window.to && !(cycle.from.getTime() < window.to.getTime())) return false
  return true
}

/** The scope agent first, then the rest by username (nameless last), then by id. */
export function orderScopeAgents<T extends { id: string; username: string | null }>(agents: readonly T[], scopeAgentId: string): T[] {
  const root = agents.filter((a) => String(a.id) === scopeAgentId)
  const rest = agents
    .filter((a) => String(a.id) !== scopeAgentId)
    .sort((a, b) => (a.username ?? '￿').localeCompare(b.username ?? '￿') || String(a.id).localeCompare(String(b.id)))
  return [...root, ...rest]
}

function optionalNumber(source: object, key: string): number | '' {
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : ''
}

export function buildCommissionCycleRows(
  agents: ReadonlyArray<{ id: string; username: string | null }>,
  cyclesByAgent: ReadonlyMap<string, readonly CommissionCycleInfo[]>,
  options: { window: ExportWindow; scopeAgentId: string; currency: string },
): CommissionExportRow[] {
  const rows: CommissionExportRow[] = []
  for (const agent of agents) {
    const id = String(agent.id)
    for (const cycle of cyclesByAgent.get(id) ?? []) {
      if (!cycleOverlapsWindow(cycle, options.window)) continue
      rows.push({
        id: `${id}:${cycle.from.toISOString()}`,
        agentId: id,
        name: agent.username || id,
        relation: id === options.scopeAgentId ? 'SELF' : 'SUB_AGENT',
        cycleFrom: cycle.from.toISOString(),
        cycleTo: cycle.to.toISOString(),
        status: cycle.status,
        gross: cycle.calculatedTotal ?? 0,
        carriedLoss: optionalNumber(cycle, 'carriedLoss'),
        carryApplied: optionalNumber(cycle, 'carryApplied'),
        lossThisCycle: optionalNumber(cycle, 'lossThisCycle'),
        adjustments: cycle.adjustmentAmount ?? 0,
        payable: typeof cycle.payableAmount === 'number' ? cycle.payableAmount : '',
        paid: cycle.paidAmount ?? 0,
        currency: options.currency,
      })
    }
  }
  return rows
}

/**
 * How many rows buildCommissionCycleRows lists for agents created at these times: each agent's
 * weeks run from its creation week to the current week (listCyclePayables), kept when they overlap
 * the period. An unreadable creation time counts from the current week, as the engine does.
 */
export function countCommissionCycleRows(createdAts: ReadonlyArray<Date | string>, window: ExportWindow, now: Date): number {
  const end = cycleBoundsFromKey(cycleKeyIST(now)).to
  let total = 0
  for (const raw of createdAts) {
    const created = raw instanceof Date ? raw : new Date(raw)
    const start = cycleBoundsFromKey(cycleKeyIST(Number.isNaN(created.getTime()) ? now : created)).from
    for (const key of cycleKeysInRange(start, end)) {
      if (cycleOverlapsWindow(cycleBoundsFromKey(key), window)) total += 1
    }
  }
  return total
}

/** The agents whose settlements a SHARING/CREDIT agent's export holds: itself, then its direct children. */
export function settlementAgentIds(scopeAgentId: string, directChildIds: readonly string[]): string[] {
  return [scopeAgentId, ...new Set(directChildIds.filter((id) => id !== scopeAgentId))]
}

export interface SettlementRowInput {
  id: unknown
  agentId: unknown
  settlementType?: unknown
  amount?: unknown
  direction?: unknown
  previousBalance?: unknown
  newBalance?: unknown
  notes?: unknown
  settledBy?: unknown
  createdAt?: unknown
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : typeof value === 'string' && value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : ''
}

export function toAgentSettlementRow(
  settlement: SettlementRowInput,
  agent: { username?: string | null; schemeType?: string | null } | undefined,
  options: { scopeAgentId: string; periodFrom?: unknown; periodTo?: unknown; currency: string },
) {
  const agentId = String(settlement.agentId ?? '')
  return {
    id: String(settlement.id ?? ''),
    agentId,
    name: agent?.username || '',
    type: agent?.schemeType || '',
    relation: agentId === options.scopeAgentId ? 'SELF' : 'DIRECT_SUB_AGENT',
    periodFrom: typeof options.periodFrom === 'string' ? options.periodFrom : '',
    periodTo: typeof options.periodTo === 'string' ? options.periodTo : '',
    totalAmount: toNumber(settlement.amount),
    currency: options.currency,
    status: settlement.settlementType === 'P_L' ? 'PROFIT_LOSS' : String(settlement.settlementType ?? ''),
    postedAt: toIso(settlement.createdAt),
    postedBy: settlement.settledBy ? String(settlement.settledBy) : '',
    direction: settlement.direction ? String(settlement.direction) : '',
    previousBalance: toNumber(settlement.previousBalance),
    newBalance: toNumber(settlement.newBalance),
    notes: settlement.notes ? String(settlement.notes) : '',
  }
}
