import type { BonusAwardAdminStatusActor } from '@/repos/marketing/bonusesRepo.js'

/**
 * Display fields for who last changed bonus card status from admin (staff user or agent).
 */
export async function resolveBonusAwardStatusActorDisplay(ctx: any): Promise<BonusAwardAdminStatusActor> {
  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    const { db } = await import('@/db/client.js')
    const { agentCredentials } = await import('@shared/db/schema.js')
    const { eq } = await import('drizzle-orm')

    const agentsRepo = new AgentsRepo()
    const agent = await agentsRepo.findById(ctx.user.agentId)
    const credRows = await db
      .select({ username: agentCredentials.username })
      .from(agentCredentials)
      .where(eq(agentCredentials.agentId, ctx.user.agentId))
      .limit(1)
    const username = credRows[0]?.username?.trim() || 'Agent'
    return {
      name: username,
      phone: agent?.phone?.trim() || null,
      remark: 'Agent',
    }
  }

  const sub = ctx?.user?.sub ?? ctx?.user?.id
  const adminId = typeof sub === 'number' ? sub : Number(sub)
  if (!Number.isFinite(adminId)) {
    return { name: 'System', phone: null, remark: null }
  }

  const { getUserPublicByIdDb } = await import('@/repos/users/usersRepo.js')
  const user = await getUserPublicByIdDb(adminId)
  if (!user) {
    return { name: `User #${adminId}`, phone: null, remark: null }
  }

  const displayName = (user.name && user.name.trim()) || user.username?.trim() || `User #${adminId}`
  return {
    name: displayName,
    phone: user.phone?.trim() || null,
    remark: user.remark?.trim() || null,
  }
}
