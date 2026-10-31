export type ResultApproval = {
  id: string
  drawId: string
  value: string
  status: 'pending'|'approved'|'rejected'
  requestedBy: string
  approvedBy?: string
  reason?: string
  requestedAt: string
  decidedAt?: string
}

const approvals = new Map<string, ResultApproval>()

function now() { return new Date().toISOString() }

export function submitResultForApproval(drawId: string, value: string, requestedBy: string, reason?: string): ResultApproval {
  const id = `appr-${Math.random().toString(36).slice(2, 10)}`
  const a: ResultApproval = { id, drawId, value, status: 'pending', requestedBy, reason, requestedAt: now() }
  approvals.set(id, a)
  return a
}

export function approveResult(approvalId: string, approver: string): ResultApproval {
  const a = approvals.get(approvalId)
  if (!a) throw new Error('Approval not found')
  a.status = 'approved'
  a.approvedBy = approver
  a.decidedAt = now()
  approvals.set(a.id, a)
  return a
}

export function rejectResult(approvalId: string, approver: string): ResultApproval {
  const a = approvals.get(approvalId)
  if (!a) throw new Error('Approval not found')
  a.status = 'rejected'
  a.approvedBy = approver
  a.decidedAt = now()
  approvals.set(a.id, a)
  return a
}

export function getApproval(id: string): ResultApproval | undefined { return approvals.get(id) }
export function listApprovals(drawId?: string): ResultApproval[] {
  const arr = Array.from(approvals.values())
  return drawId ? arr.filter(a => a.drawId === drawId) : arr
}
