import { db } from '@src/db/client.js'
import { approvals } from '@src/db/schema.js'
import { eq, and } from 'drizzle-orm'

export async function createResultApproval(drawId: string, value: string, requestedBy: string, reason?: string, tenant = 'default') {
  try {
    const [row] = await db.insert(approvals).values({
      domain: 'matka.results',
      drawId,
      value,
      status: 'pending',
      requestedBy,
      approvedBy: null as any,
      decidedAt: null as any,
      reason: reason ?? null as any,
      tenant,
    }).returning()
    return row
  } catch {
    return null
  }
}

export async function approveResultApproval(approvalId: number, approvedBy: string, tenant = 'default') {
  try {
    const [row] = await db.update(approvals).set({ status: 'approved', approvedBy, decidedAt: new Date() }).where(and(eq(approvals.id, approvalId), eq(approvals.tenant, tenant))).returning()
    return row
  } catch {
    return null
  }
}

export async function rejectResultApproval(approvalId: number, approvedBy: string, tenant = 'default') {
  try {
    const [row] = await db.update(approvals).set({ status: 'rejected', approvedBy, decidedAt: new Date() }).where(and(eq(approvals.id, approvalId), eq(approvals.tenant, tenant))).returning()
    return row
  } catch {
    return null
  }
}

export async function listResultApprovals(drawId?: string, tenant = 'default') {
  try {
    if (drawId) {
      return await db.select().from(approvals).where(and(eq(approvals.domain, 'matka.results'), eq(approvals.drawId, drawId), eq(approvals.tenant, tenant)))
    }
    return await db.select().from(approvals).where(and(eq(approvals.domain, 'matka.results'), eq(approvals.tenant, tenant)))
  } catch { return [] }
}

