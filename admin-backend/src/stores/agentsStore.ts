export type Agent = { id: string; parentId?: string; name: string; level: number; commissionPlanId: string }
export type CommissionPlan = { id: string; basis: 'turnover'|'ggr'; tiers: { threshold: number; percent: number }[] }

const agents = new Map<string, Agent>()
const plans = new Map<string, CommissionPlan>()

export function seedAgents() {
  if (agents.size) return
  const p1: CommissionPlan = { id: 'plan-standard', basis: 'turnover', tiers: [{ threshold: 0, percent: 2 }, { threshold: 100000, percent: 3 }] }
  plans.set(p1.id, p1)
  const root: Agent = { id: 'agent-root', name: 'Root Agent', level: 0, commissionPlanId: p1.id }
  const a1: Agent = { id: 'agent-1', parentId: 'agent-root', name: 'Agent One', level: 1, commissionPlanId: p1.id }
  const a2: Agent = { id: 'agent-2', parentId: 'agent-root', name: 'Agent Two', level: 1, commissionPlanId: p1.id }
  const a3: Agent = { id: 'agent-3', parentId: 'agent-1', name: 'Sub Agent', level: 2, commissionPlanId: p1.id }
  ;[root, a1, a2, a3].forEach(a => agents.set(a.id, a))
}

export function listAgents(): Agent[] { return Array.from(agents.values()) }
export function listPlans(): CommissionPlan[] { return Array.from(plans.values()) }
export function getPlan(id: string) { return plans.get(id) }
export function upsertPlan(plan: CommissionPlan): CommissionPlan { plans.set(plan.id, plan); return plan }

export type AgentTree = Agent & { children: AgentTree[] }
export function agentsTree(): AgentTree[] {
  const nodes = listAgents()
  const map = new Map<string, AgentTree>()
  nodes.forEach(n => map.set(n.id, { ...n, children: [] }))
  const roots: AgentTree[] = []
  map.forEach((n) => {
    if (n.parentId) {
      const p = map.get(n.parentId)
      if (p) p.children.push(n)
    } else {
      roots.push(n)
    }
  })
  return roots
}
