export type ReferralLink = { id: string; code: string; agentId?: string; utm?: Record<string, string>; createdAt: string }

const links = new Map<string, ReferralLink>()

function now() { return new Date().toISOString() }

export function seedReferrals() {
  if (links.size) return
  links.set('ref-1', { id: 'ref-1', code: 'WELCOME10', agentId: 'agent-1', utm: { source: 'ads' }, createdAt: now() })
}

export function listReferralLinks(): ReferralLink[] { return Array.from(links.values()) }
export function createReferralLink(input: { code: string; agentId?: string; utm?: Record<string,string> }): ReferralLink {
  const id = `ref-${Math.random().toString(36).slice(2,8)}`
  const r: ReferralLink = { id, code: input.code, agentId: input.agentId, utm: input.utm, createdAt: now() }
  links.set(id, r)
  return r
}
