import { db } from '@src/db/client.js'
import { agentHierarchyClosure } from '@shared/db/schema.js'
import { inArray } from 'drizzle-orm'
import { AgentConfigsRepo } from '@src/repos/agents/AgentConfigsRepo.js'
import { AgentLedgerRepo } from '@src/repos/agents/AgentLedgerRepo.js'
import { CommissionPayoutsRepo } from '@src/repos/settlements/CommissionPayoutsRepo.js'
import { CommissionCalculationService, loadCommissionRateRows, type CommissionAgentRecord, type CommissionAgentsReader } from '@src/domains/agents/services/CommissionCalculationService.js'
import { HybridGGRReader } from '@src/domains/agents/services/HybridGGRReader.js'
import type { CycleAgentGGRRow } from '@src/domains/agents/services/VerticalReaders.js'

export type CommissionReportAgent = CommissionAgentRecord & { parentAgentId: string | null }
type GroupedParams = Parameters<HybridGGRReader['getGGRByCycleAndAgent']>[0]
type GroupedRead = (params: GroupedParams) => Promise<CycleAgentGGRRow[]>

/** A request-local reader: one grouped bet read per exact date window, shared by the report's agents.
 * No cross-request cache: a new payout, resettlement or adjustment is visible on the next refresh.
 * The existing commission engine still applies the rates, tally, carry and paid-cycle rules. */
export class CommissionReportGGRReader extends HybridGGRReader {
  private readonly reads = new Map<string, Promise<CycleAgentGGRRow[]>>()
  private readonly allowed: Set<string>
  constructor(private readonly tenant: string, private readonly agentIds: string[], private readonly read?: GroupedRead) {
    super()
    this.allowed = new Set(agentIds)
  }

  override async getGGRByCycleAndAgent(params: GroupedParams): Promise<CycleAgentGGRRow[]> {
    if (params.tenantId !== this.tenant || params.agentIds.some(id => !this.allowed.has(id))) {
      throw new Error('Commission report scope does not match its tenant and agents')
    }
    const key = `${params.from.getTime()}:${params.to.getTime()}`
    let rows = this.reads.get(key)
    if (!rows) {
      const batch = { ...params, agentIds: [...this.agentIds] }
      rows = this.read ? this.read(batch) : super.getGGRByCycleAndAgent(batch)
      this.reads.set(key, rows)
    }
    const selected = new Set(params.agentIds)
    return (await rows).filter(row => selected.has(row.agentId))
  }
}

/** Preserve the database closure's membership, including its depth-zero self row. */
export function commissionReportAgents(
  rows: readonly CommissionReportAgent[],
  closure: ReadonlyArray<{ ancestorId: string; descendantId: string }>,
  options: { preserveExactClosure?: boolean } = {},
): CommissionAgentsReader {
  const byId = new Map(rows.map(row => [row.id, row]))
  const descendants = new Map(rows.map(row => [row.id, new Set<string>(options.preserveExactClosure ? [] : [row.id])]))
  for (const edge of closure) {
    if (byId.has(edge.descendantId)) descendants.get(edge.ancestorId)?.add(edge.descendantId)
  }
  return {
    async findById(id) { return byId.get(id.trim()) ?? null },
    async listChildren(id) { return rows.filter(row => row.parentAgentId === id) },
    async getDescendantIds(id) { return [...(descendants.get(id) ?? [])] },
  }
}

export async function createCommissionReportCalculator(tenant: string, rows: readonly CommissionReportAgent[], payouts = new CommissionPayoutsRepo(), options: { preserveExactClosure?: boolean } = {}) {
  const ids = rows.map(row => row.id)
  const [closure, rates] = await Promise.all([
    ids.length ? db.select({ ancestorId: agentHierarchyClosure.ancestorId, descendantId: agentHierarchyClosure.descendantId })
      .from(agentHierarchyClosure).where(inArray(agentHierarchyClosure.ancestorId, ids)) : [],
    loadCommissionRateRows(ids),
  ])
  return new CommissionCalculationService(
    commissionReportAgents(rows, closure, options), new AgentConfigsRepo(), new AgentLedgerRepo(),
    new CommissionReportGGRReader(tenant, ids), payouts,
    { rateRowsLoader: async selected => { const wanted = new Set(selected); return rates.filter(row => wanted.has(row.agentId)) } },
  )
}
