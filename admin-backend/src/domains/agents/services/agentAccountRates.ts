import DataLoader from 'dataloader'
import { db } from '@src/db/client.js'
import { agentCommissionConfig, agentSharingConfig } from '@shared/db/schema.js'
import { desc, inArray } from 'drizzle-orm'

type Kind = 'commission' | 'sharing'
type Row = { agentId: string; domain: string; effectiveFrom: Date; effectiveTo: Date | null; commissionRate?: string; shareRate?: string }
const readers = new WeakMap<object, Partial<Record<Kind, DataLoader<string, Row[]>>>>()

/** Rate history is shared only within this GraphQL request; each field keeps its own effective instant. */
export async function readAgentAccountRates(parent: { id: string; allowedDomains?: string[] }, kind: Kind, ctx: object, at: Date) {
  if (!parent.allowedDomains?.length) return []
  let request = readers.get(ctx)
  if (!request) { request = {}; readers.set(ctx, request) }
  let loader = request[kind]
  if (!loader) {
    loader = new DataLoader<string, Row[]>(async ids => {
      const table = kind === 'commission' ? agentCommissionConfig : agentSharingConfig
      const rows = await db.select().from(table).where(inArray(table.agentId, [...ids])).orderBy(desc(table.effectiveFrom))
      const grouped = new Map<string, Row[]>(ids.map(id => [id, []]))
      for (const row of rows) grouped.get(row.agentId)?.push(row)
      return ids.map(id => grouped.get(id)!)
    })
    request[kind] = loader
  }
  try {
    const rows = await loader.load(parent.id)
    const buffer = at.getTime() + 1000
    return (parent.allowedDomains ?? []).flatMap(domain => {
      const row = rows.find(row => row.domain === domain && new Date(row.effectiveFrom).getTime() <= buffer && (!row.effectiveTo || new Date(row.effectiveTo).getTime() >= at.getTime()))
      return row ? [{ domain, rate: Number(kind === 'commission' ? row.commissionRate : row.shareRate) * 100 }] : []
    })
  } catch {
    loader.clear(parent.id)
    return null // The existing per-domain resolver remains the compatibility fallback.
  }
}
